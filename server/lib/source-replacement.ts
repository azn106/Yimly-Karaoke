import fs from 'fs';
import path from 'path';
import { db } from '../db/index.js';
import { songs, artists, albums, songVerifiedSources } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { downloadQueue, sanitizeFilename } from './download-queue.js';
import {
  generateInstrumentalFromOriginal,
  GeneratedInstrumentalResult,
  getCanonicalSongArtists,
  getDataTempBaseDir,
  installInstrumentalForSong,
  installRecordingBundleForSong,
  releaseSongReplacementLock,
  tryAcquireSongReplacementLockWithToken,
  validateOriginalRecordingFile,
} from './instrumental-pipeline.js';
import { validateAndCanonicalizeYouTubeUrl } from './url-validator.js';

/**
 * Resolves a yt-dlp-compatible audio format for Replace Audio downloads
 * without breaking on container labels like "M4A/isom/iso2" or "MPEG".
 */
function resolveReplacementDownloadFormat(dbFormat?: string | null, mainAudioPath?: string | null): string {
  const pathExt = mainAudioPath ? path.extname(mainAudioPath).replace('.', '').trim().toLowerCase() : '';
  if (pathExt && /^[a-z0-9]{2,5}$/.test(pathExt)) {
    return pathExt;
  }
  const raw = (dbFormat || '').trim().toLowerCase();
  if (!raw) return 'mp3';
  if (raw.includes('mpeg')) return 'mp3';
  if (raw.startsWith('m4a') || raw.startsWith('mp4')) return 'm4a';
  if (raw.startsWith('ogg') || raw === 'oga') return 'ogg';
  const beforeSlash = raw.split('/')[0].trim();
  return /^[a-z0-9]{2,5}$/.test(beforeSlash) ? beforeSlash : 'mp3';
}

export interface ReplaceSourceResult {
  success: boolean;
  message: string;
  songId: number;
  originalPath?: string;
  instrumentalPath?: string;
  error?: string;
  jobId?: string;
}

export type ReplacementStatus = 'queued' | 'pending' | 'downloading' | 'separating' | 'finalising' | 'completed' | 'failed' | 'cancelled';

export interface ReplacementProgress {
  jobId: string;
  songId: number;
  type: 'replace_audio' | 'replace_instrumental';
  status: ReplacementStatus;
  progress: number;
  message: string;
  error?: string;
  result?: ReplaceSourceResult;
  startedAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export function getReplacementJob(jobId: string): ReplacementProgress | undefined {
  const job = downloadQueue.getReplacementJob(jobId);
  if (!job) return undefined;
  return {
    jobId: job.id,
    songId: job.songId,
    type: job.type,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error,
    result: job.result,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  };
}

export function getActiveSongReplacement(songId: number): ReplacementProgress | undefined {
  const job = downloadQueue.getActiveSongReplacement(songId);
  if (!job) return undefined;
  return {
    jobId: job.id,
    songId: job.songId,
    type: job.type,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error,
    result: job.result,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  };
}

/**
 * Return the newest replacement for a song, optionally limited to jobs
 * started at or after the caller's request timestamp.
 */
export function getLatestSongReplacement(
  songId: number,
  since?: number
): ReplacementProgress | undefined {
  const job = downloadQueue.getLatestSongReplacement(songId, since);
  if (!job) return undefined;
  return {
    jobId: job.id,
    songId: job.songId,
    type: job.type,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error,
    result: job.result,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  };
}

export function getActiveSongReplacements(songId?: number): ReplacementProgress[] {
  return downloadQueue.getActiveReplacementJobs(songId).map(job => ({
    jobId: job.id,
    songId: job.songId,
    type: job.type,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error,
    result: job.result,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  }));
}

export function extractYouTubeVideoId(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  const res = validateAndCanonicalizeYouTubeUrl(url, { allowPlaylist: true });
  return (res.valid && res.videoId) ? res.videoId : null;
}

export function isValidYouTubeUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const res = validateAndCanonicalizeYouTubeUrl(url, { allowPlaylist: true });
  return Boolean(res.valid && res.videoId);
}

/**
 * Replace song recording source using a verified YouTube URL.
 * Reuses the download queue pipeline and the shared instrumental generation & installation services.
 * Atomic file replacement with full rollback on any failure.
 */
