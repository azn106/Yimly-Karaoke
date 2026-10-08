import fs from 'fs';
import path from 'path';
import { separateAndCreateInstrumental } from './audio-separation.js';
import { fetchSongDualLyrics } from '../lyrics/manager.js';
import { getElrcLineLeadInMsFromDb } from '../karaoke-sync-config.js';
import { importSingleAudioFile } from './scanner.js';
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
  album?: string;
  duration?: number;
}

function atomicWriteFile(targetPath: string, content: string) {
  const tempPath = `${targetPath}.tmp.${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  try {
    fs.writeFileSync(tempPath, content, 'utf-8');
    fs.renameSync(tempPath, targetPath);
  } catch (err) {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
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
 * Demucs / htdemucs (GPU mandatory)
 *   ↓
 * FFmpeg instrumental (atomic write, verification)
 *   ↓
 * Cloud lyric providers (NetEase → QQ Music → Kugou → Musixmatch)
 *   ↓
 * LRC / eLRC written to disk
 *   ↓
 * Register & index completed song via scanner
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

  const targetInstrumentalPath = path.join(dir, `${baseName} (Instrumental)${ext}`);
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

  try {
    // 2. Audio separation: Demucs GPU + FFmpeg instrumental
    let instrumentalOk = false;
    if (fs.existsSync(targetInstrumentalPath) && fs.statSync(targetInstrumentalPath).size > 1024) {
      console.log(`[SongProcessor] Instrumental already exists for "${title}". Skipping Demucs separation.`);
      instrumentalOk = true;
    } else {
      console.log(`[SongProcessor] Executing Demucs vocal separation (GPU mandatory)...`);
      const sepResult = await separateAndCreateInstrumental(
        originalAudioPath,
        targetInstrumentalPath,
        { title, artist, album }
      );

      if (!sepResult.ok) {
        throw new Error(sepResult.error || 'Instrumental generation failed');
      }
      instrumentalOk = true;
    }

    if (!instrumentalOk || !fs.existsSync(targetInstrumentalPath)) {
      throw new Error(`Instrumental file is missing or invalid at ${targetInstrumentalPath}`);
    }

    // 3. Lyrics retrieval: NetEase → QQ Music → Kugou → Musixmatch cascade
    try {
      const configuredLeadInMs = await getElrcLineLeadInMsFromDb();
      console.log(`[SongProcessor] Retrieving cloud lyrics (NetEase -> QQ -> Kugou -> Musixmatch) with lead-in ${configuredLeadInMs}ms...`);
      const dualResult = await fetchSongDualLyrics(title, artist, {
        album,
        duration,
        leadInMs: configuredLeadInMs,
        onLog: (msg) => console.log(`[SongProcessor Lyric] ${msg}`),
      });

      if (dualResult.elrcResult?.elrc && !fs.existsSync(targetElrcPath)) {
        atomicWriteFile(targetElrcPath, dualResult.elrcResult.elrc);
        console.log(`[SongProcessor] Saved word-synced eLRC from ${dualResult.elrcResult.source}`);
      }

      if (dualResult.lrcResult?.lrc && !fs.existsSync(targetLrcPath)) {
        atomicWriteFile(targetLrcPath, dualResult.lrcResult.lrc);
        console.log(`[SongProcessor] Saved line-synced LRC from ${dualResult.lrcResult.source}`);
      }
    } catch (lyricErr) {
      console.warn(`[SongProcessor] Cloud lyrics fetch failed (non-fatal):`, lyricErr);
    }

    // 4. Library Registration: Scan and index the finalized files
    console.log(`[SongProcessor] Registering completed audio files in library ${libraryId}...`);
    // Import both main and instrumental files
    const imported = await importSingleAudioFile(libraryId, originalAudioPath);
    if (fs.existsSync(targetInstrumentalPath)) {
      await importSingleAudioFile(libraryId, targetInstrumentalPath);
    }

    if (!imported || imported.length === 0 || !imported[0]?.id) {
      throw new Error(`Library scanner failed to index completed audio files for "${title}"`);
    }

    const realSongId = imported[0].id;
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
  }
}
