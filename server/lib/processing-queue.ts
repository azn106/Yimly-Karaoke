import { ProcessSongRequest, processDownloadedSong } from './song-processor.js';
import { db } from '../db/index.js';
import { queueItems, downloadTrackJobs, songs } from '../db/schema.js';
import { eq, and, or, inArray } from 'drizzle-orm';

export class ProcessingQueueManager {
  private queue: ProcessSongRequest[] = [];
  private isProcessing: boolean = false;
  private initialized: boolean = false;

  public async init() {
    if (this.initialized) return;
    this.initialized = true;

    // Find interrupted processing tasks
    const pending = await db.select().from(queueItems).where(eq(queueItems.downloadStatus, 'processing'));
    
    for (const item of pending) {
      if (!item.downloadTrackId) continue;
      const trackJob = await db.select().from(downloadTrackJobs).where(eq(downloadTrackJobs.id, item.downloadTrackId)).limit(1);
      
      if (trackJob.length > 0 && trackJob[0].outputPath) {
        let libraryId = 0;
        if (item.songId) {
          const songRec = await db.select().from(songs).where(eq(songs.id, item.songId)).limit(1);
          if (songRec.length > 0) libraryId = songRec[0].libraryId;
        }

        this.enqueue({
          downloadTrackId: item.downloadTrackId,
          originalAudioPath: trackJob[0].outputPath,
          libraryId,
          title: item.tempTitle || trackJob[0].title,
          artist: item.tempArtist || trackJob[0].artist,
        });
      }
    }
    console.log(`[ProcessingQueue] Recovered ${pending.length} pending processing tasks.`);
  }

  public enqueue(request: ProcessSongRequest) {
    console.log(`[ProcessingQueue] Enqueuing request for "${request.title}"`);
    this.queue.push(request);
    this.pumpQueue();
  }

  private async pumpQueue() {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    const request = this.queue.shift()!;

    try {
      console.log(`[ProcessingQueue] Starting processing for "${request.title}"`);
      await processDownloadedSong(request);
      console.log(`[ProcessingQueue] Finished processing for "${request.title}"`);
    } catch (err) {
      console.error(`[ProcessingQueue] Failed processing for "${request.title}":`, err);
    } finally {
      this.isProcessing = false;
      this.pumpQueue();
    }
  }
}

export const processingQueue = new ProcessingQueueManager();
