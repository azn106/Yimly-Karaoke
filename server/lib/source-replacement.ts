import fs from 'fs';
import path from 'path';
import { db } from '../db/index.js';
import { songs, artists, albums, songVerifiedSources } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { downloadQueue, sanitizeFilename } from './download-queue.js';
import { separateAndCreateInstrumental } from './audio-separation.js';
import { importSingleAudioFile } from './scanner.js';

const activeSongReplacements = new Set<number>();

export interface ReplaceSourceResult {
  success: boolean;
  message: string;
  songId: number;
  originalPath?: string;
  instrumentalPath?: string;
  error?: string;
  jobId?: string;
}

export interface ReplacementProgress {
  jobId: string;
  songId: number;
  type: 'replace_audio' | 'replace_instrumental';
  status: 'pending' | 'downloading' | 'separating' | 'completed' | 'failed';
  progress: number;
  message: string;
  error?: string;
  result?: ReplaceSourceResult;
  startedAt: Date;
  updatedAt: Date;
}

const replacementJobs = new Map<string, ReplacementProgress>();

export function getReplacementJob(jobId: string): ReplacementProgress | undefined {
  return replacementJobs.get(jobId);
}

export function getActiveSongReplacement(songId: number): ReplacementProgress | undefined {
  for (const job of replacementJobs.values()) {
    if (job.songId === songId && (job.status === 'pending' || job.status === 'downloading' || job.status === 'separating')) {
      return job;
    }
  }
  return undefined;
}

export function extractYouTubeVideoId(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

export function isValidYouTubeUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return (
    (trimmed.includes('youtube.com/watch') || trimmed.includes('youtu.be/') || trimmed.includes('music.youtube.com/watch')) &&
    extractYouTubeVideoId(trimmed) !== null
  );
}

/**
 * Replace song recording source using a verified YouTube URL.
 * Reuses the existing download queue pipeline and instrumental separation pipeline.
 * Atomic file replacement with rollback on any failure.
 */
