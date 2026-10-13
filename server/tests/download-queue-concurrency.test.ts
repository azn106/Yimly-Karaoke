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


test('processing queue settles every enqueue when a track ID is repeated', async () => {
  let active = 0;
  let maximumActive = 0;
  let completed = 0;

  const processor = async () => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    await new Promise<void>(resolve => setImmediate(resolve));
    active--;
    completed++;
  };

  const queue = new ProcessingQueueManager(processor);
  const request: ProcessSongRequest = {
    downloadTrackId: 'same-track',
    originalAudioPath: '/tmp/same-track.mp3',
    libraryId: 1,
    title: 'Same Track',
    artist: 'Test Artist',
  };

  await Promise.all([queue.enqueue(request), queue.enqueue(request)]);

  assert.equal(completed, 2, 'Both queued entries must complete');
  assert.equal(maximumActive, 1, 'Repeated IDs must still be processed serially');
});

test('processing queue rejects only the failed entry and continues draining', async () => {
  let calls = 0;
  const queue = new ProcessingQueueManager(async () => {
    calls++;
    if (calls === 1) throw new Error('expected test failure');
  });
  const request: ProcessSongRequest = {
    downloadTrackId: 'same-track',
    originalAudioPath: '/tmp/same-track.mp3',
    libraryId: 1,
    title: 'Same Track',
    artist: 'Test Artist',
  };

  const results = await Promise.allSettled([queue.enqueue(request), queue.enqueue(request)]);

  assert.equal(results[0].status, 'rejected', 'The failed entry must reject its own promise');
  assert.equal(results[1].status, 'fulfilled', 'A later entry with the same ID must still settle');
  assert.equal(calls, 2, 'The queue must continue after a processing failure');
});
