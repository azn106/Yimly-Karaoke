import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as mm from 'music-metadata';
import { db } from '../db/index.js';
import { songs, artists, albums, songArtists } from '../db/schema.js';
import { eq, asc } from 'drizzle-orm';
import {
  separateAndCreateInstrumental,
  verifyValidMp3File,
} from './audio-separation.js';
import { importSingleAudioFile, CanonicalImportMetadata } from './scanner.js';
import { getSettings } from '../karaoke-sync-config.js';

const execFileAsync = promisify(execFile);

const activeSongReplacementLocks = new Map<number, symbol>();
const activeSongInstallations = new Set<number>();

export function tryAcquireSongReplacementLockWithToken(songId: number): symbol | null {
  if (activeSongReplacementLocks.has(songId)) {
    return null;
  }
  const token = Symbol(`song-replacement-lock-${songId}`);
  activeSongReplacementLocks.set(songId, token);
  return token;
}

export function tryAcquireSongReplacementLock(songId: number): boolean {
  return tryAcquireSongReplacementLockWithToken(songId) !== null;
}

export function releaseSongReplacementLock(songId: number, ownerToken?: symbol): void {
  if (ownerToken !== undefined && activeSongReplacementLocks.get(songId) !== ownerToken) {
    return;
  }
  activeSongReplacementLocks.delete(songId);
}

export function isSongReplacementLocked(songId: number): boolean {
  return activeSongReplacementLocks.has(songId);
}

export function isSongInstallationActive(songId: number): boolean {
  return activeSongInstallations.has(songId);
}

export function getDataTempBaseDir(): string {
  return process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(process.cwd(), 'data');
}

export function resolveCanonicalInstrumentalPath(
  originalAudioPath: string,
  targetDir?: string,
  baseFilename?: string
): string {
  const dir = targetDir || path.dirname(originalAudioPath);
  const rawBase =
    baseFilename || path.basename(originalAudioPath, path.extname(originalAudioPath));
  return path.join(dir, `${rawBase} (Instrumental).mp3`);
}