export async function replaceSongRecordingSource(songId: number, youtubeUrl: string): Promise<ReplaceSourceResult> {
  const trimmedUrl = (youtubeUrl || '').trim();
  if (!trimmedUrl) {
    throw new Error('A valid YouTube URL is required to replace the recording source.');
  }

  const videoId = extractYouTubeVideoId(trimmedUrl);
  if (!videoId) {
    return {
      success: false,
      message: 'Invalid YouTube URL provided.',
      songId,
      error: 'The provided URL is not a recognized YouTube video URL.',
    };
  }

  if (activeSongReplacements.has(songId)) {
    return {
      success: false,
      message: 'A replacement or reprocessing job is already running for this song.',
      songId,
      error: 'Concurrent replacement conflict: song is currently being processed.',
    };
  }

  const jobId = `rep_aud_${songId}_${Date.now()}`;
  const jobState: ReplacementProgress = {
    jobId,
    songId,
    type: 'replace_audio',
    status: 'pending',
    progress: 5,
    message: 'Starting recording replacement...',
    startedAt: new Date(),
    updatedAt: new Date(),
  };
  replacementJobs.set(jobId, jobState);

  activeSongReplacements.add(songId);

  // Generate unique staging directory using template literal
  const stagingDir = path.join(process.cwd(), 'data', `tmp_replace_${songId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);

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
    const now = new Date();

    // 2. Verified source persistence (MANDATORY: Must fail if saving fails)
    try {
      await db.insert(songVerifiedSources).values({
        songId,
        youtubeUrl: trimmedUrl,
        videoId,
        sourceTitle: song.title,
        sourceArtist: song.artist || 'Unknown Artist',
        verified: 1,
        verifiedAt: now,
      })
      .onConflictDoUpdate({
        target: songVerifiedSources.songId,
        set: {
          youtubeUrl: trimmedUrl,
          videoId,
          sourceTitle: song.title,
          sourceArtist: song.artist || 'Unknown Artist',
          verified: 1,
          verifiedAt: now,
        }
      });
    } catch (dbErr: any) {
      console.error('[SourceReplacement] Fatal: Failed to persist verified source record:', dbErr);
      throw new Error(`Failed to save verified recording source: ${dbErr?.message || dbErr}`);
    }

    // 3. Staging directory creation
    if (!fs.existsSync(stagingDir)) {
      fs.mkdirSync(stagingDir, { recursive: true });
    }

    jobState.status = 'downloading';
    jobState.progress = 25;
    jobState.message = `Downloading replacement recording from YouTube for "${song.title}"...`;
    jobState.updatedAt = new Date();

    console.log(`[SourceReplacement] Downloading replacement audio for song #${songId} ("${song.title}") via download pipeline...`);

    const formatExt = song.format || 'mp3';
    const safeArtist = sanitizeFilename(song.artist || 'Unknown Artist');
    const safeTitle = sanitizeFilename(song.title || 'Unknown Title');
    const baseFilename = `${safeArtist} - ${safeTitle}`;

    // 4. Download using established download pipeline
    const downloadedFile = await downloadQueue.downloadSingleTrackAudio(
      trimmedUrl,
      stagingDir,
      formatExt,
      '320k',
      3
    );

    // 5. Validate downloaded file
    if (!fs.existsSync(downloadedFile) || fs.statSync(downloadedFile).size <= 1024) {
      throw new Error('Downloaded audio validation failed: output file is missing or empty.');
    }

    const actualExt = path.extname(downloadedFile).replace('.', '') || formatExt;
    const stagedMainAudio = path.join(stagingDir, `${baseFilename}.${actualExt}`);
    if (downloadedFile !== stagedMainAudio) {
      fs.copyFileSync(downloadedFile, stagedMainAudio);
    }

    // 6. Execute instrumental separation using existing pipeline
    jobState.status = 'separating';
    jobState.progress = 60;
    jobState.message = `Separating instrumental for "${song.title}"...`;
    jobState.updatedAt = new Date();

    console.log(`[SourceReplacement] Executing instrumental separation for song #${songId}...`);
    const stagedInstrumental = path.join(stagingDir, `${baseFilename} (Instrumental).${actualExt}`);

    const sepResult = await separateAndCreateInstrumental(
      stagedMainAudio,
      stagedInstrumental,
      { title: song.title, artist: song.artist || 'Unknown Artist', album: song.album || '' }
    );

    if (!sepResult.ok || !fs.existsSync(stagedInstrumental) || fs.statSync(stagedInstrumental).size <= 1024) {
      throw new Error(sepResult.error || 'Instrumental separation failed or produced invalid file.');
    }

    // 7. Validate both staged files before touching originals
    const origStats = fs.statSync(stagedMainAudio);
    const instStats = fs.statSync(stagedInstrumental);
    if (origStats.size <= 1024 || instStats.size <= 1024) {
      throw new Error('Validation failed: Staged replacement files are invalid or empty.');
    }

    // 8. Safe atomic file replacement with rollback protection
    const oldMainPath = song.mainAudioPath;
    const oldInstPath = song.instrumentalAudioPath;

    const targetDir = oldMainPath ? path.dirname(oldMainPath) : path.join(process.cwd(), 'data', 'library', safeArtist);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const finalMainPath = path.join(targetDir, `${baseFilename}.${actualExt}`);
    const finalInstPath = path.join(targetDir, `${baseFilename} (Instrumental).${actualExt}`);

    // Create backups of old files in case of write error
    const backupMain = oldMainPath && fs.existsSync(oldMainPath) ? `${oldMainPath}.bak_${Date.now()}` : null;
    const backupInst = oldInstPath && fs.existsSync(oldInstPath) ? `${oldInstPath}.bak_${Date.now()}` : null;

    try {
      if (backupMain && oldMainPath) fs.copyFileSync(oldMainPath, backupMain);
      if (backupInst && oldInstPath) fs.copyFileSync(oldInstPath, backupInst);

      // Copy staged files to final destination
      fs.copyFileSync(stagedMainAudio, finalMainPath);
      fs.copyFileSync(stagedInstrumental, finalInstPath);

      // Verify final files
      if (!fs.existsSync(finalMainPath) || !fs.existsSync(finalInstPath)) {
        throw new Error('Failed to commit replacement files to destination path.');
      }

      // Update database atomically
      await db.update(songs).set({
        mainAudioPath: finalMainPath,
        instrumentalAudioPath: finalInstPath,
        fileSize: origStats.size,
        format: actualExt,
      }).where(eq(songs.id, songId));

      await db.update(songVerifiedSources).set({
        processedAt: new Date(),
      }).where(eq(songVerifiedSources.songId, songId));

      // Re-index metadata tags
      const canonicalMeta = {
        title: song.title,
        artist: song.artist || 'Unknown Artist',
        album: song.album || undefined,
      };
      await importSingleAudioFile(song.libraryId, finalMainPath, canonicalMeta);
      await importSingleAudioFile(song.libraryId, finalInstPath, canonicalMeta);

      // Clean up backups
      if (backupMain && fs.existsSync(backupMain)) try { fs.unlinkSync(backupMain); } catch {}
      if (backupInst && fs.existsSync(backupInst)) try { fs.unlinkSync(backupInst); } catch {}

      // Clean up old files if paths changed
      if (oldMainPath && oldMainPath !== finalMainPath && fs.existsSync(oldMainPath)) {
        try { fs.unlinkSync(oldMainPath); } catch {}
      }
      if (oldInstPath && oldInstPath !== finalInstPath && fs.existsSync(oldInstPath)) {
        try { fs.unlinkSync(oldInstPath); } catch {}
      }

      const result: ReplaceSourceResult = {
        success: true,
        message: 'Recording source replaced and audio reprocessed successfully.',
        songId,
        jobId,
        originalPath: finalMainPath,
        instrumentalPath: finalInstPath,
      };

      jobState.status = 'completed';
      jobState.progress = 100;
      jobState.message = 'Replacement completed successfully.';
      jobState.result = result;
      jobState.updatedAt = new Date();

      return result;

    } catch (commitErr: any) {
      // Rollback files from backups
      console.error('[SourceReplacement] Error during commit, rolling back:', commitErr);
      if (backupMain && fs.existsSync(backupMain) && oldMainPath) {
        try { fs.copyFileSync(backupMain, oldMainPath); fs.unlinkSync(backupMain); } catch {}
      }
      if (backupInst && fs.existsSync(backupInst) && oldInstPath) {
        try { fs.copyFileSync(backupInst, oldInstPath); fs.unlinkSync(backupInst); } catch {}
      }
      throw commitErr;
    }

  } catch (err: any) {
    console.error(`[SourceReplacement] Error replacing source for song #${songId}:`, err);

    const failResult: ReplaceSourceResult = {
      success: false,
      message: err.message || 'Failed to replace recording source.',
      songId,
      jobId,
      error: err.message,
    };

    jobState.status = 'failed';
    jobState.progress = 0;
    jobState.message = err.message || 'Replacement failed.';
    jobState.error = err.message;
    jobState.result = failResult;
    jobState.updatedAt = new Date();

    return failResult;
  } finally {
    // Clean up temporary staging directory safely
    try {
      if (fs.existsSync(stagingDir)) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      }
    } catch {}
    activeSongReplacements.delete(songId);
  }
}

