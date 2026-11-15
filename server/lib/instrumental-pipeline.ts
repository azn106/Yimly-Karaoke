import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as mm from 'music-metadata';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { artists, songArtists, songs } from '../db/schema.js';
import { separateAndCreateInstrumental, verifyValidMp3File } from './audio-separation.js';
import { CanonicalImportMetadata, extractSongMetadata } from './scanner.js';

const activeSongReplacementLocks = new Map<number, string>();

export function getDataTempBaseDir(): string {
  return process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(process.cwd(), 'data');
}

export function resolveCanonicalInstrumentalPath(
  originalAudioPath: string,
  dir?: string,
  baseName?: string
): string {
  const targetDir = dir || path.dirname(originalAudioPath);
  const resolvedBase = baseName || path.basename(originalAudioPath, path.extname(originalAudioPath));
  return path.join(targetDir, `${resolvedBase} (Instrumental).mp3`);
}

export async function getCanonicalSongArtists(
  songId: number,
  fallbackPrimaryArtist?: string | null
): Promise<string[]> {
  const rows = await db
    .select({ name: artists.name })
    .from(songArtists)
    .innerJoin(artists, eq(songArtists.artistId, artists.id))
    .where(eq(songArtists.songId, songId))
    .orderBy(asc(songArtists.position));

  const names = Array.from(new Set(rows.map((r) => r.name?.trim()).filter((n): n is string => Boolean(n))));
  if (names.length > 0) {
    return names;
  }
  const fallback = fallbackPrimaryArtist?.trim();
  return fallback ? [fallback] : [];
}

export function tryAcquireSongReplacementLockWithToken(songId: number): string | null {
  if (activeSongReplacementLocks.has(songId)) {
    return null;
  }
  const token = crypto.randomUUID();
  activeSongReplacementLocks.set(songId, token);
  return token;
}

export function releaseSongReplacementLock(songId: number, token: string): void {
  if (activeSongReplacementLocks.get(songId) === token) {
    activeSongReplacementLocks.delete(songId);
  }
}

export async function validateOriginalRecordingFile(audioPath: string): Promise<void> {
  if (!audioPath || !fs.existsSync(audioPath)) {
    throw new Error(`Original audio file does not exist: ${audioPath}`);
  }
  const stats = fs.statSync(audioPath);
  if (stats.size <= 1024) {
    throw new Error(`Original audio file is empty or too small (${stats.size} bytes): ${audioPath}`);
  }

  let parsed: mm.IAudioMetadata;
  try {
    parsed = await mm.parseFile(audioPath, { duration: true });
  } catch (err: any) {
    throw new Error(`Original audio file is unreadable or corrupt: ${err?.message || err}`);
  }

  const hasAudioInfo = Boolean(
    parsed.format?.codec ||
    parsed.format?.container ||
    parsed.format?.sampleRate ||
    parsed.format?.numberOfChannels
  );
  if (!hasAudioInfo) {
    throw new Error(`Original audio file does not contain valid audio stream metadata: ${audioPath}`);
  }
  if (parsed.format?.duration !== undefined && parsed.format.duration <= 0) {
    throw new Error(`Original audio file has zero duration: ${audioPath}`);
  }
}

export interface InstrumentalPipelineMetadata {
  title: string;
  artist: string;
  artists?: string[];
  album?: string;
  duration?: number;
  trackNumber?: number;
  discNumber?: number;
  year?: number;
  releaseYear?: number;
  artworkUrl?: string;
}

export interface GenerateInstrumentalOptions {
  originalAudioPath: string;
  targetDir: string;
  baseFilename: string;
  stagingDir?: string;
  metadata: InstrumentalPipelineMetadata;
  signal?: AbortSignal;
  isCancelled?: () => boolean;
  onProgress?: (pct: number, msg: string) => void;
}

export interface GeneratedInstrumentalResult {
  stagedInstrumentalPath: string;
  cleanup: () => void;
}

