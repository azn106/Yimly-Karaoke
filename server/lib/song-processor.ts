import fs from 'fs';
import path from 'path';
import { verifyValidMp3File } from './audio-separation.js';
import {
  generateInstrumentalFromOriginal,
  GeneratedInstrumentalResult,
  installInstrumentalForSong,
  resolveCanonicalInstrumentalPath,
} from './instrumental-pipeline.js';
import { fetchSongDualLyrics } from '../lyrics/manager.js';
import { getElrcLineLeadInMsFromDb } from '../karaoke-sync-config.js';
import { importSingleAudioFile, CanonicalImportMetadata } from './scanner.js';
import { db } from '../db/index.js';
import { queueItems } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { notifyQueueUpdate } from '../ws/index.js';

export interface ProcessSongRequest {
  downloadTrackId: string;
  originalAudioPath: string;
  libraryId: number;
  title: string;
  artist: string;
  artists?: string[];
  album?: string;
  duration?: number;
  trackNumber?: number;
  discNumber?: number;
  releaseYear?: number;
  artworkUrl?: string;
}

async function atomicWriteFile(targetPath: string, content: string) {
  const tempPath = `${targetPath}.tmp.${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  try {
    await fs.promises.writeFile(tempPath, content, 'utf-8');
    await fs.promises.rename(tempPath, targetPath);
  } catch (err) {
    try { await fs.promises.unlink(tempPath); } catch {}
    throw err;
  }
}

/**
 * Executes the complete Yimly standalone processing pipeline:
 *
 * Download completely finishes & file streams closed
 *   ↓
 * PROCESSING (queue status updated and broadcast)
 *   ↓
 * Shared Instrumental Pipeline (Demucs via shared lock -> FFmpeg 320k MP3 -> verifyValidMp3File)
 *   ↓
 * Cloud lyric providers (NetEase → QQ Music → Kugou → Musixmatch)
 *   ↓
 * LRC / eLRC written to disk
 *   ↓
 * Register main audio + Shared instrumental installation & scanner verification
 *   ↓
 * READY (queue item updated with real songId)
 *   ↓
 * WebSocket update broadcast
 */
export async function processDownloadedSong(req: ProcessSongRequest): Promise<void> {
  const { downloadTrackId, originalAudioPath, libraryId, title, artist, album, duration } = req;
  const dir = path.dirname(originalAudioPath);
  const ext = path.extname(originalAudioPath);
  const baseName = path.basename(originalAudioPath, ext);

  // Instrumental output is always genuine MP3 with a .mp3 extension,
  // regardless of the original recording's container/extension (e.g. .flac, .m4a, .wav, .opus).
  const targetInstrumentalPath = resolveCanonicalInstrumentalPath(originalAudioPath, dir, baseName);
  const targetLrcPath = path.join(dir, `${baseName}.lrc`);
  const targetElrcPath = path.join(dir, `${baseName}.elrc.lrc`);

  console.log(`[SongProcessor] Starting processing pipeline for "${title}" by "${artist}" (Track ${downloadTrackId})`);

  // 1. Mark matching queue items as 'processing' and broadcast
  try {
    await db.update(queueItems)
      .set({ downloadStatus: 'processing' })
      .where(eq(queueItems.downloadTrackId, downloadTrackId));

    const matchedQueues = await db.select().from(queueItems).where(eq(queueItems.downloadTrackId, downloadTrackId));
    const sessionIds = Array.from(new Set(matchedQueues.map(q => q.sessionId)));
    for (const sId of sessionIds) {
      notifyQueueUpdate(sId);
    }
  } catch (err) {
    console.warn('[SongProcessor] Failed to set queue status to processing:', err);
  }

  let generatedInstrumental: GeneratedInstrumentalResult | null = null;

  try {
    // 2. Check for an existing genuinely valid MP3 instrumental before invoking Demucs
    let hasValidExistingInstrumental = false;
    if (fs.existsSync(targetInstrumentalPath)) {
      try {
        await verifyValidMp3File(targetInstrumentalPath);
        hasValidExistingInstrumental = true;
        console.log(`[SongProcessor] Valid instrumental MP3 already exists for "${title}". Skipping Demucs separation.`);
      } catch (valErr: any) {
        console.warn(
          `[SongProcessor] Existing instrumental at "${targetInstrumentalPath}" failed MP3 validation (${valErr?.message || valErr}); regenerating.`
        );
        hasValidExistingInstrumental = false;
      }
    }

    if (!hasValidExistingInstrumental) {
      console.log(`[SongProcessor] Generating instrumental MP3 via shared pipeline...`);
      generatedInstrumental = await generateInstrumentalFromOriginal({
        originalAudioPath,
        targetDir: dir,
        baseFilename: baseName,
        metadata: {
          title,
          artist,
          artists: req.artists,
          album,
          duration,
          trackNumber: req.trackNumber,
          discNumber: req.discNumber,
          releaseYear: req.releaseYear,
          artworkUrl: req.artworkUrl,
        },
      });
    }

    // 3. Lyrics retrieval: NetEase → QQ Music → Kugou → Musixmatch cascade
    try {
      const configuredLeadInMs = await getElrcLineLeadInMsFromDb();
      console.log(`[SongProcessor] Retrieving cloud lyrics (NetEase -> QQ -> Kugou -> Musixmatch) with lead-in ${configuredLeadInMs}ms...`);
      const dualResult = await fetchSongDualLyrics(title, artist, album, duration, {
        leadInMs: configuredLeadInMs,
        onLog: (msg) => console.log(`[SongProcessor Lyric] ${msg}`),
      });

      if (dualResult.elrcResult?.elrc && !fs.existsSync(targetElrcPath)) {
        await atomicWriteFile(targetElrcPath, dualResult.elrcResult.elrc);
        console.log(`[SongProcessor] Saved word-synced eLRC from ${dualResult.elrcResult.source}`);
      }

      if (dualResult.lrcResult?.lrc && !fs.existsSync(targetLrcPath)) {
        await atomicWriteFile(targetLrcPath, dualResult.lrcResult.lrc);
        console.log(`[SongProcessor] Saved line-synced LRC from ${dualResult.lrcResult.source}`);
      }
    } catch (lyricErr) {
      console.warn(`[SongProcessor] Cloud lyrics fetch failed (non-fatal):`, lyricErr);
    }

    // 4. Library Registration & Shared Instrumental Installation
    console.log(`[SongProcessor] Registering completed audio files in library ${libraryId}...`);
    const canonicalMeta: CanonicalImportMetadata = {
      title,
      artist,
      artists: req.artists,
      album,
      duration,
      trackNumber: req.trackNumber,
      discNumber: req.discNumber,
      year: req.releaseYear,
      artworkUrl: req.artworkUrl,
    };

    const imported = await importSingleAudioFile(libraryId, originalAudioPath, canonicalMeta);
    if (!imported || imported.length === 0 || !imported[0]?.id) {
      throw new Error(`Library scanner failed to index completed original audio file for "${title}"`);
    }

    const realSongId = imported[0].id;

    if (generatedInstrumental) {
      const installRes = await installInstrumentalForSong({
        songId: realSongId,
        stagedInstrumentalPath: generatedInstrumental.stagedInstrumentalPath,
        targetDir: dir,
        targetFilename: path.basename(targetInstrumentalPath),
        canonicalMeta,
      });
      await verifyValidMp3File(installRes.instrumentalPath);
    } else {
      await verifyValidMp3File(targetInstrumentalPath);
      const importedInst = await importSingleAudioFile(libraryId, targetInstrumentalPath, canonicalMeta);
      if (!importedInst || importedInst.length === 0 || importedInst[0].instrumentalAudioPath !== targetInstrumentalPath) {
        throw new Error(`Library scanner failed to index existing instrumental MP3 for "${title}"`);
      }
    }

    console.log(`[SongProcessor] Successfully indexed song with songId=${realSongId}`);

    // 5. Update Room queue item: Convert to real song and set ready
    await db.update(queueItems).set({
      songId: realSongId,
      downloadStatus: 'ready'
    }).where(eq(queueItems.downloadTrackId, downloadTrackId));

    // 6. Broadcast state update over WebSocket
    const matchedQueues = await db.select().from(queueItems).where(eq(queueItems.downloadTrackId, downloadTrackId));
    const sessionIds = Array.from(new Set(matchedQueues.map(q => q.sessionId)));
    for (const sId of sessionIds) {
      notifyQueueUpdate(sId);
    }

    console.log(`[SongProcessor] Processing complete! Queue item ready for session(s): ${sessionIds.join(', ')}`);
  } catch (procErr: any) {
    console.error(`[SongProcessor] Processing pipeline failed for "${title}":`, procErr?.message || procErr);

    // Transition queue item to failed
    try {
      await db.update(queueItems).set({
        downloadStatus: 'failed'
      }).where(eq(queueItems.downloadTrackId, downloadTrackId));

      const matchedQueues = await db.select().from(queueItems).where(eq(queueItems.downloadTrackId, downloadTrackId));
      const sessionIds = Array.from(new Set(matchedQueues.map(q => q.sessionId)));
      for (const sId of sessionIds) {
        notifyQueueUpdate(sId);
      }
    } catch (dbErr) {
      console.error('[SongProcessor] Failed to update queue item to failed status:', dbErr);
    }
    // Propagate the failure so the download manager cannot report this track as successful.
    throw procErr;
  } finally {
    generatedInstrumental?.cleanup();
  }
}
