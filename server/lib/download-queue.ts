import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { execFile, exec, ChildProcess } from 'child_process';
import NodeID3 from 'node-id3';
import { db } from '../db/index.js';
import { downloadJobs, downloadTrackJobs, libraries, queueItems, playlists, playlistSongs, songs } from '../db/schema.js';
import { eq, and, asc, inArray, sql } from 'drizzle-orm';
import { scanLibrary } from './scanner.js';
import { fetchLyrics, saveLrcSidecar, stripLrcTimestamps } from './lyrics.js';
import { matchSpotifyTrackToYouTube } from './youtube-matcher.js';
import { isPreviewMode, simulateDownload } from './preview-mode.js';

const execFilePromise = promisify(execFile);
const execPromise = promisify(exec);

export interface TrackMetadata {
  id?: string;
  title: string;
  artist: string;
  artists?: string[];
  album?: string;
  trackNumber?: number;
  discNumber?: number;
  releaseYear?: number;
  duration?: number;
  artworkUrl?: string;
  sourceUrl?: string;
}

export interface CreateJobParams {
  id?: string;
  userId?: number;
  playlistName?: string;
  playlistCoverUrl?: string;
  spotifyPlaylistId?: string;
  sourceType?: string;
  sourceId?: string;
  type?: 'playlist' | 'album' | 'track' | 'search';
  libraryId?: number;
  libraryPath: string;
  format?: 'mp3' | 'm4a' | 'flac' | 'wav' | 'opus';
  quality?: string;
  embedMetadata?: boolean;
  embedArtwork?: boolean;
  downloadLyrics?: boolean;
  lyricsProviders?: string[];
  folderStructure?: string;
  playlistFolder?: boolean;
  tracks: TrackMetadata[];
}

export interface ActiveTrackJob {
  id: string;
  jobId: string;
  title: string;
  artist: string;
  artists?: string[];
  album: string;
  trackNumber?: number | null;
  discNumber?: number | null;
  releaseYear?: number | null;
  duration?: number | null;
  artworkUrl?: string | null;
  sourceUrl?: string | null;
  status: 'queued' | 'searching' | 'downloading' | 'tagging' | 'completed' | 'failed';
  progress: number;
  retryCount: number;
  error?: string | null;
  outputPath?: string | null;
  position: number;
}

export interface ActiveDownloadJob {
  id: string;
  playlistName?: string | null;
  playlistId?: number | null;
  type: string;
  status: 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  libraryId?: number | null;
  libraryPath: string;
  format: string;
  quality: string;
  embedMetadata: boolean;
  embedArtwork: boolean;
  downloadLyrics: boolean;
  lyricsProviders?: string[] | null;
  folderStructure: string;
  playlistFolder: boolean;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  tracks: ActiveTrackJob[];
  createdAt: Date;
  updatedAt: Date;
}

// Keep cancellation checks visible to TypeScript after awaits, where mutable job state may change.
function isCancelledJob(job: ActiveDownloadJob): boolean {
  return job.status === 'cancelled';
}

export function sanitizeFilename(str: string): string {
  if (!str) return 'Unknown';
  const cleaned = str.replace(/[/\\?%*:|"<>]/g, '').trim().replace(/^\.+|\.+$/g, '');
  return cleaned || 'Unknown';
}

/** Normalize collaboration credits to a stable "Artist A; Artist B" format. */
export function getCreditedArtists(primaryArtist: string, creditedArtists?: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of [primaryArtist, ...(creditedArtists || [])]) {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name) continue;
    // Older sources put multiple artists in one string; split and normalize spacing.
    for (const part of name.split(/\s*[;,]\s*/).map(value => value.trim()).filter(Boolean)) {
      const key = part.toLocaleLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(part);
      }
    }
  }
  return result.length ? result : ['Unknown Artist'];
}

function sanitizeErrorMessage(msg?: string): string {
  if (!msg) return 'Unknown error occurred';
  // Remove absolute paths and long stack lines for clean UI display
  const cleaned = msg
    .replace(/\/[\w./-]+/g, '')
    .replace(/ERROR:\s*/gi, '')
    .split('\n')[0]
    .trim();
  return cleaned.length > 180 ? cleaned.slice(0, 180) + '...' : cleaned;
}

let cachedYtDlpPath: string | null = null;

export async function getYtDlpPath(): Promise<string> {
  if (cachedYtDlpPath && fs.existsSync(cachedYtDlpPath)) {
    try {
      await execFilePromise(cachedYtDlpPath, ['--version']);
      return cachedYtDlpPath;
    } catch {
      cachedYtDlpPath = null;
    }
  }

  const possiblePaths = [
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    path.join(process.cwd(), 'yt-dlp'),
    './yt-dlp',
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        await execPromise(`chmod +x ${p}`);
        await execFilePromise(p, ['--version']);
        cachedYtDlpPath = p;
        return p;
      } catch (err) {
        console.warn(`Binary at ${p} failed check, trying next...`);
      }
    }
  }

  // Download standalone yt-dlp_linux binary
  console.log('Downloading standalone yt-dlp binary...');
  const targetPath = path.join(process.cwd(), 'yt-dlp');
  try {
    await execPromise(`curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o ${targetPath} && chmod +x ${targetPath}`);
    await execFilePromise(targetPath, ['--version']);
    cachedYtDlpPath = targetPath;
    return targetPath;
  } catch (linuxErr) {
    console.warn('Failed downloading yt-dlp_linux, falling back to python zipapp release...', linuxErr);
    await execPromise(`curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ${targetPath} && chmod +x ${targetPath}`);
    cachedYtDlpPath = targetPath;
    return targetPath;
  }
}