export async function replaceSongRecordingSource(songId: number, youtubeUrl: string): Promise<ReplaceSourceResult> {
  const trimmedUrl = (youtubeUrl || '').trim();
  if (!trimmedUrl) {
    throw new Error('A valid YouTube URL is required to replace the recording source.');
  }

  const validation = validateAndCanonicalizeYouTubeUrl(trimmedUrl, { allowPlaylist: false });
  if (!validation.valid || !validation.videoId || !validation.canonicalUrl) {
    return {
      success: false,
      message: 'Invalid YouTube URL provided.',
      songId,
      error: validation.error || 'The provided URL is not a recognized YouTube video URL.',
    };
  }

  const videoId = validation.videoId;
  const canonicalUrl = validation.canonicalUrl;

  const lockToken = tryAcquireSongReplacementLockWithToken(songId);
  if (!lockToken) {
    return {
      success: false,
      message: 'A replacement or reprocessing job is already running for this song.',
      songId,
      error: 'Concurrent replacement conflict: song is currently being processed.',
    };
  }

  const jobId = `rep_aud_${songId}_${Date.now()}`;
  const abortController = new AbortController();
  let executionStarted = false;

  return downloadQueue.enqueueReplacementJob({
    id: jobId,
    songId,
    type: 'replace_audio',
    cancel: () => {
      abortController.abort();
      if (!executionStarted) {
        releaseSongReplacementLock(songId, lockToken);
      }
    },
    execute: async (jobState) => {
      executionStarted = true;
      const stagingDir = path.join(
        getDataTempBaseDir(),
        `tmp_replace_${songId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
      );
      let generated: GeneratedInstrumentalResult | null = null;

      try {
        // 1. Fetch existing song record
        const songRec = await db.select({
          id: songs.id,
          libraryId: songs.libraryId,
          artistId: songs.artistId,
          artist: artists.name,
          albumId: songs.albumId,
          album: albums.title,
          title: songs.title,
          mainAudioPath: songs.mainAudioPath,
          instrumentalAudioPath: songs.instrumentalAudioPath,
          variant: songs.variant,
          format: songs.format,
          fileSize: songs.fileSize,
          duration: songs.duration,
          trackNumber: songs.trackNumber,
          discNumber: songs.discNumber,
          year: songs.year,
        })
        .from(songs)
        .leftJoin(artists, eq(songs.artistId, artists.id))
        .leftJoin(albums, eq(songs.albumId, albums.id))
        .where(eq(songs.id, songId))
        .limit(1);

        if (songRec.length === 0) {
          throw new Error(`Song with ID ${songId} not found in library.`);
        }

        const song = songRec[0];
        const songArtistNames = await getCanonicalSongArtists(songId, song.artist);
        const primaryArtistName = song.artist || songArtistNames[0] || 'Unknown Artist';

        if (!fs.existsSync(stagingDir)) {
          fs.mkdirSync(stagingDir, { recursive: true });
        }

        jobState.status = 'downloading';
        jobState.progress = 25;
        jobState.message = `Downloading replacement recording from YouTube for "${song.title}"...`;
        jobState.updatedAt = new Date();

        console.log(`[SourceReplacement] Downloading replacement audio for song #${songId} ("${song.title}") via download pipeline...`);

        const formatExt = resolveReplacementDownloadFormat(song.format, song.mainAudioPath);
        const safeArtist = sanitizeFilename(primaryArtistName);
        const safeTitle = sanitizeFilename(song.title || 'Unknown Title');
        const baseFilename = `${safeArtist} - ${safeTitle}`;

        // 2. Download using established download pipeline
        const downloadedFile = await downloadQueue.downloadSingleTrackAudio(
          canonicalUrl,
          stagingDir,
          formatExt,
          '320k',
          3
        );

        const actualExt = (path.extname(downloadedFile).replace('.', '') || formatExt).toLowerCase();
        const stagedMainAudio = path.join(stagingDir, `${baseFilename}.${actualExt}`);
        if (downloadedFile !== stagedMainAudio) {
          fs.copyFileSync(downloadedFile, stagedMainAudio);
        }

        // 3. Validate downloaded original recording
        await validateOriginalRecordingFile(stagedMainAudio);

        const targetDir = song.mainAudioPath
          ? path.dirname(song.mainAudioPath)
          : path.join(getDataTempBaseDir(), 'library', safeArtist);

        // 4. Generate instrumental MP3 via the exact same shared pipeline used by New Song
        jobState.status = 'separating';
        jobState.progress = 55;
        jobState.message = `Separating instrumental for "${song.title}"...`;
        jobState.updatedAt = new Date();

        console.log(`[SourceReplacement] Executing shared instrumental pipeline for song #${songId}...`);
        generated = await generateInstrumentalFromOriginal({
          originalAudioPath: stagedMainAudio,
          targetDir,
          baseFilename,
          stagingDir,
          metadata: {
            title: song.title,
            artist: primaryArtistName,
            artists: songArtistNames,
            album: song.album || undefined,
            duration: song.duration || undefined,
            trackNumber: song.trackNumber || undefined,
            discNumber: song.discNumber || undefined,
            year: song.year || undefined,
          },
          signal: abortController.signal,
          isCancelled: () => jobState.status === 'cancelled',
          onProgress: (pct, msg) => {
            jobState.progress = Math.min(84, 55 + Math.round(pct * 0.28));
            jobState.message = msg || jobState.message;
            jobState.updatedAt = new Date();
          },
        });

        // 5. Shared atomic installation + scanner verification + verified source update with rollback
        jobState.status = 'finalising';
        jobState.progress = 85;
        jobState.message = `Finalising replacement audio for "${song.title}"...`;
        jobState.updatedAt = new Date();

        const canonicalMeta = {
          title: song.title,
          artist: primaryArtistName,
          artists: songArtistNames,
          album: song.album || undefined,
          duration: song.duration || undefined,
          trackNumber: song.trackNumber || undefined,
          discNumber: song.discNumber || undefined,
          year: song.year || undefined,
        };

        const bundleResult = await installRecordingBundleForSong({
          songId,
          stagedMainPath: stagedMainAudio,
          stagedInstrumentalPath: generated.stagedInstrumentalPath,
          targetDir,
          baseFilename,
          mainExtension: actualExt,
          canonicalMeta,
          afterDbAndScannerCommit: async () => {
            const commitTime = new Date();
            await db.insert(songVerifiedSources).values({
              songId,
              youtubeUrl: trimmedUrl,
              videoId,
              sourceTitle: song.title,
              sourceArtist: primaryArtistName,
              verified: 1,
              verifiedAt: commitTime,
              processedAt: commitTime,
            })
            .onConflictDoUpdate({
              target: songVerifiedSources.songId,
              set: {
                youtubeUrl: trimmedUrl,
                videoId,
                sourceTitle: song.title,
                sourceArtist: primaryArtistName,
                verified: 1,
                verifiedAt: commitTime,
                processedAt: commitTime,
              },
            });
          },
        });

        const result: ReplaceSourceResult = {
          success: true,
          message: 'Recording source replaced and audio reprocessed successfully.',
          songId,
          jobId,
          originalPath: bundleResult.mainAudioPath,
          instrumentalPath: bundleResult.instrumentalAudioPath,
        };

        jobState.status = 'completed';
        jobState.progress = 100;
        jobState.message = 'Replacement completed successfully.';
        jobState.result = result;
        jobState.updatedAt = new Date();

        return result;
      } catch (err: any) {
        console.error(`[SourceReplacement] Error replacing source for song #${songId}:`, err);

        const failResult: ReplaceSourceResult = {
          success: false,
          message: err.message || 'Failed to replace recording source.',
          songId,
          jobId,
          error: err.message,
        };

        if (jobState.status !== 'cancelled') {
          jobState.status = 'failed';
        }
        jobState.progress = 0;
        jobState.message = err.message || 'Replacement failed.';
        jobState.error = err.message;
        jobState.result = failResult;
        jobState.updatedAt = new Date();

        return failResult;
      } finally {
        generated?.cleanup();
        try {
          if (fs.existsSync(stagingDir)) {
            fs.rmSync(stagingDir, { recursive: true, force: true });
          }
        } catch {}
        releaseSongReplacementLock(songId, lockToken);
      }
    }
  });
}

