import test from 'node:test';
import assert from 'node:assert/strict';
import { DownloadQueueManager } from '../lib/download-queue.js';
import { ProcessingQueueManager } from '../lib/processing-queue.js';
import type { ProcessSongRequest } from '../lib/song-processor.js';
import { isPublicRoute } from '../middleware/auth.js';

test('download queue never allows concurrency above one', () => {
  const queue = new DownloadQueueManager();

  assert.strictEqual(queue.getConcurrency(), 1, 'Default concurrency must be serial');
  queue.setConcurrency(16);
  assert.strictEqual(queue.getConcurrency(), 1, 'Legacy or UI concurrency changes must not raise the global limit');
  queue.setConcurrency(0);
  assert.strictEqual(queue.getConcurrency(), 1, 'Invalid concurrency changes must not break the serial limit');
});


test('processing queue runs complete song pipelines serially', async () => {
  let active = 0;
  let maximumActive = 0;
  const events: string[] = [];

  const processor = async (request: ProcessSongRequest) => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    events.push(`start:${request.downloadTrackId}`);
    await new Promise<void>(resolve => setImmediate(resolve));
    events.push(`finish:${request.downloadTrackId}`);
    active--;
  };

  const queue = new ProcessingQueueManager(processor);
  const request = (id: string): ProcessSongRequest => ({
    downloadTrackId: id,
    originalAudioPath: `/tmp/${id}.mp3`,
    libraryId: 1,
    title: id,
    artist: 'Test Artist',
  });

  await Promise.all([queue.enqueue(request('one')), queue.enqueue(request('two')), queue.enqueue(request('three'))]);

  assert.equal(maximumActive, 1, 'No two song processing pipelines may overlap');
  assert.deepEqual(events, [
    'start:one', 'finish:one',
    'start:two', 'finish:two',
    'start:three', 'finish:three',
  ]);
});

test('public route exemptions reject lyric offset writes but allow scoped guest queue validation', () => {
  const req = (method: string, url: string) => ({
    method,
    originalUrl: url,
    url,
  }) as any;

  assert.equal(isPublicRoute(req('PUT', '/api/songs/12/lyrics/offset')), false);
  assert.equal(isPublicRoute(req('POST', '/api/karaoke/sessions/session-123/queue')), true);
  assert.equal(isPublicRoute(req('POST', '/api/karaoke/sessions/session-123/delete')), false);
});
