import test from 'node:test';
import assert from 'node:assert/strict';
import { DownloadQueueManager } from '../lib/download-queue.js';

test('download queue never allows concurrency above one', () => {
  const queue = new DownloadQueueManager();

  assert.strictEqual(queue.getConcurrency(), 1, 'Default concurrency must be serial');
  queue.setConcurrency(16);
  assert.strictEqual(queue.getConcurrency(), 1, 'Legacy or UI concurrency changes must not raise the global limit');
  queue.setConcurrency(0);
  assert.strictEqual(queue.getConcurrency(), 1, 'Invalid concurrency changes must not break the serial limit');
});