export async function generateInstrumentalFromOriginal(
  options: GenerateInstrumentalOptions
): Promise<GeneratedInstrumentalResult> {
  const baseTempRoot = options.stagingDir || path.join(getDataTempBaseDir(), 'tmp_downloads');
  const workDir = path.join(
    baseTempRoot,
    `inst_stage_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
  );
  fs.mkdirSync(workDir, { recursive: true });

  const cleanup = () => {
    try {
      if (fs.existsSync(workDir)) {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    } catch {}
  };

  const stagedInstrumentalPath = path.join(workDir, `${options.baseFilename} (Instrumental).mp3`);
  const artistTag =
    options.metadata.artist ||
    options.metadata.artists?.filter(Boolean).join(', ') ||
    '';

  try {
    const sepResult = await separateAndCreateInstrumental(
      options.originalAudioPath,
      stagedInstrumentalPath,
      {
        title: options.metadata.title,
        artist: artistTag,
        album: options.metadata.album,
        trackNumber: options.metadata.trackNumber,
        discNumber: options.metadata.discNumber,
        year: options.metadata.year ?? options.metadata.releaseYear,
      },
      options.onProgress,
      {
        signal: options.signal,
        isCancelled: options.isCancelled,
      }
    );

    if (!sepResult.ok) {
      throw new Error(sepResult.error || 'Instrumental separation failed.');
    }

    await verifyValidMp3File(stagedInstrumentalPath);

    return {
      stagedInstrumentalPath,
      cleanup,
    };
  } catch (err) {
    cleanup();
    throw err;
  }
}

interface FileBackupEntry {
  originalPath: string;
  backupPath: string | null;
  existed: boolean;
}

function createBackups(paths: Array<string | null | undefined>, backupDir: string): FileBackupEntry[] {
  const uniquePaths = Array.from(new Set(paths.filter((p): p is string => Boolean(p))));
  const backups: FileBackupEntry[] = [];
  fs.mkdirSync(backupDir, { recursive: true });

  for (let i = 0; i < uniquePaths.length; i++) {
    const originalPath = uniquePaths[i];
    if (fs.existsSync(originalPath)) {
      const backupPath = path.join(backupDir, `bak_${i}_${path.basename(originalPath)}`);
      fs.copyFileSync(originalPath, backupPath);
      backups.push({ originalPath, backupPath, existed: true });
    } else {
      backups.push({ originalPath, backupPath: null, existed: false });
    }
  }
  return backups;
}

function restoreBackups(backups: FileBackupEntry[]): void {
  for (const entry of backups) {
    try {
      if (entry.existed && entry.backupPath && fs.existsSync(entry.backupPath)) {
        const dir = path.dirname(entry.originalPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const tmpRestore = `${entry.originalPath}.restore.${Date.now()}`;
        fs.copyFileSync(entry.backupPath, tmpRestore);
        fs.renameSync(tmpRestore, entry.originalPath);
      } else if (!entry.existed && fs.existsSync(entry.originalPath)) {
        fs.unlinkSync(entry.originalPath);
      }
    } catch (restoreErr) {
      console.error(`[InstrumentalPipeline] Failed to restore backup for "${entry.originalPath}":`, restoreErr);
    }
  }
}

function atomicInstallFile(stagedPath: string, destinationPath: string): void {
  const destDir = path.dirname(destinationPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  const tmpDest = path.join(
    destDir,
    `.${path.basename(destinationPath)}.tmp.${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
  );
  try {
    fs.copyFileSync(stagedPath, tmpDest);
    fs.renameSync(tmpDest, destinationPath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpDest)) fs.unlinkSync(tmpDest);
    } catch {}
    throw err;
  }
}

export interface InstallInstrumentalOptions {
  songId: number;
  stagedInstrumentalPath: string;
  targetDir: string;
  targetFilename: string;
  canonicalMeta: CanonicalImportMetadata;
}