/**
 * Replace only the instrumental audio for an existing song using the existing original audio.
 * Does not download from YouTube or alter the original audio file.
 */
export async function replaceSongInstrumental(songId: number): Promise<ReplaceSourceResult> {
  if (activeSongReplacements.has(songId)) {
    return {
      success: false,
      message: 'A replacement or reprocessing job is already running for this song.',
      songId,
      error: 'Concurrent processing conflict: song is currently busy.',
    };
  }

  const jobId = `rep_inst_${songId}_${Date.now()}`;
  const jobState: ReplacementProgress = {
    jobId,
    songId,
    type: 'replace_instrumental',
    status: 'pending',
    progress: 10,
    message: 'Starting instrumental regeneration...',
    startedAt: new Date(),
    updatedAt: new Date(),
  };
  replacementJobs.set(jobId, jobState);

  activeSongReplacements.add(songId);
  const stagingDir = path.join(process.cwd(), 'data', `tmp_inst_${songId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);

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

    if (!fs.existsSync(stagingDir)) {
      fs.mkdirSync(stagingDir, { recursive: true });
    }

    const formatExt = song.format || path.extname(song.mainAudioPath).replace('.', '') || 'mp3';
    const safeArtist = sanitizeFilename(song.artist || 'Unknown Artist');
    const safeTitle = sanitizeFilename(song.title || 'Unknown Title');
    const baseFilename = `${safeArtist} - ${safeTitle}`;
    const stagingInstrumentalPath = path.join(stagingDir, `${baseFilename} (Instrumental).${formatExt}`);

    jobState.status = 'separating';
    jobState.progress = 50;
    jobState.message = `Regenerating instrumental track for "${song.title}"...`;
    jobState.updatedAt = new Date();

    console.log(`[SourceReplacement] Regenerating instrumental for song #${songId} ("${song.title}")...`);
    const sepResult = await separateAndCreateInstrumental(
      song.mainAudioPath,
      stagingInstrumentalPath,
      { title: song.title, artist: song.artist || 'Unknown Artist', album: song.album || '' }
    );

    if (!sepResult.ok || !fs.existsSync(stagingInstrumentalPath) || fs.statSync(stagingInstrumentalPath).size <= 1024) {
      throw new Error(sepResult.error || 'Instrumental separation failed or produced invalid file.');
    }

    const targetDir = path.dirname(song.mainAudioPath);
    const finalInstPath = path.join(targetDir, `${baseFilename} (Instrumental).${formatExt}`);
    const oldInstPath = song.instrumentalAudioPath;

    const backupInst = oldInstPath && fs.existsSync(oldInstPath) ? `${oldInstPath}.bak_${Date.now()}` : null;

    try {
      if (backupInst && oldInstPath) {
        fs.copyFileSync(oldInstPath, backupInst);
      }

      fs.copyFileSync(stagingInstrumentalPath, finalInstPath);
      if (!fs.existsSync(finalInstPath)) {
        throw new Error('Failed to commit regenerated instrumental file.');
      }

      await db.update(songs).set({
        instrumentalAudioPath: finalInstPath,
      }).where(eq(songs.id, songId));

      const canonicalMeta = {
        title: song.title,
        artist: song.artist || 'Unknown Artist',
        album: song.album || undefined,
      };
      await importSingleAudioFile(song.libraryId, finalInstPath, canonicalMeta);

      if (backupInst && fs.existsSync(backupInst)) {
        try { fs.unlinkSync(backupInst); } catch {}
      }
      if (oldInstPath && oldInstPath !== finalInstPath && fs.existsSync(oldInstPath)) {
        try { fs.unlinkSync(oldInstPath); } catch {}
      }

      const result: ReplaceSourceResult = {
        success: true,
        message: 'Instrumental audio regenerated and replaced successfully.',
        songId,
        jobId,
        instrumentalPath: finalInstPath,
      };

      jobState.status = 'completed';
      jobState.progress = 100;
      jobState.message = 'Instrumental regenerated successfully.';
      jobState.result = result;
      jobState.updatedAt = new Date();

      return result;

    } catch (commitErr: any) {
      if (backupInst && fs.existsSync(backupInst) && oldInstPath) {
        try { fs.copyFileSync(backupInst, oldInstPath); fs.unlinkSync(backupInst); } catch {}
      }
      throw commitErr;
    }

  } catch (err: any) {
    console.error(`[SourceReplacement] Error replacing instrumental for song #${songId}:`, err);
    const failResult: ReplaceSourceResult = {
      success: false,
      message: err.message || 'Failed to replace instrumental.',
      songId,
      jobId,
      error: err.message,
    };

    jobState.status = 'failed';
    jobState.progress = 0;
    jobState.message = err.message || 'Failed to regenerate instrumental.';
    jobState.error = err.message;
    jobState.result = failResult;
    jobState.updatedAt = new Date();

    return failResult;
  } finally {
    try {
      if (fs.existsSync(stagingDir)) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      }
    } catch {}
    activeSongReplacements.delete(songId);
  }
}
