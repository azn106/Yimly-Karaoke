import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { execFile, exec, ChildProcess } from 'child_process';
import NodeID3 from 'node-id3';
import { db } from '../db/index.js';
import { downloadJobs, downloadTrackJobs, libraries, settings, queueItems } from '../db/schema.js';
import { eq, and, asc, inArray, sql } from 'drizzle-orm';
import { scanLibrary } from './scanner.js';
import { fetchLyrics, saveLrcSidecar, stripLrcTimestamps } from './lyrics.js';
import { matchSpotifyTrackToYouTube } from './youtube-matcher.js';

const execFilePromise = promisify(execFile);
const execPromise = promisify(exec);

export interface TrackMetadata {
  id?: string;
  title: string;
  artist: string;
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
  playlistName?: string;
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

export function sanitizeFilename(str: string): string {
  if (!str) return 'Unknown';
  const cleaned = str.replace(/[/\\?%*:|"<>]/g, '').trim().replace(/^\.+|\.+$/g, '');
  return cleaned || 'Unknown';
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
  private maxConcurrency: number = 4;
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

  public setConcurrency(concurrency: number) {
    if (concurrency >= 1 && concurrency <= 16) {
      this.maxConcurrency = concurrency;
    }
  }

  public getConcurrency(): number {
    return this.maxConcurrency;
  }

  public async init() {
    if (this.initialized) return;
    this.initialized = true;

    try {
      // Read custom concurrency setting if stored
      const concSetting = await db.select().from(settings).where(eq(settings.key, 'downloader_concurrency')).limit(1);
      if (concSetting[0]?.value) {
        const val = parseInt(concSetting[0].value, 10);
        if (!isNaN(val) && val >= 1 && val <= 16) {
          this.maxConcurrency = val;
        }
      }

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

    const activeJob: ActiveDownloadJob = {
      id: jobId,
      playlistName: params.playlistName || null,
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
        this.processTrack(nextJob, nextTrack).finally(() => {
          this.activeWorkers--;
          this.checkJobCompletion(nextJob!);
          this.pumpQueue();
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

      // Trigger automatic background library scan on completion
      if (anySucceeded && job.libraryPath) {
        console.log(`[Downloader] Download job "${job.id}" complete. Triggering library auto-scan at: ${job.libraryPath}`);
        try {
          const allLibs = await db.select().from(libraries);
          const matchedLib = allLibs.find(l => l.path === job.libraryPath) || allLibs[0];
          if (matchedLib) {
            scanLibrary(matchedLib.id, job.libraryPath).catch(err => {
              console.error('[Downloader] Auto-scan error:', err);
            });
          }
        } catch (scanErr) {
          console.error('[Downloader] Auto-scan trigger failed:', scanErr);
        }
      }
    }
  }

  private async processTrack(job: ActiveDownloadJob, track: ActiveTrackJob) {
    if (job.status === 'cancelled') {
      track.status = 'failed';
      track.error = 'Job cancelled by user';
      await this.persistTrackUpdate(track);
      return;
    }

    // 1. Destination formatting
    const safeArtist = sanitizeFilename(track.artist || 'Unknown Artist');
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

            if (ytMatch && ytMatch.candidate?.url) {
              targetDownloadUrl = ytMatch.candidate.url;
              track.sourceUrl = targetDownloadUrl;
              // Persist resolved YouTube URL to database
              await db.update(downloadTrackJobs)
                .set({ sourceUrl: targetDownloadUrl, updatedAt: new Date() })
                .where(eq(downloadTrackJobs.id, track.id));

              console.log(`[Downloader Queue] Matched "${track.title}" -> ${targetDownloadUrl} (Spotify: ${track.duration || '?'}s, YT: ${ytMatch.candidate.duration}s, Diff: ${ytMatch.durationDiff}s, Score: ${ytMatch.score})`);
            } else {
              console.warn(`[Downloader Queue] No YouTube Music match found for "${track.title}" by "${track.artist}"`);
            }
          } catch (matchErr: any) {
            console.warn(`[Downloader Queue] Matching error for "${track.title}":`, matchErr?.message || matchErr);
          }
        }

        // If matching failed completely and no target URL available, fail this individual track cleanly
        if (!targetDownloadUrl || targetDownloadUrl.includes('spotify.com/')) {
          track.status = 'failed';
          track.error = 'No matching YouTube Music audio stream found for track';
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
          const child = execFile(ytDlpPath, dlArgs, (err) => {
            this.activeChildProcesses.delete(track.id);
            if (err) reject(err);
            else resolve();
          });
          this.activeChildProcesses.set(track.id, child);
        });

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
              artist: track.artist,
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
                  tags.image = {
                    mime: 'image/jpeg',
                    type: { id: 3, name: 'front cover' },
                    description: 'Cover',
                    imageBuffer: imgBuf,
                  };
                }
              } catch {}
            }

            NodeID3.write(tags, downloadedAudioPath);
          } catch (tagErr) {
            console.warn('[Downloader] ID3 Tag embedding warning:', tagErr);
          }
        }

        // Ensure destination artist directory exists
        if (!fs.existsSync(artistDir)) {
          fs.mkdirSync(artistDir, { recursive: true });
        }

        // Move to final library destination
        fs.copyFileSync(downloadedAudioPath, finalDestFile);

        // Save LRC sidecar if lyrics available
        if (lyricsResult?.synced) {
          saveLrcSidecar(finalDestFile, lyricsResult.synced);
        }

        // Clean up temp directory
        try {
          if (fs.existsSync(tmpJobDir)) {
            fs.rmSync(tmpJobDir, { recursive: true, force: true });
          }
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
            const { processDownloadedSong } = await import('./song-processor.js');

            // Fire processing asynchronously; processDownloadedSong manages PROCESSING -> READY / FAILED
            processDownloadedSong({
              downloadTrackId: track.id,
              originalAudioPath: track.outputPath,
              libraryId,
              title: track.title,
              artist: track.artist,
              album: track.album || undefined,
              duration: track.duration || undefined,
            }).catch(err => {
              console.error('[Downloader] Song processing trigger error:', err);
            });
          }
        } catch (err) {
          console.error('[Downloader] Failed to initiate song processing:', err);
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
}

export const downloadQueue = new DownloadQueueManager();