export async function installInstrumentalForSong(
  options: InstallInstrumentalOptions
): Promise<{ instrumentalPath: string }> {
  if (!options.targetFilename.toLowerCase().endsWith('.mp3')) {
    throw new Error(`Instrumental filename must end with .mp3, received: ${options.targetFilename}`);
  }

  await verifyValidMp3File(options.stagedInstrumentalPath);

  const existingRows = await db
    .select()
    .from(songs)
    .where(eq(songs.id, options.songId))
    .limit(1);

  if (existingRows.length === 0) {
    throw new Error(`Song with ID ${options.songId} not found.`);
  }

  const prevSong = existingRows[0];
  const finalInstrumentalPath = path.join(options.targetDir, options.targetFilename);
  const backupDir = path.join(
    getDataTempBaseDir(),
    'tmp_downloads',
    `inst_bak_${options.songId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
  );
  const backups = createBackups([finalInstrumentalPath, prevSong.instrumentalAudioPath], backupDir);

  try {
    atomicInstallFile(options.stagedInstrumentalPath, finalInstrumentalPath);
    await verifyValidMp3File(finalInstrumentalPath);

    await db
      .update(songs)
      .set({ instrumentalAudioPath: finalInstrumentalPath })
      .where(eq(songs.id, options.songId));

    if (
      prevSong.instrumentalAudioPath &&
      prevSong.instrumentalAudioPath !== finalInstrumentalPath &&
      fs.existsSync(prevSong.instrumentalAudioPath)
    ) {
      try {
        fs.unlinkSync(prevSong.instrumentalAudioPath);
      } catch {}
    }

    return { instrumentalPath: finalInstrumentalPath };
  } catch (err) {
    restoreBackups(backups);
    try {
      await db
        .update(songs)
        .set({ instrumentalAudioPath: prevSong.instrumentalAudioPath })
        .where(eq(songs.id, options.songId));
    } catch (dbRestoreErr) {
      console.error('[InstrumentalPipeline] Failed to rollback instrumental DB path:', dbRestoreErr);
    }
    throw err;
  } finally {
    try {
      if (fs.existsSync(backupDir)) {
        fs.rmSync(backupDir, { recursive: true, force: true });
      }
    } catch {}
  }
}

export interface InstallRecordingBundleOptions {
  songId: number;
  stagedMainPath: string;
  stagedInstrumentalPath: string;
  targetDir: string;
  baseFilename: string;
  mainExtension: string;
  canonicalMeta: CanonicalImportMetadata;
  afterDbAndScannerCommit?: () => Promise<void>;
}

export async function installRecordingBundleForSong(
  options: InstallRecordingBundleOptions
): Promise<{ mainAudioPath: string; instrumentalAudioPath: string }> {
  await validateOriginalRecordingFile(options.stagedMainPath);
  await verifyValidMp3File(options.stagedInstrumentalPath);

  const existingRows = await db
    .select()
    .from(songs)
    .where(eq(songs.id, options.songId))
    .limit(1);

  if (existingRows.length === 0) {
    throw new Error(`Song with ID ${options.songId} not found.`);
  }

  const prevSong = existingRows[0];
  const ext = options.mainExtension.replace(/^\./, '').trim().toLowerCase() || 'mp3';
  const finalMainPath = path.join(options.targetDir, `${options.baseFilename}.${ext}`);
  const finalInstrumentalPath = path.join(options.targetDir, `${options.baseFilename} (Instrumental).mp3`);

  const backupDir = path.join(
    getDataTempBaseDir(),
    'tmp_downloads',
    `bundle_bak_${options.songId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
  );
  const backups = createBackups(
    [finalMainPath, finalInstrumentalPath, prevSong.mainAudioPath, prevSong.instrumentalAudioPath],
    backupDir
  );

  try {
    atomicInstallFile(options.stagedMainPath, finalMainPath);
    atomicInstallFile(options.stagedInstrumentalPath, finalInstrumentalPath);

    await validateOriginalRecordingFile(finalMainPath);
    await verifyValidMp3File(finalInstrumentalPath);

    const extracted = await extractSongMetadata(finalMainPath);
    const stats = fs.statSync(finalMainPath);

    await db
      .update(songs)
      .set({
        mainAudioPath: finalMainPath,
        instrumentalAudioPath: finalInstrumentalPath,
        variant: 'original',
        fileSize: extracted.fileSize || stats.size,
        format: extracted.format || ext,
        duration: extracted.duration || prevSong.duration || options.canonicalMeta.duration || 0,
      })
      .where(eq(songs.id, options.songId));

    if (options.afterDbAndScannerCommit) {
      await options.afterDbAndScannerCommit();
    }

    if (
      prevSong.mainAudioPath &&
      prevSong.mainAudioPath !== finalMainPath &&
      fs.existsSync(prevSong.mainAudioPath)
    ) {
      try {
        fs.unlinkSync(prevSong.mainAudioPath);
      } catch {}
    }
    if (
      prevSong.instrumentalAudioPath &&
      prevSong.instrumentalAudioPath !== finalInstrumentalPath &&
      fs.existsSync(prevSong.instrumentalAudioPath)
    ) {
      try {
        fs.unlinkSync(prevSong.instrumentalAudioPath);
      } catch {}
    }

    return {
      mainAudioPath: finalMainPath,
      instrumentalAudioPath: finalInstrumentalPath,
    };
  } catch (err) {
    restoreBackups(backups);
    try {
      await db
        .update(songs)
        .set({
          mainAudioPath: prevSong.mainAudioPath,
          instrumentalAudioPath: prevSong.instrumentalAudioPath,
          variant: prevSong.variant,
          fileSize: prevSong.fileSize,
          format: prevSong.format,
          duration: prevSong.duration,
        })
        .where(eq(songs.id, options.songId));
    } catch (dbRestoreErr) {
      console.error('[InstrumentalPipeline] Failed to rollback recording bundle DB row:', dbRestoreErr);
    }
    throw err;
  } finally {
    try {
      if (fs.existsSync(backupDir)) {
        fs.rmSync(backupDir, { recursive: true, force: true });
      }
    } catch {}
  }
}
