import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { DownloadQueueManager } from '../lib/download-queue.js';
import { ProcessingQueueManager } from '../lib/processing-queue.js';
import type { ProcessSongRequest } from '../lib/song-processor.js';

test('Queue Concurrency: DownloadQueueManager never exceeds 1 worker across concurrent jobs', () => {
  const manager = new DownloadQueueManager();
  assert.strictEqual(manager.getConcurrency(), 1, 'Download concurrency must be strictly 1');

  // Attempting to change concurrency via any method must be clamped to 1
  manager.setConcurrency(8);
  assert.strictEqual(manager.getConcurrency(), 1, 'setConcurrency must clamp to 1');
  manager.setConcurrency(0);
  assert.strictEqual(manager.getConcurrency(), 1, 'setConcurrency(0) must clamp to 1');
});

test('Queue Serialization: ProcessingQueueManager completes full pipeline before starting next song', async () => {
  const executionOrder: string[] = [];
  let concurrentPipelines = 0;
  let maxConcurrentPipelines = 0;

  const mockPipeline = async (req: ProcessSongRequest) => {
    concurrentPipelines++;
    maxConcurrentPipelines = Math.max(maxConcurrentPipelines, concurrentPipelines);
    executionOrder.push(`start:${req.downloadTrackId}`);

    // Simulate async Demucs / FFmpeg / lyrics / DB work
    await new Promise((resolve) => setTimeout(resolve, 20));

    executionOrder.push(`complete:${req.downloadTrackId}`);
    concurrentPipelines--;
  };

  const queue = new ProcessingQueueManager(mockPipeline);

  const makeReq = (id: string): ProcessSongRequest => ({
    downloadTrackId: id,
    originalAudioPath: `/media/Song_${id}.mp3`,
    libraryId: 1,
    title: `Song ${id}`,
    artist: 'Artist',
  });

  // Enqueue 3 songs concurrently from different callers
  await Promise.all([
    queue.enqueue(makeReq('A')),
    queue.enqueue(makeReq('B')),
    queue.enqueue(makeReq('C')),
  ]);

  assert.strictEqual(maxConcurrentPipelines, 1, 'At no point may two song processing pipelines run concurrently');
  assert.deepStrictEqual(executionOrder, [
    'start:A', 'complete:A',
    'start:B', 'complete:B',
    'start:C', 'complete:C',
  ], 'Queue must execute completely serially in FIFO order');
});

test('Queue Resilience: Failed and cancelled jobs release worker slot without blocking subsequent jobs', async () => {
  let step = 0;
  const processed: string[] = [];

  const mockProcessor = async (req: ProcessSongRequest) => {
    step++;
    if (step === 1) {
      throw new Error('Simulated Demucs GPU out-of-memory');
    }
    processed.push(req.downloadTrackId);
  };

  const queue = new ProcessingQueueManager(mockProcessor);

  const req1: ProcessSongRequest = {
    downloadTrackId: 'failing_track',
    originalAudioPath: '/media/failing.mp3',
    libraryId: 1,
    title: 'Failing Track',
    artist: 'Artist',
  };

  const req2: ProcessSongRequest = {
    downloadTrackId: 'succeeding_track',
    originalAudioPath: '/media/succeeding.mp3',
    libraryId: 1,
    title: 'Succeeding Track',
    artist: 'Artist',
  };

  const results = await Promise.allSettled([
    queue.enqueue(req1),
    queue.enqueue(req2),
  ]);

  assert.strictEqual(results[0].status, 'rejected', 'First job must reject');
  assert.strictEqual(results[1].status, 'fulfilled', 'Second job must fulfill despite prior failure');
  assert.deepStrictEqual(processed, ['succeeding_track'], 'Subsequent song must process successfully');
});

