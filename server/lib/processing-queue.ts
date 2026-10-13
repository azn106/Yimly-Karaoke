import { ProcessSongRequest, processDownloadedSong } from './song-processor.js';

interface ProcessingQueueEntry {
  request: ProcessSongRequest;
  resolve: () => void;
  reject: (err: unknown) => void;
}

export class ProcessingQueueManager {
  constructor(
    private readonly processSong: (request: ProcessSongRequest) => Promise<void> = processDownloadedSong
  ) {}

  private queue: ProcessingQueueEntry[] = [];
  private isProcessing = false;

  public enqueue(request: ProcessSongRequest): Promise<void> {
    return new Promise((resolve, reject) => {
      // Keep each enqueue's callbacks with its queue entry. A map keyed by
      // downloadTrackId can overwrite callbacks when the same track is queued
      // twice, leaving the earlier caller's promise pending forever.
      this.queue.push({ request, resolve, reject });
      void this.pumpQueue();
    });
  }

  private async pumpQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    try {
      // Drain serially in a loop, avoiding recursive pump calls for long queues.
      while (this.queue.length > 0) {
        const entry = this.queue.shift()!;
        const { request } = entry;

        try {
          console.log(`[ProcessingQueue] Starting processing for "${request.title}"`);
          await this.processSong(request);
          console.log(`[ProcessingQueue] Finished processing for "${request.title}"`);
          entry.resolve();
        } catch (err) {
          console.error(`[ProcessingQueue] Failed processing for "${request.title}":`, err);
          entry.reject(err);
        }
      }
    } finally {
      this.isProcessing = false;
      // Close the enqueue race between the final empty check and releasing the
      // processing flag. If an entry arrived during that window, pump it now.
      if (this.queue.length > 0) void this.pumpQueue();
    }
  }
}

export const processingQueue = new ProcessingQueueManager();