export class DownloadQueueManager {
  private maxConcurrency: number = 1;
  private activeWorkers: number = 0;
  private memoryJobs = new Map<string, ActiveDownloadJob>();
  private activeChildProcesses = new Map<string, ChildProcess>();
  private isPumping: boolean = false;
  private initialized: boolean = false;

  constructor() {
    this.ensureTmpDir();
  }

  private ensureTmpDir() {
    const tmpDir = path.join(process.cwd(), 'data', 'tmp_downloads');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  }

  public setConcurrency(_concurrency: number) {
    // Song downloads and their downstream processing must share one server-wide slot.
    // Do not allow a persisted legacy setting to increase concurrency.
    this.maxConcurrency = 1;
  }

  public getConcurrency(): number {
    return this.maxConcurrency;
  }

  public async init() {
    if (this.initialized) return;
    this.initialized = true;

    try {
      // Keep the global pipeline serial even if a legacy concurrency setting exists.
      this.maxConcurrency = 1;

      // Recover incomplete jobs from database
      const pendingJobs = await db.select().from(downloadJobs).where(
        inArray(downloadJobs.status, ['queued', 'downloading'])
      );

      for (const jobRec of pendingJobs) {
        const trackRecs = await db.select().from(downloadTrackJobs)
          .where(eq(downloadTrackJobs.jobId, jobRec.id))
          .orderBy(asc(downloadTrackJobs.position));

        const activeTracks: ActiveTrackJob[] = trackRecs.map((t) => {
          // If the server crashed mid-download, reset non-terminal statuses back to queued
          const isTransient = t.status === 'searching' || t.status === 'downloading' || t.status === 'tagging';
          const correctedStatus = isTransient ? 'queued' : t.status;
          return {
            id: t.id,
            jobId: t.jobId,
            title: t.title,
            artist: t.artist,
            album: t.album || '',
            trackNumber: t.trackNumber,
            discNumber: t.discNumber,
            releaseYear: t.releaseYear,
            duration: t.duration,
            artworkUrl: t.artworkUrl,
            sourceUrl: t.sourceUrl,
            status: correctedStatus,
            progress: correctedStatus === 'completed' ? 100 : 0,
            retryCount: t.retryCount || 0,
            error: t.error,
            outputPath: t.outputPath,
            position: t.position,
          };
        });

        // Update any transient tracks in the DB
        for (const t of activeTracks) {
          if (t.status === 'queued') {
            await db.update(downloadTrackJobs).set({ status: 'queued', progress: 0, updatedAt: new Date() }).where(eq(downloadTrackJobs.id, t.id));
          }
        }

        const activeJob: ActiveDownloadJob = {
          id: jobRec.id,
          playlistName: jobRec.playlistName,
          type: jobRec.type,
          status: 'downloading',
          libraryId: jobRec.libraryId,
          libraryPath: jobRec.libraryPath,
          format: jobRec.format,
          quality: jobRec.quality,
          embedMetadata: jobRec.embedMetadata === 1,
          embedArtwork: jobRec.embedArtwork === 1,
          downloadLyrics: jobRec.downloadLyrics === 1,
          lyricsProviders: jobRec.lyricsProviders ? JSON.parse(jobRec.lyricsProviders) : ['lrclib'],
          folderStructure: jobRec.folderStructure,
          playlistFolder: jobRec.playlistFolder === 1,
          totalCount: jobRec.totalCount,
          completedCount: activeTracks.filter(t => t.status === 'completed').length,
          failedCount: activeTracks.filter(t => t.status === 'failed').length,
          tracks: activeTracks,
          createdAt: jobRec.createdAt,
          updatedAt: jobRec.updatedAt,
        };

        this.memoryJobs.set(activeJob.id, activeJob);
      }

      console.log(`[Downloader Queue] Initialized with concurrency ${this.maxConcurrency}. Recovered ${pendingJobs.length} active jobs.`);
      this.pumpQueue();
    } catch (err) {
      // Allow a later addJob/init call to retry recovery after a transient DB
      // failure instead of leaving the manager permanently marked initialized.
      this.initialized = false;
      console.error('[Downloader Queue] Initialization error:', err);
    }
  }

