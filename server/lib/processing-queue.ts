import { ProcessSongRequest, processDownloadedSong } from './song-processor.js';

export class ProcessingQueueManager {
  private queue: ProcessSongRequest[] = [];
  private isProcessing: boolean = false;

  private pendingPromises = new Map<string, { resolve: () => void; reject: (err: any) => void }>();

  public async enqueue(request: ProcessSongRequest): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pendingPromises.set(request.downloadTrackId, { resolve, reject });
      this.queue.push(request);
      this.pumpQueue();
    });
  }

  private async pumpQueue() {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    const request = this.queue.shift()!;
    const promise = this.pendingPromises.get(request.downloadTrackId);

    try {
      console.log(`[ProcessingQueue] Starting processing for "${request.title}"`);
      await processDownloadedSong(request);
      console.log(`[ProcessingQueue] Finished processing for "${request.title}"`);
      promise?.resolve();
    } catch (err) {
      console.error(`[ProcessingQueue] Failed processing for "${request.title}":`, err);
      promise?.reject(err);
    } finally {
      this.pendingPromises.delete(request.downloadTrackId);
      this.isProcessing = false;
      this.pumpQueue();
    }
  }
}

export const processingQueue = new ProcessingQueueManager();