export function copyFileAtomic(srcPath: string, destPath: string): void {
  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  const tempDest = `${destPath}.tmp_commit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  try {
    fs.copyFileSync(srcPath, tempDest);
    if (!fs.existsSync(tempDest) || fs.statSync(tempDest).size <= 1024) {
      throw new Error(`Atomic file copy validation failed for destination: ${destPath}`);
    }
    fs.renameSync(tempDest, destPath);
  } catch (err) {
    try {
      if (fs.existsSync(tempDest)) fs.unlinkSync(tempDest);
    } catch {}
    throw err;
  }
}

/**
 * Validates that an original recording file exists, is non-trivial in size,
 * and contains a readable audio stream/container.
 */
export async function validateOriginalRecordingFile(audioPath: string): Promise<void> {
  if (!audioPath || typeof audioPath !== 'string' || !fs.existsSync(audioPath)) {
    throw new Error(`Original recording file not found: ${audioPath}`);
  }
  const stats = fs.statSync(audioPath);
  if (!stats.isFile() || stats.size <= 1024) {
    throw new Error(
      `Original recording file is empty or too small (${stats.size} bytes): ${audioPath}`
    );
  }

  let hasValidAudio = false;
  try {
    const metadata = await mm.parseFile(audioPath, { duration: true });
    if (
      metadata.format.container ||
      metadata.format.codec ||
      (metadata.format.sampleRate && metadata.format.sampleRate > 0) ||
      (metadata.format.duration && metadata.format.duration > 0)
    ) {
      hasValidAudio = true;
    }
  } catch {
    // Fall through to ffprobe verification
  }

  if (!hasValidAudio) {
    try {
      const ffmpegPath = getSettings().ffmpegPath;
      const ffprobePath =
        ffmpegPath && ffmpegPath !== 'ffmpeg' && /ffmpeg(\.exe)?$/i.test(ffmpegPath)
          ? ffmpegPath.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1')
          : 'ffprobe';
      const { stdout } = await execFileAsync(ffprobePath, [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=codec_type',
        '-of',
        'csv=p=0',
        audioPath,
      ]);
      if (stdout && stdout.trim().toLowerCase().includes('audio')) {
        hasValidAudio = true;
      }
    } catch {
      // Invalid audio
    }
  }

  if (!hasValidAudio) {
    throw new Error(`Original recording file does not contain valid audio: ${audioPath}`);
  }
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
  const names = rows.map((r) => r.name).filter(Boolean);
  if (names.length > 0) return names;
  return [fallbackPrimaryArtist || 'Unknown Artist'];
}

export interface CanonicalInstrumentalMetadata {
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
  baseFilename?: string;
  metadata: CanonicalInstrumentalMetadata;
  stagingDir?: string;
  onProgress?: (pct: number, msg: string) => void;
  onLog?: (level: 'INFO' | 'WARN' | 'ERR', msg: string) => void;
  signal?: AbortSignal;
  isCancelled?: () => boolean;
}

export interface GeneratedInstrumentalResult {
  stagedInstrumentalPath: string;
  stagingDir: string;
  ownsStagingDir: boolean;
  canonicalInstrumentalFilename: string;
  cleanup: () => void;
  cudaDevice?: string;
}

/**
 * Shared AI instrumental-generation pipeline used by New Song, Regenerate Instrumental,
 * and Replace Audio.
 *
 * 1. Validates the original recording.
 * 2. Runs Demucs through the single shared serialization lock.
 * 3. Encodes instrumental as 320 kbps MP3 via FFmpeg into an isolated staging file.
 * 4. Applies canonical instrumental metadata & YIMLY_VARIANT=instrumental tag.
 * 5. Validates the staged MP3 using verifyValidMp3File().
 * 6. Cleans up temporary files cleanly on success, failure, or timeout.
 */
export async function generateInstrumentalFromOriginal(
  options: GenerateInstrumentalOptions
): Promise<GeneratedInstrumentalResult> {
  const {
    originalAudioPath,
    baseFilename: providedBase,
    metadata,
    onProgress,
    onLog,
    signal,
    isCancelled,
  } = options;

  if (signal?.aborted || isCancelled?.()) {
    throw new Error('Instrumental generation cancelled.');
  }

  // 1. Validate original recording (does not mutate original recording)
  await validateOriginalRecordingFile(originalAudioPath);

  const ownsStagingDir = !options.stagingDir;
  const stagingDir =
    options.stagingDir ||
    path.join(
      getDataTempBaseDir(),
      `tmp_inst_stage_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    );

  if (!fs.existsSync(stagingDir)) {
    fs.mkdirSync(stagingDir, { recursive: true });
  }

  const baseName =
    providedBase ||
    path.basename(originalAudioPath, path.extname(originalAudioPath));
  const canonicalInstrumentalFilename = `${baseName} (Instrumental).mp3`;
  const stagedInstrumentalPath = path.join(stagingDir, canonicalInstrumentalFilename);

  const cleanup = () => {
    try {
      if (ownsStagingDir) {
        if (fs.existsSync(stagingDir)) {
          fs.rmSync(stagingDir, { recursive: true, force: true });
        }
      } else if (fs.existsSync(stagedInstrumentalPath)) {
        fs.unlinkSync(stagedInstrumentalPath);
      }
    } catch {}
  };

  try {
    const artistTag =
      metadata.artists && metadata.artists.length > 0
        ? metadata.artists.join('; ')
        : metadata.artist || 'Unknown Artist';

    // 2–4. Demucs separation (shared lock) + FFmpeg 320k MP3 encoding + Yimly tags + MP3 check
    const sepResult = await separateAndCreateInstrumental(
      originalAudioPath,
      stagedInstrumentalPath,
      {
        title: metadata.title || 'Unknown Title',
        artist: artistTag,
        album: metadata.album || '',
        trackNumber: metadata.trackNumber,
        discNumber: metadata.discNumber,
        year: metadata.year ?? metadata.releaseYear,
      },
      onProgress,
      { signal, isCancelled, onLog }
    );

    const producedPath = sepResult.instrumentalPath || stagedInstrumentalPath;
    if (!sepResult.ok) {
      throw new Error(sepResult.error || 'Instrumental separation failed.');
    }

    if (!producedPath.toLowerCase().endsWith('.mp3')) {
      throw new Error(`Generated instrumental must use .mp3 extension, got: ${producedPath}`);
    }

    // 5. Explicit MP3 verification before handing back staged asset
    await verifyValidMp3File(producedPath);

    return {
      stagedInstrumentalPath: producedPath,
      stagingDir,
      ownsStagingDir,
      canonicalInstrumentalFilename,
      cleanup,
      cudaDevice: sepResult.cudaDevice,
    };
  } catch (err) {
    cleanup();
    throw err;
  }
}