  public async addJob(params: CreateJobParams): Promise<ActiveDownloadJob> {
    await this.init();

    const jobId = params.id || `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date();

    const activeTracks: ActiveTrackJob[] = params.tracks.map((t, idx) => ({
      id: t.id || `tr_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`,
      jobId,
      title: t.title.trim(),
      artist: t.artist.trim(),
      artists: t.artists?.map(a => a.trim()).filter(Boolean),
      album: (t.album || '').trim(),
      trackNumber: t.trackNumber || null,
      discNumber: t.discNumber || null,
      releaseYear: t.releaseYear || null,
      duration: t.duration || null,
      artworkUrl: t.artworkUrl || null,
      sourceUrl: t.sourceUrl || null,
      status: 'queued',
      progress: 0,
      retryCount: 0,
      error: null,
      outputPath: null,
      position: idx,
    }));

    let playlistId: number | null = null;
    if (params.userId && (params.spotifyPlaylistId || params.sourceId || params.playlistName)) {
      const sourceTypeVal = params.sourceType || (params.spotifyPlaylistId || params.sourceId ? 'spotify' : 'playlist');
      const sourceIdVal = params.spotifyPlaylistId || params.sourceId || null;

      try {
        let existing = [];
        if (sourceIdVal) {
          existing = await db.select().from(playlists).where(
            and(eq(playlists.userId, params.userId), eq(playlists.sourceId, sourceIdVal))
          ).limit(1);
        } else if (params.playlistName) {
          existing = await db.select().from(playlists).where(
            and(eq(playlists.userId, params.userId), eq(playlists.name, params.playlistName.trim()))
          ).limit(1);
        }

        if (existing.length > 0) {
          playlistId = existing[0].id;
          let coverPathVal = existing[0].coverPath;
          if (params.playlistCoverUrl && !coverPathVal) {
            coverPathVal = await this.downloadAndSavePlaylistCover(params.playlistCoverUrl);
          }
          await db.update(playlists).set({
            name: params.playlistName?.trim() || existing[0].name,
            coverPath: coverPathVal,
            updatedAt: now,
          }).where(eq(playlists.id, playlistId));
        } else {
          let coverPathVal: string | null = null;
          if (params.playlistCoverUrl) {
            coverPathVal = await this.downloadAndSavePlaylistCover(params.playlistCoverUrl);
          }

          const newPl = await db.insert(playlists).values({
            userId: params.userId,
            name: params.playlistName?.trim() || 'Imported Playlist',
            coverPath: coverPathVal,
            sourceType: sourceTypeVal,
            sourceId: sourceIdVal,
            createdAt: now,
            updatedAt: now,
          }).returning();
          playlistId = newPl[0].id;
        }
      } catch (plErr) {
        console.warn('[Downloader Queue] Failed to create or reuse playlist:', plErr);
      }
    }

    const activeJob: ActiveDownloadJob = {
      id: jobId,
      playlistName: params.playlistName || null,
      playlistId,
      type: params.type || 'playlist',
      status: 'downloading',
      libraryId: params.libraryId || null,
      libraryPath: params.libraryPath,
      format: params.format || 'mp3',
      quality: params.quality || '320k',
      embedMetadata: params.embedMetadata !== false,
      embedArtwork: params.embedArtwork !== false,
      downloadLyrics: params.downloadLyrics !== false,
      lyricsProviders: params.lyricsProviders || ['lrclib'],
      folderStructure: params.folderStructure || 'artist/album',
      playlistFolder: !!params.playlistFolder,
      totalCount: activeTracks.length,
      completedCount: 0,
      failedCount: 0,
      tracks: activeTracks,
      createdAt: now,
      updatedAt: now,
    };

    // Store in DB
    await db.insert(downloadJobs).values({
      id: activeJob.id,
      playlistName: activeJob.playlistName,
      playlistId: playlistId,
      type: activeJob.type,
      status: 'downloading',
      libraryId: activeJob.libraryId,
      libraryPath: activeJob.libraryPath,
      format: activeJob.format,
      quality: activeJob.quality,
      embedMetadata: activeJob.embedMetadata ? 1 : 0,
      embedArtwork: activeJob.embedArtwork ? 1 : 0,
      downloadLyrics: activeJob.downloadLyrics ? 1 : 0,
      lyricsProviders: JSON.stringify(activeJob.lyricsProviders || ['lrclib']),
      folderStructure: activeJob.folderStructure,
      playlistFolder: activeJob.playlistFolder ? 1 : 0,
      totalCount: activeJob.totalCount,
      completedCount: 0,
      failedCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    if (activeTracks.length > 0) {
      // Chunk insertions for very large playlists
      const chunkSize = 100;
      for (let i = 0; i < activeTracks.length; i += chunkSize) {
        const chunk = activeTracks.slice(i, i + chunkSize);
        await db.insert(downloadTrackJobs).values(
          chunk.map((t) => ({
            id: t.id,
            jobId: t.jobId,
            title: t.title,
            artist: t.artist,
            album: t.album,
            trackNumber: t.trackNumber,
            discNumber: t.discNumber,
            releaseYear: t.releaseYear,
            duration: t.duration,
            artworkUrl: t.artworkUrl,
            sourceUrl: t.sourceUrl,
            status: 'queued' as const,
            progress: 0,
            retryCount: 0,
            error: null,
            outputPath: null,
            position: t.position,
            createdAt: now,
            updatedAt: now,
          }))
        );
      }
    }

    this.memoryJobs.set(activeJob.id, activeJob);
    this.pumpQueue();

    return activeJob;
  }

  public async getJob(jobId: string): Promise<ActiveDownloadJob | null> {
    const memory = this.memoryJobs.get(jobId);
    if (memory) return memory;

    // Fallback load from DB
    const dbJob = await db.select().from(downloadJobs).where(eq(downloadJobs.id, jobId)).limit(1);
    if (!dbJob[0]) return null;

    const tracks = await db.select().from(downloadTrackJobs)
      .where(eq(downloadTrackJobs.jobId, jobId))
      .orderBy(asc(downloadTrackJobs.position));

    const restored: ActiveDownloadJob = {
      id: dbJob[0].id,
      playlistName: dbJob[0].playlistName,
      type: dbJob[0].type,
      status: dbJob[0].status as any,
      libraryId: dbJob[0].libraryId,
      libraryPath: dbJob[0].libraryPath,
      format: dbJob[0].format,
      quality: dbJob[0].quality,
      embedMetadata: dbJob[0].embedMetadata === 1,
      embedArtwork: dbJob[0].embedArtwork === 1,
      downloadLyrics: dbJob[0].downloadLyrics === 1,
      lyricsProviders: dbJob[0].lyricsProviders ? JSON.parse(dbJob[0].lyricsProviders) : ['lrclib'],
      folderStructure: dbJob[0].folderStructure,
      playlistFolder: dbJob[0].playlistFolder === 1,
      totalCount: dbJob[0].totalCount,
      completedCount: dbJob[0].completedCount,
      failedCount: dbJob[0].failedCount,
      tracks: tracks.map((t) => ({
        id: t.id,
        jobId: t.jobId,
        title: t.title,
        artist: t.artist,
        album: t.album,
        trackNumber: t.trackNumber,
        discNumber: t.discNumber,
        releaseYear: t.releaseYear,
        duration: t.duration,
        artworkUrl: t.artworkUrl,
        sourceUrl: t.sourceUrl,
        status: t.status as any,
        progress: t.progress,
        retryCount: t.retryCount,
        error: t.error,
        outputPath: t.outputPath,
        position: t.position,
      })),
      createdAt: dbJob[0].createdAt,
      updatedAt: dbJob[0].updatedAt,
    };

    this.memoryJobs.set(restored.id, restored);
    return restored;
  }

  public async cancelJob(jobId: string): Promise<boolean> {
    const job = await this.getJob(jobId);
    if (!job) return false;

    job.status = 'cancelled';
    job.updatedAt = new Date();

    // Kill any running processes for tracks of this job
    for (const track of job.tracks) {
      const proc = this.activeChildProcesses.get(track.id);
      if (proc) {
        try {
          proc.kill('SIGKILL');
        } catch {}
        this.activeChildProcesses.delete(track.id);
      }
      if (track.status !== 'completed') {
        track.status = 'failed';
        track.error = 'Job cancelled by user';
        track.progress = 0;
      }
    }

    job.failedCount = job.tracks.filter(t => t.status === 'failed').length;

    await db.update(downloadJobs).set({
      status: 'cancelled',
      failedCount: job.failedCount,
      updatedAt: new Date(),
    }).where(eq(downloadJobs.id, jobId));

    await db.update(downloadTrackJobs).set({
      status: 'failed',
      error: 'Job cancelled by user',
      updatedAt: new Date(),
    }).where(and(eq(downloadTrackJobs.jobId, jobId), inArray(downloadTrackJobs.status, ['queued', 'searching', 'downloading', 'tagging'])));

    return true;
  }

  public async retryFailedTracks(jobId: string): Promise<boolean> {
    const job = await this.getJob(jobId);
    if (!job) return false;

    const failedTracks = job.tracks.filter(t => t.status === 'failed');
    if (failedTracks.length === 0) return true;

    for (const track of failedTracks) {
      track.status = 'queued';
      track.progress = 0;
      track.error = null;
      track.retryCount = 0;
    }

    job.status = 'downloading';
    job.failedCount = 0;
    job.updatedAt = new Date();

    await db.update(downloadJobs).set({
      status: 'downloading',
      failedCount: 0,
      updatedAt: new Date(),
    }).where(eq(downloadJobs.id, jobId));

    const failedIds = failedTracks.map(t => t.id);
    await db.update(downloadTrackJobs).set({
      status: 'queued',
      progress: 0,
      error: null,
      retryCount: 0,
      updatedAt: new Date(),
    }).where(inArray(downloadTrackJobs.id, failedIds));

    this.pumpQueue();
    return true;
  }

  private async pumpQueue() {
    if (this.isPumping) return;
    this.isPumping = true;

    try {
      while (this.activeWorkers < this.maxConcurrency) {
        // Find next queued track across all active jobs
        let nextJob: ActiveDownloadJob | null = null;
        let nextTrack: ActiveTrackJob | null = null;

        for (const job of this.memoryJobs.values()) {
          if (job.status === 'cancelled' || job.status === 'completed' || job.status === 'failed') continue;

          const candidate = job.tracks.find(t => t.status === 'queued');
          if (candidate) {
            nextJob = job;
            nextTrack = candidate;
            break;
          }
        }

        if (!nextJob || !nextTrack) {
          break; // Queue is currently empty or all tracks are running
        }

        this.activeWorkers++;
        // Start processing this track asynchronously
        this.processTrack(nextJob, nextTrack).finally(async () => {
          try {
            // Keep the worker slot occupied through job finalization. Releasing it
            // before the awaited DB/library work finishes lets another concurrent
            // pumpQueue() call start a second global pipeline too early.
            await this.checkJobCompletion(nextJob!);
          } catch (err) {
            console.error('[Downloader] Job finalization failed:', err);
          } finally {
            this.activeWorkers--;
            this.pumpQueue();
          }
        });
      }
    } finally {
      this.isPumping = false;
    }
  }

  private async checkJobCompletion(job: ActiveDownloadJob) {
    const isFinished = job.tracks.every(t => t.status === 'completed' || t.status === 'failed');
    if (isFinished && job.status === 'downloading') {
      const anySucceeded = job.tracks.some(t => t.status === 'completed');
      job.status = anySucceeded ? 'completed' : 'failed';
      job.completedCount = job.tracks.filter(t => t.status === 'completed').length;
      job.failedCount = job.tracks.filter(t => t.status === 'failed').length;
      job.updatedAt = new Date();

      await db.update(downloadJobs).set({
        status: job.status,
        completedCount: job.completedCount,
        failedCount: job.failedCount,
        updatedAt: new Date(),
      }).where(eq(downloadJobs.id, job.id));

      // Completed audio files are already incrementally indexed with canonical metadata by importSingleAudioFile.
      // Do not trigger a full disk-wide scanLibrary here, which locks SQLite and starves the server.
      if (anySucceeded && job.libraryPath) {
        console.log(`[Downloader] Download job "${job.id}" complete for library at: ${job.libraryPath}`);
      }
    }
  }

  private async processTrack(job: ActiveDownloadJob, track: ActiveTrackJob) {
    if (isCancelledJob(job)) {
      track.status = 'failed';
      track.error = 'Job cancelled by user';
      await this.persistTrackUpdate(track);
      return;
    }

    // 1. Destination formatting and canonical artist credits.
    // Preserve every artist in metadata, but use only the primary artist for the folder.
    const creditedArtists = getCreditedArtists(track.artist || 'Unknown Artist', track.artists);
    track.artist = creditedArtists.join('; ');
    track.artists = creditedArtists;
    const primaryArtist = creditedArtists[0] || 'Unknown Artist';
    const safeArtist = sanitizeFilename(primaryArtist);
    const safeTitle = sanitizeFilename(track.title || 'Unknown Title');
    const formatExt = job.format === 'opus' ? 'opus' : (job.format || 'mp3');
    const baseFilename = `${safeArtist} - ${safeTitle}`;

    const artistDir = path.join(job.libraryPath, safeArtist);
    const finalDestFile = path.join(artistDir, `${baseFilename}.${formatExt}`);
    const finalDestLrc = path.join(artistDir, `${baseFilename}.lrc`);

    // 2. Duplicate protection: Check if file already exists on disk
    try {
      if (fs.existsSync(finalDestFile)) {
        const stats = fs.statSync(finalDestFile);
        if (stats.size > 1024) {
          console.log(`[Downloader] Skipped duplicate track: "${track.artist} - ${track.title}" already exists at ${finalDestFile}`);
          
          // If lyrics sidecar missing, attempt quick fetch
          if (job.downloadLyrics && !fs.existsSync(finalDestLrc)) {
            try {
              const lyricsResult = await fetchLyrics(
                { title: track.title, artist: track.artist, album: track.album, duration: track.duration || undefined },
                job.lyricsProviders || ['lrclib']
              );
              if (lyricsResult?.synced) {
                saveLrcSidecar(finalDestFile, lyricsResult.synced);
              }
            } catch {}
          }

          if (isCancelledJob(job)) {
            track.status = 'failed';
            track.progress = 0;
            track.error = 'Job cancelled by user';
            await this.persistTrackUpdate(track);
            return;
          }

          track.status = 'completed';
          track.progress = 100;
          track.outputPath = finalDestFile;
          track.error = null;
          job.completedCount = job.tracks.filter(t => t.status === 'completed').length;
          await this.persistTrackUpdate(track);
          return;
        }
      }
    } catch (err) {
      console.warn('[Downloader] Duplicate check error:', err);
    }

    // 3. Retry loop with backoff (up to 3 attempts total: initial + 2 retries)
    const maxAttempts = 3;
    let lastError: any = null;

    const tmpJobDir = path.join(process.cwd(), 'data', 'tmp_downloads', track.id);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if ((job.status as string) === 'cancelled') {
        track.status = 'failed';
        track.error = 'Job cancelled by user';
        await this.persistTrackUpdate(track);
        return;
      }

      try {
        if (!fs.existsSync(tmpJobDir)) {
          fs.mkdirSync(tmpJobDir, { recursive: true });
        }

        track.status = 'searching';
        track.progress = 15;
        track.retryCount = attempt;
        await this.persistTrackUpdate(track);

        // Stage 2 (Downtify Architecture): YouTube Music audio matching
        let targetDownloadUrl = track.sourceUrl;
        const isAlreadyYouTube = targetDownloadUrl && 
          (targetDownloadUrl.includes('youtube.com/watch') || targetDownloadUrl.includes('youtu.be/') || targetDownloadUrl.includes('music.youtube.com/watch'));

        if (!isAlreadyYouTube) {
          try {
            const ytMatch = await matchSpotifyTrackToYouTube({
              title: track.title,
              artist: track.artist,
              album: track.album,
              duration: track.duration || undefined,
              releaseYear: track.releaseYear,
            });

            if (ytMatch && ytMatch.candidate?.url && ytMatch.score >= 40) {
              targetDownloadUrl = ytMatch.candidate.url;
              track.sourceUrl = targetDownloadUrl;
              // Persist resolved YouTube URL to database
              await db.update(downloadTrackJobs)
                .set({ sourceUrl: targetDownloadUrl, updatedAt: new Date() })
                .where(eq(downloadTrackJobs.id, track.id));

              console.log(`[Downloader Queue] Matched "${track.title}" -> ${targetDownloadUrl} (Spotify: ${track.duration || '?'}s, YT: ${ytMatch.candidate.duration}s, Diff: ${ytMatch.durationDiff}s, Score: ${ytMatch.score})`);
            } else {
              console.warn(`[Downloader Queue] No credible YouTube Music match found for "${track.title}" by "${track.artist}" (score too low or rejected)`);
            }
          } catch (matchErr: any) {
            console.warn(`[Downloader Queue] Matching error for "${track.title}":`, matchErr?.message || matchErr);
          }
        }

        // If matching failed completely and no target URL available, fail this individual track cleanly
        if (!targetDownloadUrl || targetDownloadUrl.includes('spotify.com/')) {
          track.status = 'failed';
          track.error = 'No credible matching official audio stream found for track';
          track.progress = 0;
          await this.persistTrackUpdate(track);
          await this.checkJobCompletion(job);
          return;
        }

        const ytDlpPath = await getYtDlpPath();
        const tempFileBase = path.join(tmpJobDir, `audio_${Date.now()}`);
        let downloadedAudioPath = '';

        track.status = 'downloading';
        track.progress = 35;
        await this.persistTrackUpdate(track);

        // In parallel, start fetching lyrics if requested
        let lyricsPromise: Promise<any> | null = null;
        if (job.downloadLyrics) {
          lyricsPromise = fetchLyrics(
            { title: track.title, artist: track.artist, album: track.album, duration: track.duration || undefined },
            job.lyricsProviders || ['lrclib']
          ).catch(() => null);
        }

        const possibleExtensions = ['mp3', 'm4a', 'flac', 'wav', 'opus', 'webm', 'ogg'];

        // Stage 3 (Downtify Architecture): Individual yt-dlp download of ONLY the resolved YouTube URL
        if (isPreviewMode) {
            simulateDownload(`${tempFileBase}.${formatExt}`);
        } else {
            const dlArgs = [
              '-x',
              '--audio-format', formatExt === 'opus' ? 'opus' : formatExt,
              '--audio-quality', job.quality === '128k' ? '5' : job.quality === '192k' ? '2' : '0',
              '--no-playlist',
              '--max-filesize', '100M',
              '--js-runtimes', 'node',
              '-o', `${tempFileBase}.%(ext)s`,
              targetDownloadUrl,
            ];

            await new Promise<void>((resolve, reject) => {
              const child = execFile(ytDlpPath, dlArgs, { timeout: 300000 }, (err) => {
                this.activeChildProcesses.delete(track.id);
                if (err) reject(err);
                else resolve();
              });
              this.activeChildProcesses.set(track.id, child);
            });
        }

        // Check if audio file was produced
        for (const ext of possibleExtensions) {
          const candidate = `${tempFileBase}.${ext}`;
          if (fs.existsSync(candidate) && fs.statSync(candidate).size > 1024) {
            downloadedAudioPath = candidate;
            break;
          }
        }

        if (!downloadedAudioPath || !fs.existsSync(downloadedAudioPath)) {
          throw new Error(`yt-dlp completed but audio file was not found for URL: ${targetDownloadUrl}`);
        }

        track.status = 'tagging';
        track.progress = 75;
        await this.persistTrackUpdate(track);

        // Await lyrics fetch if started
        let lyricsResult: any = null;
        if (lyricsPromise) {
          try {
            lyricsResult = await lyricsPromise;
          } catch {}
        }

        // Embed ID3 Tags if mp3
        if (job.embedMetadata && (downloadedAudioPath.endsWith('.mp3') || formatExt === 'mp3')) {
          try {
            const plainText = lyricsResult?.plain || (lyricsResult?.synced ? stripLrcTimestamps(lyricsResult.synced) : undefined);
            const tags: NodeID3.Tags = {
              title: track.title,
              artist: getCreditedArtists(track.artist, track.artists).join('; '),
              album: track.album || '',
              trackNumber: track.trackNumber ? String(track.trackNumber) : undefined,
              partOfSet: track.discNumber ? String(track.discNumber) : undefined,
              year: track.releaseYear ? String(track.releaseYear) : undefined,
            };

            if (plainText) {
              tags.unsynchronisedLyrics = {
                language: 'eng',
                text: plainText,
              };
            }

            // Artwork embedding if available
            if (job.embedArtwork && track.artworkUrl) {
              try {
                const imgRes = await fetch(track.artworkUrl);
                if (imgRes.ok) {
                  const imgBuf = Buffer.from(await imgRes.arrayBuffer());
                  let mimeType = 'image/jpeg';
                  const headerType = (imgRes.headers.get('content-type') || '').toLowerCase();
                  if (headerType.includes('png') || (imgBuf.length >= 4 && imgBuf[0] === 0x89 && imgBuf[1] === 0x50 && imgBuf[2] === 0x4E && imgBuf[3] === 0x47)) {
                    mimeType = 'image/png';
                  } else if (headerType.includes('webp') || (imgBuf.length >= 12 && imgBuf.slice(0, 4).toString() === 'RIFF' && imgBuf.slice(8, 12).toString() === 'WEBP')) {
                    mimeType = 'image/webp';
                  }

                  tags.image = {
                    mime: mimeType,
                    type: { id: 3, name: 'front cover' },
                    description: 'Cover',
                    imageBuffer: imgBuf,
                  };
                }
              } catch (artErr) {
                console.warn('[Downloader] Artwork fetch notice:', artErr);
              }
            }

            const writeOk = await NodeID3.Promise.write(tags, downloadedAudioPath);
            if (!writeOk) {
              console.warn('[Downloader] NodeID3.write reported failure for:', downloadedAudioPath);
            }
          } catch (tagErr) {
            console.warn('[Downloader] ID3 Tag embedding warning:', tagErr);
          }
        }

        // Cancellation may happen while lyrics or artwork are being fetched. Do not
        // publish a file or start downstream song processing after cancellation.
        if (isCancelledJob(job)) {
          track.status = 'failed';
          track.progress = 0;
          track.error = 'Job cancelled by user';
          try {
            await fs.promises.rm(tmpJobDir, { recursive: true, force: true });
          } catch {}
          await this.persistTrackUpdate(track);
          return;
        }

        // Ensure destination artist directory exists
        if (!fs.existsSync(artistDir)) {
          await fs.promises.mkdir(artistDir, { recursive: true });
        }

        // Move to final library destination using asynchronous copy to prevent freezing the event loop
        await fs.promises.copyFile(downloadedAudioPath, finalDestFile);

        if (isCancelledJob(job)) {
          try { await fs.promises.unlink(finalDestFile); } catch {}
          track.status = 'failed';
          track.progress = 0;
          track.error = 'Job cancelled by user';
          try {
            await fs.promises.rm(tmpJobDir, { recursive: true, force: true });
          } catch {}
          await this.persistTrackUpdate(track);
          return;
        }

        // Save LRC sidecar if lyrics available
        if (lyricsResult?.synced) {
          saveLrcSidecar(finalDestFile, lyricsResult.synced);
        }

        // Clean up temp directory asynchronously
        try {
          await fs.promises.rm(tmpJobDir, { recursive: true, force: true });
        } catch {}

        // Mark as completed!
        track.status = 'completed';
        track.progress = 100;
        track.outputPath = finalDestFile;
        track.error = null;
        job.completedCount = job.tracks.filter(t => t.status === 'completed').length;
        await this.persistTrackUpdate(track);

        console.log(`[Downloader] Successfully downloaded: "${track.artist} - ${track.title}" -> ${finalDestFile}`);
        return; // Success!
      } catch (err: any) {
        lastError = err;
        console.warn(`[Downloader] Attempt ${attempt + 1}/${maxAttempts} failed for "${track.title}":`, err?.message || err);

        try {
          if (fs.existsSync(tmpJobDir)) {
            fs.rmSync(tmpJobDir, { recursive: true, force: true });
          }
        } catch {}

        if (attempt < maxAttempts - 1 && (job.status as string) !== 'cancelled') {
          // Exponential backoff
          await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
        }
      }
    }

    // All attempts failed: Mark track failed (does NOT abort the overall job)
    track.status = 'failed';
    track.progress = 0;
    track.error = sanitizeErrorMessage(lastError?.message || 'Download failed after retries');
    job.failedCount = job.tracks.filter(t => t.status === 'failed').length;
    await this.persistTrackUpdate(track);
  }

  private async persistTrackUpdate(track: ActiveTrackJob) {
    try {
      await db.update(downloadTrackJobs).set({
        status: track.status,
        progress: track.progress,
        retryCount: track.retryCount,
        error: track.error || null,
        outputPath: track.outputPath || null,
        updatedAt: new Date(),
      }).where(eq(downloadTrackJobs.id, track.id));

      if (track.status === 'completed' && track.outputPath) {
        // Trigger standalone song processing pipeline (Demucs GPU + FFmpeg instrumental + Cloud lyrics + Library indexing)
        try {
          const jobRec = await db.select().from(downloadJobs).where(eq(downloadJobs.id, track.jobId)).limit(1);
          if (jobRec.length > 0 && jobRec[0].libraryId) {
            const libraryId = jobRec[0].libraryId;
            const { processingQueue } = await import('./processing-queue.js');

            // Persist a recoverable in-progress marker before downstream processing.
            // Startup recovery resets this transient status to queued if the server crashes.
            await db.update(downloadTrackJobs).set({
              status: 'tagging',
              updatedAt: new Date(),
            }).where(eq(downloadTrackJobs.id, track.id));

            await processingQueue.enqueue({
              downloadTrackId: track.id,
              originalAudioPath: track.outputPath,
              libraryId,
              title: track.title,
              artist: track.artist,
              artists: getCreditedArtists(track.artist, track.artists),
              album: track.album || undefined,
              duration: track.duration || undefined,
              trackNumber: track.trackNumber || undefined,
              discNumber: track.discNumber || undefined,
              releaseYear: track.releaseYear || undefined,
              artworkUrl: track.artworkUrl || undefined,
            });

            // Cancellation can arrive while the serialized Demucs/FFmpeg/indexing
            // pipeline is running. Do not overwrite the cancelled job's failed-track
            // state with completed when that in-flight pipeline eventually settles.
            if (this.memoryJobs.get(track.jobId)?.status === 'cancelled') {
              track.status = 'failed';
              track.progress = 0;
              track.error = 'Job cancelled by user';
              await db.update(downloadTrackJobs).set({
                status: 'failed',
                progress: 0,
                error: 'Job cancelled by user',
                updatedAt: new Date(),
              }).where(eq(downloadTrackJobs.id, track.id));
              await db.update(queueItems).set({ downloadStatus: 'failed' })
                .where(eq(queueItems.downloadTrackId, track.id));
              const cancelledQueues = await db.select().from(queueItems)
                .where(eq(queueItems.downloadTrackId, track.id));
              const sessionIds = Array.from(new Set(cancelledQueues.map(q => q.sessionId)));
              const { notifyQueueUpdate } = await import('../ws/index.js');
              for (const sessionId of sessionIds) notifyQueueUpdate(sessionId);
              return;
            }

            await db.update(downloadTrackJobs).set({
              status: 'completed',
              progress: 100,
              error: null,
              updatedAt: new Date(),
            }).where(eq(downloadTrackJobs.id, track.id));

            await this.linkTrackToPlaylistIfNeeded(track.jobId, track);
          }
        } catch (err: any) {
          console.error('[Downloader] Song processing failed:', err);
          track.status = 'failed';
          track.progress = 0;
          track.error = sanitizeErrorMessage(`Audio processing failed: ${err?.message || err}`);
          const failedAt = new Date();
          await db.update(downloadTrackJobs).set({
            status: 'failed',
            progress: 0,
            error: track.error,
            updatedAt: failedAt,
          }).where(eq(downloadTrackJobs.id, track.id));
          await db.update(queueItems).set({ downloadStatus: 'failed' })
            .where(eq(queueItems.downloadTrackId, track.id));
          const failedQueues = await db.select().from(queueItems)
            .where(eq(queueItems.downloadTrackId, track.id));
          const sessionIds = Array.from(new Set(failedQueues.map(q => q.sessionId)));
          const { notifyQueueUpdate } = await import('../ws/index.js');
          for (const sessionId of sessionIds) notifyQueueUpdate(sessionId);
        }
      } else if (track.status === 'failed') {
        try {
          // Update matching queue items to failed
          await db.update(queueItems).set({
            downloadStatus: 'failed'
          }).where(eq(queueItems.downloadTrackId, track.id));
          
          const matchedQueues = await db.select().from(queueItems).where(eq(queueItems.downloadTrackId, track.id));
          const sessionIds = Array.from(new Set(matchedQueues.map(q => q.sessionId)));
          
          const { notifyQueueUpdate } = await import('../ws/index.js');
          for (const sId of sessionIds) {
            notifyQueueUpdate(sId);
          }
        } catch (err) {
          console.error('[Downloader] Room queue linking failed on failure:', err);
        }
      }
    } catch (e) {
      console.error('[Downloader] Failed to persist track update to DB:', e);
    }
  }

  private async downloadAndSavePlaylistCover(coverUrl: string): Promise<string | null> {
    try {
      const res = await fetch(coverUrl);
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        const ext = coverUrl.includes('.png') ? '.png' : '.jpg';
        const filename = `playlist_${Date.now()}_${Math.random().toString(36).substring(2, 6)}${ext}`;
        const playlistCoversDir = path.join(process.cwd(), 'data', 'playlist_covers');
        if (!fs.existsSync(playlistCoversDir)) {
          fs.mkdirSync(playlistCoversDir, { recursive: true });
        }
        fs.writeFileSync(path.join(playlistCoversDir, filename), buffer);
        return filename;
      }
    } catch (err) {
      console.warn('[Downloader Queue] Failed to download playlist cover:', err);
    }
    return null;
  }

  private async linkTrackToPlaylistIfNeeded(jobId: string, track: ActiveTrackJob) {
    try {
      const jobRec = await db.select().from(downloadJobs).where(eq(downloadJobs.id, jobId)).limit(1);
      if (jobRec.length === 0 || !jobRec[0].playlistId) return;
      const playlistId = jobRec[0].playlistId;

      const matchingSongs = await db.select().from(songs).where(
        sql`LOWER(title) = LOWER(${track.title})`
      );

      const matchedSong = matchingSongs.find(s => s.title.toLowerCase() === track.title.toLowerCase()) || matchingSongs[0];
      if (matchedSong) {
        const existingAssoc = await db.select().from(playlistSongs).where(
          and(eq(playlistSongs.playlistId, playlistId), eq(playlistSongs.songId, matchedSong.id))
        ).limit(1);

        if (existingAssoc.length === 0) {
          await db.insert(playlistSongs).values({
            playlistId,
            songId: matchedSong.id,
            position: track.position,
            addedAt: new Date(),
          });
          console.log(`[Downloader Queue] Linked song ID ${matchedSong.id} ("${track.title}") to playlist ID ${playlistId} at position ${track.position}`);
        }
      }
    } catch (linkErr) {
      console.warn('[Downloader Queue] Failed to link track to playlist:', linkErr);
    }
  }
}

export const downloadQueue = new DownloadQueueManager();
