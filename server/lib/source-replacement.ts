import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';
import NodeID3 from 'node-id3';
import { db } from '../db/index.js';
import { songs, artists, albums, songVerifiedSources } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { getYtDlpPath, sanitizeFilename, getCreditedArtists } from './download-queue.js';
import { separateAndCreateInstrumental } from './audio-separation.js';
import { importSingleAudioFile } from './scanner.js';
import { isPreviewMode, simulateDownload } from './preview-mode.js';

const execFilePromise = promisify(execFile);

export interface ReplaceSourceResult {
  success: boolean;
  message: string;
  songId: number;
  originalPath?: string;
  instrumentalPath?: string;
  error?: string;
}

/**
 * Replace song recording source using a verified YouTube URL, re-downloading,
 * running instrumental separation, validating safely, and updating files atomically.
 */
export async function replaceSongRecordingSource(songId: number, youtubeUrl: string): Promise<ReplaceSourceResult> {
  if (!youtubeUrl || !youtubeUrl.trim()) {
    throw new Error('A valid YouTube URL is required to replace the recording source.');
  }

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

  // 2. Save or update verified source record in song_verified_sources
  try {
    await db.insert(songVerifiedSources).values({
      songId,
      youtubeUrl: youtubeUrl.trim(),
      videoId: extractYouTubeVideoId(youtubeUrl.trim()),
      sourceTitle: song.title,
      sourceArtist: song.artist || 'Unknown Artist',
      verified: 1,
      verifiedAt: now,
    })
    .onConflictDoUpdate({
      target: songVerifiedSources.songId,
      set: {
        youtubeUrl: youtubeUrl.trim(),
        videoId: extractYouTubeVideoId(youtubeUrl.trim()),
        verified: 1,
        verifiedAt: now,
      }
    });
  } catch (err: any) {
    console.warn('[SourceReplacement] Failed to save verified source record:', err);
  }

  // 3. Setup temporary staging directory
  const stagingDir = path.join(process.cwd(), 'data', 'tmp_replace_${songId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}');
  if (!fs.existsSync(stagingDir)) {
    fs.mkdirSync(stagingDir, { recursive: true });
  }

  const formatExt = song.format || 'mp3';
  const safeArtist = sanitizeFilename(song.artist || 'Unknown Artist');
  const safeTitle = sanitizeFilename(song.title || 'Unknown Title');
  const baseFilename = `${safeArtist} - ${safeTitle}`;
  const stagingAudioPath = path.join(stagingDir, `${baseFilename}.${formatExt}`);
  const stagingInstrumentalPath = path.join(stagingDir, `${baseFilename} (Instrumental).${formatExt}`);

  try {
    console.log(`[SourceReplacement] Downloading replacement audio for song #${songId} ("${song.title}") from ${youtubeUrl}...`);

    if (isPreviewMode) {
      simulateDownload(stagingAudioPath);
    } else {
      const ytDlpPath = await getYtDlpPath();
      const dlArgs = [
        '-x',
        '--audio-format', formatExt === 'opus' ? 'opus' : formatExt,
        '--audio-quality', '0',
        '--no-playlist',
        '--max-filesize', '100M',
        '--js-runtimes', 'node',
        '-o', path.join(stagingDir, 'audio_%(ext)s'),
        youtubeUrl.trim(),
      ];

      await execFilePromise(ytDlpPath, dlArgs, { timeout: 300000 });
    }

    // Locate downloaded file in staging
    let downloadedStagingFile = '';
    const files = fs.readdirSync(stagingDir);
    for (const f of files) {
      if (f.startsWith('audio_') && !f.includes('Instrumental')) {
        const candidate = path.join(stagingDir, f);
        if (fs.statSync(candidate).size > 1024) {
          downloadedStagingFile = candidate;
          break;
        }
      }
    }

    if (!downloadedStagingFile || !fs.existsSync(downloadedStagingFile)) {
      throw new Error('Download completed but staging audio file was not found.');
    }

    // If format differs, rename to stagingAudioPath
    if (downloadedStagingFile !== stagingAudioPath) {
      fs.copyFileSync(downloadedStagingFile, stagingAudioPath);
    }

    if (!fs.existsSync(stagingAudioPath) || fs.statSync(stagingAudioPath).size <= 1024) {
      throw new Error('Staging audio file is missing or invalid.');
    }

    console.log(`[SourceReplacement] Executing instrumental separation for song #${songId}...`);
    const sepResult = await separateAndCreateInstrumental(
      stagingAudioPath,
      stagingInstrumentalPath,
      { title: song.title, artist: song.artist || 'Unknown Artist', album: song.album || '' }
    );

    if (!sepResult.ok || !fs.existsSync(stagingInstrumentalPath) || fs.statSync(stagingInstrumentalPath).size <= 1024) {
      throw new Error(sepResult.error || 'Instrumental separation failed or produced invalid file.');
    }

    // 4. Validate staged files
    const origStats = fs.statSync(stagingAudioPath);
    const instStats = fs.statSync(stagingInstrumentalPath);
    if (origStats.size <= 1024 || instStats.size <= 1024) {
      throw new Error('Validation failed: Staged audio file sizes are too small or empty.');
    }

    // 5. Safe replacement of old files on disk and database
    const oldMainPath = song.mainAudioPath;
    const oldInstPath = song.instrumentalAudioPath;

    // Determine target permanent directory (same directory as old main audio or artist directory)
    const targetDir = oldMainPath ? path.dirname(oldMainPath) : path.join(path.dirname(stagingAudioPath), safeArtist);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const finalMainPath = path.join(targetDir, `${baseFilename}.${formatExt}`);
    const finalInstPath = path.join(targetDir, `${baseFilename} (Instrumental).${formatExt}`);

    // Move validated staged files to final destination atomically
    fs.copyFileSync(stagingAudioPath, finalMainPath);
    fs.copyFileSync(stagingInstrumentalPath, finalInstPath);

    // Verify final files
    if (!fs.existsSync(finalMainPath) || !fs.existsSync(finalInstPath)) {
      throw new Error('Failed to commit replacement files to final library location.');
    }

    // Register / update in library scanner / DB
    const canonicalMeta = {
      title: song.title,
      artist: song.artist || 'Unknown Artist',
      album: song.album || undefined,
    };
    await importSingleAudioFile(song.libraryId, finalMainPath, canonicalMeta);
    await importSingleAudioFile(song.libraryId, finalInstPath, canonicalMeta);

    // Update song record in database
    await db.update(songs).set({
      mainAudioPath: finalMainPath,
      instrumentalAudioPath: finalInstPath,
      fileSize: origStats.size,
      format: formatExt,
    })
    .where(eq(songs.id, songId));

    // Update processedAt in songVerifiedSources
    await db.update(songVerifiedSources).set({
      processedAt: new Date(),
    })
    .where(eq(songVerifiedSources.songId, songId));

    // Cleanup old files if different and safe
    try {
      if (oldMainPath && oldMainPath !== finalMainPath && fs.existsSync(oldMainPath)) {
        fs.unlinkSync(oldMainPath);
      }
      if (oldInstPath && oldInstPath !== finalInstPath && fs.existsSync(oldInstPath)) {
        fs.unlinkSync(oldInstPath);
      }
    } catch (cleanupErr) {
      console.warn('[SourceReplacement] Notice during old file cleanup:', cleanupErr);
    }

    // Cleanup staging directory
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch {}

    console.log(`[SourceReplacement] Successfully replaced recording source and reprocessed song #${songId}`);
    return {
      success: true,
      message: 'Recording source replaced and audio reprocessed successfully.',
      songId,
      originalPath: finalMainPath,
      instrumentalPath: finalInstPath,
    };

  } catch (err: any) {
    console.error(`[SourceReplacement] Error replacing source for song #${songId}:`, err);
    // Cleanup staging directory on failure
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    } catch {}

    return {
      success: false,
      message: err.message || 'Failed to replace recording source.',
      songId,
      error: err.message,
    };
  }
}

function extractYouTubeVideoId(url: string): string | null {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}
