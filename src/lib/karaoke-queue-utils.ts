export interface KaraokeQueueItemLike {
  id: number;
  position?: number;
  status: string;
  songId?: number | null;
  downloadStatus?: string | null;
  songTitle?: string;
  artistName?: string;
  artist?: string;
  userId?: number | null;
  userName?: string | null;
}

export type QueueItemDisplayState = 'playing' | 'queued' | 'downloading' | 'processing' | 'failed' | 'ready' | 'preparing';

/**
 * Selects the actively playing queue item according to authoritative backend status.
 * Pending, downloading, processing, and failed items are never treated as playing.
 */
export function selectCurrentPlayingSong<T extends KaraokeQueueItemLike>(queue: T[]): T | undefined {
  return queue.find(
    (q) => q.status === 'playing' && q.songId !== null && q.songId !== undefined
  );
}

/**
 * Returns all items in the queue other than the currently playing item, preserving queue order.
 */
export function getUpcomingQueueItems<T extends KaraokeQueueItemLike>(
  queue: T[],
  currentSong: T | undefined
): T[] {
  return queue.filter((q) => (currentSong ? q.id !== currentSong.id : q.status !== 'playing'));
}

/**
 * Classifies a queue item into a single mutually exclusive display state:
 * playing, queued, downloading, processing, failed, ready, or preparing.
 */
export function getQueueItemDisplayState(item: KaraokeQueueItemLike): QueueItemDisplayState {
  if (item.status === 'playing' && item.songId !== null && item.songId !== undefined) {
    return 'playing';
  }
  if (item.downloadStatus === 'failed') return 'failed';
  if (item.downloadStatus === 'processing') return 'processing';
  if (item.downloadStatus === 'downloading') return 'downloading';
  if (item.downloadStatus === 'queued') return 'queued';
  if (item.downloadStatus === 'ready') {
    if (item.songId !== null && item.songId !== undefined) {
      return 'ready';
    }
    return 'preparing';
  }
  if (!item.downloadStatus && item.songId !== null && item.songId !== undefined) {
    return 'ready';
  }
  return 'preparing';
}

/**
 * Returns true if the queue has items still downloading, processing, or preparing while no song is playing.
 */
export function hasPreparingQueueItems(queue: KaraokeQueueItemLike[]): boolean {
  return queue.some((item) => {
    const state = getQueueItemDisplayState(item);
    return state === 'queued' || state === 'downloading' || state === 'processing' || state === 'preparing';
  });
}