export interface InstallInstrumentalOptions {
  songId: number;
  stagedInstrumentalPath: string;
  targetDir?: string;
  targetFilename?: string;
  canonicalMeta?: CanonicalImportMetadata;
  /** Optional hook executed before committing final DB/scanner update (e.g. for testing rollback) */
  beforeDbCommit?: () => Promise<void>;
}

export interface InstallInstrumentalResult {
  songId: number;
  instrumentalPath: string;
  mainAudioPath: string | null;
}

/**
 * Shared instrumental installation service:
 * - Per-song concurrent installation protection
 * - Staged MP3 validation
 * - Backup of previous instrumental & pre-existing target
 * - Atomic copy + post-install MP3 verification
 * - DB update & scanner registration/verification
 * - Cleanup of superseded files only after verification succeeds
 * - Full filesystem & DB rollback on any failure
 */
export async function installInstrumentalForSong(
  options: InstallInstrumentalOptions
): Promise<InstallInstrumentalResult> {
  const { songId, stagedInstrumentalPath, targetDir: explicitDir, targetFilename, canonicalMeta, beforeDbCommit } =
    options;

  if (activeSongInstallations.has(songId)) {
    throw new Error(`Concurrent instrumental installation already in progress for song #${songId}`);
  }

  activeSongInstallations.add(songId);
  try {
    // 1. Validate staged MP3 before touching existing library files or DB
    if (!stagedInstrumentalPath.toLowerCase().endsWith('.mp3')) {
      throw new Error(`Staged instrumental must be a .mp3 file: ${stagedInstrumentalPath}`);
    }
    await verifyValidMp3File(stagedInstrumentalPath);

    // 2. Fetch authoritative DB state
    const songRec = await db
      .select({
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
    const songArtistNames = await getCanonicalSongArtists(songId, song.artist);
    const primaryArtistName = song.artist || songArtistNames[0] || 'Unknown Artist';

    const targetDir =
      explicitDir ||
      (song.mainAudioPath
        ? path.dirname(song.mainAudioPath)
        : song.instrumentalAudioPath
          ? path.dirname(song.instrumentalAudioPath)
          : undefined);

    if (!targetDir) {
      throw new Error(`Cannot determine target library directory for song #${songId}`);
    }
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    let finalInstPath: string;
    if (targetFilename) {
      const normalizedName = targetFilename.toLowerCase().endsWith('.mp3')
        ? targetFilename
        : `${path.basename(targetFilename, path.extname(targetFilename))}.mp3`;
      finalInstPath = path.join(targetDir, normalizedName);
    } else if (song.mainAudioPath) {
      finalInstPath = resolveCanonicalInstrumentalPath(song.mainAudioPath, targetDir);
    } else {
      const stagedBase = path.basename(stagedInstrumentalPath, path.extname(stagedInstrumentalPath));
      const baseWithMarker = stagedBase.toLowerCase().includes('instrumental')
        ? stagedBase
        : `${stagedBase} (Instrumental)`;
      finalInstPath = path.join(targetDir, `${baseWithMarker}.mp3`);
    }

    const oldInstPath = song.instrumentalAudioPath;
    const stamp = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const backupInst =
      oldInstPath && fs.existsSync(oldInstPath) ? `${oldInstPath}.bak_${stamp}` : null;
    const backupDestInst =
      finalInstPath !== oldInstPath && fs.existsSync(finalInstPath)
        ? `${finalInstPath}.destbak_${stamp}`
        : null;

    try {
      if (backupInst && oldInstPath) {
        fs.copyFileSync(oldInstPath, backupInst);
      }
      if (backupDestInst) {
        fs.copyFileSync(finalInstPath, backupDestInst);
      }

      // 3. Atomic copy + post-install MP3 verification
      copyFileAtomic(stagedInstrumentalPath, finalInstPath);
      await verifyValidMp3File(finalInstPath);

      if (beforeDbCommit) {
        await beforeDbCommit();
      }

      // 4. Database update
      await db
        .update(songs)
        .set({
          instrumentalAudioPath: finalInstPath,
        })
        .where(eq(songs.id, songId));

      // 5. Scanner registration & verification
      const resolvedMeta: CanonicalImportMetadata = {
        title: canonicalMeta?.title || song.title,
        artist: canonicalMeta?.artist || primaryArtistName,
        artists: canonicalMeta?.artists?.length ? canonicalMeta.artists : songArtistNames,
        album: canonicalMeta?.album ?? (song.album || undefined),
        duration: canonicalMeta?.duration,
        trackNumber: canonicalMeta?.trackNumber,
        discNumber: canonicalMeta?.discNumber,
        year: canonicalMeta?.year,
        artworkUrl: canonicalMeta?.artworkUrl,
      };

      const importedRows = await importSingleAudioFile(
        song.libraryId,
        finalInstPath,
        resolvedMeta
      );

      const postRows = await db.select().from(songs).where(eq(songs.id, songId)).limit(1);
      const registeredRow = postRows[0] || importedRows?.[0];

      if (
        !importedRows ||
        importedRows.length === 0 ||
        !registeredRow ||
        registeredRow.id !== songId ||
        registeredRow.instrumentalAudioPath !== finalInstPath
      ) {
        throw new Error('Library registration failed to update instrumental MP3 path in database.');
      }

      // Preserve main audio format if already recorded
      if (song.format && registeredRow.format !== song.format) {
        await db
          .update(songs)
          .set({ format: song.format })
          .where(eq(songs.id, songId));
      }

      // 6. Clean up backups & superseded instrumental file ONLY after full verification
      if (backupInst && fs.existsSync(backupInst)) {
        try {
          fs.unlinkSync(backupInst);
        } catch {}
      }
      if (backupDestInst && fs.existsSync(backupDestInst)) {
        try {
          fs.unlinkSync(backupDestInst);
        } catch {}
      }
      if (
        oldInstPath &&
        path.resolve(oldInstPath) !== path.resolve(finalInstPath) &&
        fs.existsSync(oldInstPath)
      ) {
        try {
          fs.unlinkSync(oldInstPath);
        } catch {}
      }

      return {
        songId,
        instrumentalPath: finalInstPath,
        mainAudioPath: registeredRow.mainAudioPath,
      };
    } catch (commitErr) {
      // Complete filesystem & DB rollback
      if (backupDestInst && fs.existsSync(backupDestInst)) {
        try {
          fs.copyFileSync(backupDestInst, finalInstPath);
          fs.unlinkSync(backupDestInst);
        } catch {}
      } else if (finalInstPath !== oldInstPath && fs.existsSync(finalInstPath)) {
        try {
          fs.unlinkSync(finalInstPath);
        } catch {}
      }

      if (backupInst && fs.existsSync(backupInst) && oldInstPath) {
        try {
          fs.copyFileSync(backupInst, oldInstPath);
          fs.unlinkSync(backupInst);
        } catch {}
      }

      try {
        await db
          .update(songs)
          .set({
            mainAudioPath: song.mainAudioPath,
            instrumentalAudioPath: oldInstPath,
            format: song.format,
            variant: song.variant,
            fileSize: song.fileSize,
          })
          .where(eq(songs.id, songId));
      } catch {}

      throw commitErr;
    }
  } finally {
    activeSongInstallations.delete(songId);
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

export interface InstallRecordingBundleResult {
  songId: number;
  mainAudioPath: string;
  instrumentalAudioPath: string;
}

/**
 * Atomically installs both a replacement main recording (preserving its genuine format
 * and extension) and a newly generated MP3 instrumental for an existing song, with full
 * backup and rollback across filesystem and database if any step fails.
 */
export async function installRecordingBundleForSong(
  options: InstallRecordingBundleOptions
): Promise<InstallRecordingBundleResult> {
  const {
    songId,
    stagedMainPath,
    stagedInstrumentalPath,
    targetDir,
    baseFilename,
    mainExtension,
    canonicalMeta,
    afterDbAndScannerCommit,
  } = options;

  if (activeSongInstallations.has(songId)) {
    throw new Error(`Concurrent installation already in progress for song #${songId}`);
  }

  activeSongInstallations.add(songId);
  try {
    await validateOriginalRecordingFile(stagedMainPath);
    if (!stagedInstrumentalPath.toLowerCase().endsWith('.mp3')) {
      throw new Error(`Staged instrumental must use .mp3 extension: ${stagedInstrumentalPath}`);
    }
    await verifyValidMp3File(stagedInstrumentalPath);

    const songRec = await db
      .select({
        id: songs.id,
        libraryId: songs.libraryId,
        mainAudioPath: songs.mainAudioPath,
        instrumentalAudioPath: songs.instrumentalAudioPath,
        fileSize: songs.fileSize,
        format: songs.format,
        variant: songs.variant,
      })
      .from(songs)
      .where(eq(songs.id, songId))
      .limit(1);

    if (songRec.length === 0) {
      throw new Error(`Song with ID ${songId} not found in library.`);
    }

    const song = songRec[0];
    const oldMainPath = song.mainAudioPath;
    const oldInstPath = song.instrumentalAudioPath;

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const cleanExt = mainExtension.replace(/^\./, '').toLowerCase() || 'mp3';
    const finalMainPath = path.join(targetDir, `${baseFilename}.${cleanExt}`);
    const finalInstPath = path.join(targetDir, `${baseFilename} (Instrumental).mp3`);
    const origStats = fs.statSync(stagedMainPath);

    const stamp = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const backupMain =
      oldMainPath && fs.existsSync(oldMainPath) ? `${oldMainPath}.bak_${stamp}` : null;
    const backupInst =
      oldInstPath && fs.existsSync(oldInstPath) ? `${oldInstPath}.bak_${stamp}` : null;
    const backupDestMain =
      finalMainPath !== oldMainPath && fs.existsSync(finalMainPath)
        ? `${finalMainPath}.destbak_${stamp}`
        : null;
    const backupDestInst =
      finalInstPath !== oldInstPath && fs.existsSync(finalInstPath)
        ? `${finalInstPath}.destbak_${stamp}`
        : null;

    try {
      if (backupMain && oldMainPath) fs.copyFileSync(oldMainPath, backupMain);
      if (backupInst && oldInstPath) fs.copyFileSync(oldInstPath, backupInst);
      if (backupDestMain) fs.copyFileSync(finalMainPath, backupDestMain);
      if (backupDestInst) fs.copyFileSync(finalInstPath, backupDestInst);

      copyFileAtomic(stagedMainPath, finalMainPath);
      copyFileAtomic(stagedInstrumentalPath, finalInstPath);

      await validateOriginalRecordingFile(finalMainPath);
      await verifyValidMp3File(finalInstPath);

      await db
        .update(songs)
        .set({
          mainAudioPath: finalMainPath,
          instrumentalAudioPath: finalInstPath,
          fileSize: origStats.size,
          format: cleanExt,
          variant: 'original',
        })
        .where(eq(songs.id, songId));

      const importedMain = await importSingleAudioFile(
        song.libraryId,
        finalMainPath,
        canonicalMeta
      );
      const importedInst = await importSingleAudioFile(
        song.libraryId,
        finalInstPath,
        canonicalMeta
      );

      const postRows = await db.select().from(songs).where(eq(songs.id, songId)).limit(1);
      const registeredRow = postRows[0] || importedInst?.[0] || importedMain?.[0];

      if (
        !registeredRow ||
        registeredRow.id !== songId ||
        registeredRow.mainAudioPath !== finalMainPath ||
        registeredRow.instrumentalAudioPath !== finalInstPath
      ) {
        throw new Error(
          'Library registration failed to link replacement main and MP3 instrumental paths.'
        );
      }

      if (afterDbAndScannerCommit) {
        await afterDbAndScannerCommit();
      }

      if (backupMain && fs.existsSync(backupMain)) try { fs.unlinkSync(backupMain); } catch {}
      if (backupInst && fs.existsSync(backupInst)) try { fs.unlinkSync(backupInst); } catch {}
      if (backupDestMain && fs.existsSync(backupDestMain)) try { fs.unlinkSync(backupDestMain); } catch {}
      if (backupDestInst && fs.existsSync(backupDestInst)) try { fs.unlinkSync(backupDestInst); } catch {}

      if (
        oldMainPath &&
        path.resolve(oldMainPath) !== path.resolve(finalMainPath) &&
        fs.existsSync(oldMainPath)
      ) {
        try { fs.unlinkSync(oldMainPath); } catch {}
      }
      if (
        oldInstPath &&
        path.resolve(oldInstPath) !== path.resolve(finalInstPath) &&
        fs.existsSync(oldInstPath)
      ) {
        try { fs.unlinkSync(oldInstPath); } catch {}
      }

      return {
        songId,
        mainAudioPath: finalMainPath,
        instrumentalAudioPath: finalInstPath,
      };
    } catch (commitErr) {
      if (backupDestMain && fs.existsSync(backupDestMain)) {
        try { fs.copyFileSync(backupDestMain, finalMainPath); fs.unlinkSync(backupDestMain); } catch {}
      } else if (finalMainPath !== oldMainPath && fs.existsSync(finalMainPath)) {
        try { fs.unlinkSync(finalMainPath); } catch {}
      }

      if (backupDestInst && fs.existsSync(backupDestInst)) {
        try { fs.copyFileSync(backupDestInst, finalInstPath); fs.unlinkSync(backupDestInst); } catch {}
      } else if (finalInstPath !== oldInstPath && fs.existsSync(finalInstPath)) {
        try { fs.unlinkSync(finalInstPath); } catch {}
      }

      if (backupMain && fs.existsSync(backupMain) && oldMainPath) {
        try { fs.copyFileSync(backupMain, oldMainPath); fs.unlinkSync(backupMain); } catch {}
      }
      if (backupInst && fs.existsSync(backupInst) && oldInstPath) {
        try { fs.copyFileSync(backupInst, oldInstPath); fs.unlinkSync(backupInst); } catch {}
      }

      try {
        await db
          .update(songs)
          .set({
            mainAudioPath: oldMainPath,
            instrumentalAudioPath: oldInstPath,
            fileSize: song.fileSize,
            format: song.format,
            variant: song.variant,
          })
          .where(eq(songs.id, songId));
      } catch {}

      throw commitErr;
    }
  } finally {
    activeSongInstallations.delete(songId);
  }
}