/**
 * Replace only the instrumental audio for an existing song using the existing original audio.
 * Does not download from YouTube or alter the original audio file.
 * Reuses the exact same shared instrumental generation, validation, installation, and rollback
 * pipeline used across Yimly Karaoke.
 */
export async function replaceSongInstrumental(songId: number): Promise<ReplaceSourceResult> {
  const lockToken = tryAcquireSongReplacementLockWithToken(songId);
  if (!lockToken) {
    return {
      success: false,
      message: 'A replacement or reprocessing job is already running for this song.',
      songId,
      error: 'Concurrent processing conflict: song is currently busy.',
    };
  }

  const jobId = `rep_inst_${songId}_${Date.now()}`;
  const abortController = new AbortController();
  let executionStarted = false;

  return downloadQueue.enqueueReplacementJob({
    id: jobId,
    songId,
    type: 'replace_instrumental',
    cancel: () => {
      abortController.abort();
      if (!executionStarted) {
        releaseSongReplacementLock(songId, lockToken);
      }
    },
    execute: async (jobState) => {
      executionStarted = true;
      const stagingDir = path.join(
        getDataTempBaseDir(),
        `tmp_inst_${songId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
      );
      let generated: GeneratedInstrumentalResult | null = null;

      try {
        const songRec = await db.select({
          id: songs.id,
          libraryId: songs.libraryId,
          artistId: songs.artistId,
          artist: artists.name,
          albumId: songs.albumId,
          album: albums.title,
          title: songs.title,
          mainAudioPath: songs.mainAudioPath,
          instrumentalAudioPath: songs.instrumentalAudioPath,
          variant: songs.variant,
          format: songs.format,
          duration: songs.duration,
          trackNumber: songs.trackNumber,
          discNumber: songs.discNumber,
          year: songs.year,
        })
        .from(songs)
        .leftJoin(artists, eq(songs.artistId, artists.id))
        .leftJoin(albums, eq(songs.albumId, albums.id))
        .where(eq(songs.id, songId))
        .limit(1);

        if (songRec.length === 0) {
          throw new Error(`Song with ID ${songId} not found in library.`);
        }

        const song = songRec[0];
        if (!song.mainAudioPath || !fs.existsSync(song.mainAudioPath)) {
          throw new Error('Original main audio file not found on disk. Cannot regenerate instrumental.');
        }

        const songArtistNames = await getCanonicalSongArtists(songId, song.artist);
        const primaryArtistName = song.artist || songArtistNames[0] || 'Unknown Artist';

        if (!fs.existsSync(stagingDir)) {
          fs.mkdirSync(stagingDir, { recursive: true });
        }

        const safeArtist = sanitizeFilename(primaryArtistName);
        const safeTitle = sanitizeFilename(song.title || 'Unknown Title');
        const baseFilename = `${safeArtist} - ${safeTitle}`;
        const targetDir = path.dirname(song.mainAudioPath);

        jobState.status = 'separating';
        jobState.progress = 25;
        jobState.message = `Regenerating instrumental track for "${song.title}"...`;
        jobState.updatedAt = new Date();

        console.log(`[SourceReplacement] Regenerating instrumental for song #${songId} ("${song.title}") via shared pipeline...`);

        // 1. Run shared AI instrumental-generation pipeline on the existing original recording (no download)
        generated = await generateInstrumentalFromOriginal({
          originalAudioPath: song.mainAudioPath,
          targetDir,
          baseFilename,
          stagingDir,
          metadata: {
            title: song.title,
            artist: primaryArtistName,
            artists: songArtistNames,
            album: song.album || undefined,
            duration: song.duration || undefined,
            trackNumber: song.trackNumber || undefined,
            discNumber: song.discNumber || undefined,
            year: song.year || undefined,
          },
          signal: abortController.signal,
          isCancelled: () => jobState.status === 'cancelled',
          onProgress: (pct, msg) => {
            jobState.progress = Math.min(84, 20 + Math.round(pct * 0.64));
            jobState.message = msg || jobState.message;
            jobState.updatedAt = new Date();
          },
        });

        // 2. Install via shared atomic installation + rollback service
        jobState.status = 'finalising';
        jobState.progress = 85;
        jobState.message = `Finalising instrumental file...`;
        jobState.updatedAt = new Date();

        const canonicalMeta = {
          title: song.title,
          artist: primaryArtistName,
          artists: songArtistNames,
          album: song.album || undefined,
          duration: song.duration || undefined,
          trackNumber: song.trackNumber || undefined,
          discNumber: song.discNumber || undefined,
          year: song.year || undefined,
        };

        const installResult = await installInstrumentalForSong({
          songId,
          stagedInstrumentalPath: generated.stagedInstrumentalPath,
          targetDir,
          targetFilename: `${baseFilename} (Instrumental).mp3`,
          canonicalMeta,
        });

        const result: ReplaceSourceResult = {
          success: true,
          message: 'Instrumental audio regenerated and replaced successfully.',
          songId,
          jobId,
          instrumentalPath: installResult.instrumentalPath,
        };

        jobState.status = 'completed';
        jobState.progress = 100;
        jobState.message = 'Instrumental regenerated successfully.';
        jobState.result = result;
        jobState.updatedAt = new Date();

        return result;
      } catch (err: any) {
        console.error(`[SourceReplacement] Error replacing instrumental for song #${songId}:`, err);
        const failResult: ReplaceSourceResult = {
          success: false,
          message: err.message || 'Failed to replace instrumental.',
          songId,
          jobId,
          error: err.message,
        };

        if (jobState.status !== 'cancelled') {
          jobState.status = 'failed';
        }
        jobState.progress = 0;
        jobState.message = err.message || 'Failed to regenerate instrumental.';
        jobState.error = err.message;
        jobState.result = failResult;
        jobState.updatedAt = new Date();

        return failResult;
      } finally {
        generated?.cleanup();
        try {
          if (fs.existsSync(stagingDir)) {
            fs.rmSync(stagingDir, { recursive: true, force: true });
          }
        } catch {}
        releaseSongReplacementLock(songId, lockToken);
      }
    }
  });
}