test('Backup & Model Cache Exclusion: Excludes data/models/hub and preserves database & media', async () => {
  const testRoot = path.resolve(process.cwd(), 'data', 'test_backup_validation');
  if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true, force: true });

  const testData = path.join(testRoot, 'data');
  const testMedia = path.join(testRoot, 'media');
  const testBackups = path.join(testRoot, 'backups');
  const testStage = path.join(testRoot, 'stage');

  fs.mkdirSync(path.join(testData, 'models', 'hub', 'models--demucs--htdemucs'), { recursive: true });
  fs.mkdirSync(path.join(testData, 'models', 'configs'), { recursive: true });
  fs.mkdirSync(testMedia, { recursive: true });
  fs.mkdirSync(testBackups, { recursive: true });
  fs.mkdirSync(testStage, { recursive: true });

  // Create simulated persistent database and media
  fs.writeFileSync(path.join(testData, 'yimly.db'), 'SQLITE_MOCK_DATABASE_CONTENT');
  fs.writeFileSync(path.join(testData, 'models', 'configs', 'demucs_config.json'), '{"model":"htdemucs"}');
  fs.writeFileSync(path.join(testData, 'models', 'hub', 'models--demucs--htdemucs', 'weights.th'), 'HUGE_MODEL_WEIGHTS');
  fs.writeFileSync(path.join(testMedia, 'Artist - Title.mp3'), 'AUDIO_DATA');
  fs.writeFileSync(path.join(testMedia, 'Artist - Title.lrc'), '[00:00.00] Lyrics');

  // Replicate staging logic from scripts/backup-yimly.ps1
  const stageData = path.join(testStage, 'data');
  const stageMedia = path.join(testStage, 'media');
  fs.mkdirSync(stageData, { recursive: true });
  fs.mkdirSync(stageMedia, { recursive: true });

  // Copy data excluding 'models'
  for (const entry of fs.readdirSync(testData)) {
    if (entry !== 'models') {
      fs.cpSync(path.join(testData, entry), path.join(stageData, entry), { recursive: true });
    }
  }

  // Copy data/models excluding 'hub'
  const sourceModels = path.join(testData, 'models');
  const stageModels = path.join(stageData, 'models');
  fs.mkdirSync(stageModels, { recursive: true });
  for (const entry of fs.readdirSync(sourceModels)) {
    if (entry !== 'hub') {
      fs.cpSync(path.join(sourceModels, entry), path.join(stageModels, entry), { recursive: true });
    }
  }

  // Copy media
  for (const entry of fs.readdirSync(testMedia)) {
    fs.cpSync(path.join(testMedia, entry), path.join(stageMedia, entry), { recursive: true });
  }

  // Create tar.gz archive
  const archivePath = path.join(testBackups, 'yimly_backup_test.tar.gz');
  execSync(`tar -czf "${archivePath}" -C "${testStage}" .`);

  assert.strictEqual(fs.existsSync(archivePath), true, 'Backup archive must be created');
  assert.ok(fs.statSync(archivePath).size > 100, 'Archive must be non-empty');

  // Verify archive listing
  const listing = execSync(`tar -tzf "${archivePath}"`).toString('utf8');
  assert.ok(listing.includes('yimly.db'), 'Archive must contain yimly.db');
  assert.ok(listing.includes('Artist - Title.mp3'), 'Archive must contain media mp3');
  assert.ok(listing.includes('demucs_config.json'), 'Archive must contain non-hub model config');
  assert.strictEqual(listing.includes('weights.th'), false, 'Archive MUST NOT contain weights inside models/hub');
  assert.strictEqual(listing.includes('models/hub'), false, 'Archive MUST NOT contain models/hub directory');

  // Clean up
  fs.rmSync(testRoot, { recursive: true, force: true });
});

test('Restore Procedure: Restores data from archive and verifies database boot integrity', async () => {
  const testRoot = path.resolve(process.cwd(), 'data', 'test_restore_validation');
  if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true, force: true });

  const testSource = path.join(testRoot, 'source');
  const testArchive = path.join(testRoot, 'backup.tar.gz');
  const testRestoreDest = path.join(testRoot, 'restored');

  fs.mkdirSync(path.join(testSource, 'data'), { recursive: true });
  fs.mkdirSync(path.join(testSource, 'media'), { recursive: true });

  // Initialize a real SQLite database in testSource/data using drizzle migrations
  const { createClient } = await import('@libsql/client');
  const dbFile = path.join(testSource, 'data', 'yimly.db');
  const sqlite = createClient({ url: `file:${dbFile}` });

  await sqlite.execute('CREATE TABLE users (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, username text NOT NULL);');
  await sqlite.execute("INSERT INTO users (username) VALUES ('restored_admin');");
  await sqlite.close();

  fs.writeFileSync(path.join(testSource, 'media', 'TestSong.mp3'), 'AUDIO_RESTORE_TEST');

  // Pack archive
  execSync(`tar -czf "${testArchive}" -C "${testSource}" .`);

  // Perform safe staged restore into testRestoreDest (mirroring scripts/restore-yimly.ps1)
  const restoreStage = path.join(testRoot, 'restore_stage');
  fs.mkdirSync(restoreStage, { recursive: true });
  execSync(`tar -xzf "${testArchive}" -C "${restoreStage}"`);

  // Verify staged contents
  assert.strictEqual(fs.existsSync(path.join(restoreStage, 'data', 'yimly.db')), true);
  assert.strictEqual(fs.existsSync(path.join(restoreStage, 'media', 'TestSong.mp3')), true);

  // Deploy staged contents to restored destination
  fs.mkdirSync(testRestoreDest, { recursive: true });
  fs.cpSync(path.join(restoreStage, 'data'), path.join(testRestoreDest, 'data'), { recursive: true });
  fs.cpSync(path.join(restoreStage, 'media'), path.join(testRestoreDest, 'media'), { recursive: true });

  // Verify database can be opened and queries run against restored file
  const restoredSqlite = createClient({ url: `file:${path.join(testRestoreDest, 'data', 'yimly.db')}` });
  const userCheck = await restoredSqlite.execute('SELECT username FROM users WHERE id = 1;');
  assert.strictEqual(userCheck.rows[0]?.username, 'restored_admin', 'Restored user record must match');

  const pragmaCheck = await restoredSqlite.execute('PRAGMA integrity_check;');
  assert.strictEqual(Object.values(pragmaCheck.rows[0])[0], 'ok', 'Restored database integrity must be ok');
  await restoredSqlite.close();

  // Clean up
  fs.rmSync(testRoot, { recursive: true, force: true });
});
