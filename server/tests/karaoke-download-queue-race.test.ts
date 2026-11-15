import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import { WebSocket, WebSocketServer } from 'ws';
import { eq, and, asc } from 'drizzle-orm';

import { db, setupDatabase } from '../db/index.js';
import {
  users,
  libraries,
  artists,
  albums,
  songs,
  sessions,
  controllers,
  queueItems,
  downloadJobs,
  downloadTrackJobs,
} from '../db/schema.js';
import karaokeRoutes from '../routes/karaoke.js';
import { downloadQueue, DownloadQueueManager } from '../lib/download-queue.js';
import { processingQueue } from '../lib/processing-queue.js';
import type { ProcessSongRequest } from '../lib/song-processor.js';
import { setupWebSockets, advanceQueueBySessionId, checkAndAutoPlay, notifyQueueUpdate, getRoomState } from '../ws/index.js';
import {
  selectCurrentPlayingSong,
  getUpcomingQueueItems,
  getQueueItemDisplayState,
  hasPreparingQueueItems,
} from '../../src/lib/karaoke-queue-utils.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'yimly_deterministic_test_jwt_secret_ci_only_32_bytes_safe';

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/karaoke', karaokeRoutes);

let server: http.Server;
let wss: WebSocketServer;
let baseUrl: string;

let hostUserId: number;
let hostToken: string;
let libId: number;
let libDir: string;
let createdTempLibDir = false;
let readyLibSongId: number;
const createdSessionIds: string[] = [];
const createdSongIds: number[] = [];
const createdArtistIds: number[] = [];
const createdFiles: string[] = [];
const createdDirs: string[] = [];

async function createTestSession(nameSuffix: string) {
  const res = await fetch(`${baseUrl}/api/karaoke/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hostToken}`,
    },
    body: JSON.stringify({ roomName: `Race Test Room ${nameSuffix}` }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  createdSessionIds.push(body.id);
  return body;
}

async function createLibrarySong(title: string, artistName: string, audioPath: string): Promise<number> {
  const artDir = path.dirname(audioPath);
  fs.mkdirSync(artDir, { recursive: true });
  if (!fs.existsSync(audioPath)) {
    fs.writeFileSync(audioPath, Buffer.alloc(2048, 'a'));
    createdFiles.push(audioPath);
  }

  let artistRow = await db.select().from(artists).where(eq(artists.name, artistName)).limit(1);
  let artistId: number;
  if (artistRow.length > 0) {
    artistId = artistRow[0].id;
  } else {
    const insArtist = await db.insert(artists).values({ name: artistName }).returning();
    artistId = insArtist[0].id;
    createdArtistIds.push(artistId);
  }

  const insSong = await db.insert(songs).values({
    libraryId: libId,
    artistId,
    title,
    mainAudioPath: audioPath,
    duration: 180,
    variant: 'original',
    format: 'mp3',
  }).returning();
  createdSongIds.push(insSong[0].id);
  return insSong[0].id;
}

test('Setup karaoke Download & Queue race test harness', async () => {
  await setupDatabase();

  // Clear any leftover active jobs/queue items from previously interrupted test runs
  // so downloadQueue.init() does not recover and execute unrelated historical jobs.
  await db.delete(queueItems);
  await db.delete(downloadTrackJobs);
  await db.delete(downloadJobs);

  server = http.createServer(app);
  wss = new WebSocketServer({ server, path: '/ws/karaoke' });
  setupWebSockets(wss);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  const existingUser = await db.select().from(users).where(eq(users.username, 'race_test_host')).limit(1);
  if (existingUser.length > 0) {
    hostUserId = existingUser[0].id;
  } else {
    const hashedPassword = await bcrypt.hash('password123', 10);
    const inserted = await db.insert(users).values({
      username: 'race_test_host',
      password: hashedPassword,
      role: 'administrator',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    hostUserId = inserted[0].id;
  }

  hostToken = jwt.sign(
    { id: hostUserId, username: 'race_test_host', role: 'administrator' },
    JWT_SECRET,
    { expiresIn: '2h' }
  );

  const existingLibs = await db.select().from(libraries).limit(1);
  if (existingLibs.length > 0) {
    libId = existingLibs[0].id;
    libDir = existingLibs[0].path;
    fs.mkdirSync(libDir, { recursive: true });
  } else {
    libDir = path.resolve(process.cwd(), 'data', `race_test_lib_${Date.now()}`);
    fs.mkdirSync(libDir, { recursive: true });
    createdTempLibDir = true;
    const insLib = await db.insert(libraries).values({
      name: 'Race Test Library',
      path: libDir,
    }).returning();
    libId = insLib[0].id;
  }

  const fallbackSongPath = path.join(libDir, 'Race Ready Artist', 'Race Ready Artist - Ready Song.mp3');
  createdDirs.push(path.dirname(fallbackSongPath));
  readyLibSongId = await createLibrarySong('Ready Song', 'Race Ready Artist', fallbackSongPath);
});

test('1. DownloadQueueManager supports deferred start and discarding unstarted jobs', async () => {
  const manager = new DownloadQueueManager();
  let processCalled = false;
  (manager as any).processTrack = async (_job: any, track: any) => {
    processCalled = true;
    track.status = 'completed';
  };

  const deferredJob = await manager.addJob({
    userId: hostUserId,
    libraryId: libId,
    libraryPath: libDir,
    deferStart: true,
    tracks: [{ title: 'Deferred Track', artist: 'Deferred Artist' }],
  });

  assert.equal(deferredJob.status, 'queued');
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(processCalled, false, 'processTrack must not start while deferStart job is unstarted');

  const discarded = await manager.discardUnstartedJob(deferredJob.id);
  assert.equal(discarded, true);
  assert.equal(await manager.getJob(deferredJob.id), null, 'Discarded unstarted job must be removed');
  assert.equal(processCalled, false, 'Discarded job must never run processTrack');

  const startableJob = await manager.addJob({
    userId: hostUserId,
    libraryId: libId,
    libraryPath: libDir,
    deferStart: true,
    tracks: [{ title: 'Startable Track', artist: 'Startable Artist' }],
  });
  assert.equal(processCalled, false);

  const started = await manager.startJob(startableJob.id);
  assert.equal(started, true);
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(processCalled, true, 'startJob must trigger processTrack execution');
});

test('2. Fast/immediate download completion: queue_items exists before worker updates and transitions to ready with songId', async () => {
  const session = await createTestSession('ImmediateComplete');
  const artistName = 'Immediate Complete Artist';
  const title = `Instant Complete ${Date.now()}`;
  const artistDir = path.join(libDir, artistName);
  const destFile = path.join(artistDir, `${artistName} - ${title}.mp3`);
  createdDirs.push(artistDir);
  fs.mkdirSync(artistDir, { recursive: true });
  fs.writeFileSync(destFile, Buffer.alloc(4096, 'z'));
  createdFiles.push(destFile);

  const originalEnqueue = processingQueue.enqueue.bind(processingQueue);
  let sawQueueRowBeforeProcessing = false;
  let createdSongId: number | null = null;

  (processingQueue as any).enqueue = async (req: ProcessSongRequest) => {
    // Worker must find the queue_items row already present in DB!
    const preRows = await db.select().from(queueItems).where(eq(queueItems.downloadTrackId, req.downloadTrackId));
    sawQueueRowBeforeProcessing = preRows.length === 1;

    await db.update(queueItems)
      .set({ downloadStatus: 'processing' })
      .where(eq(queueItems.downloadTrackId, req.downloadTrackId));

    createdSongId = await createLibrarySong(req.title, req.artist, req.originalAudioPath);
    await db.update(queueItems)
      .set({ songId: createdSongId, downloadStatus: 'ready' })
      .where(eq(queueItems.downloadTrackId, req.downloadTrackId));

    const matched = await db.select().from(queueItems).where(eq(queueItems.downloadTrackId, req.downloadTrackId));
    for (const row of matched) notifyQueueUpdate(row.sessionId);
  };

  try {
    const queueRes = await fetch(`${baseUrl}/api/karaoke/sessions/${session.id}/queue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({
        track: { title, artist: artistName },
      }),
    });
    assert.equal(queueRes.status, 200);
    const queued = await queueRes.json();

    // Poll briefly for completion
    let item: any = null;
    for (let i = 0; i < 40; i++) {
      const rows = await db.select().from(queueItems).where(eq(queueItems.id, queued.id)).limit(1);
      item = rows[0];
      if (item?.downloadStatus === 'ready') break;
      await new Promise((r) => setTimeout(r, 25));
    }

    assert.equal(sawQueueRowBeforeProcessing, true, 'queue_items row must exist before worker processes download');
    assert.equal(item.downloadStatus, 'ready', 'Fast download must reach ready and never get stuck in downloading');
    assert.equal(item.songId, createdSongId, 'Ready queue item must receive the imported songId');
  } finally {
    (processingQueue as any).enqueue = originalEnqueue;
  }
});

test('3. Immediate download/processing failure transitions queue_items to failed (never stuck downloading)', async () => {
  const session = await createTestSession('ImmediateFail');
  const artistName = 'Immediate Fail Artist';
  const title = `Instant Fail ${Date.now()}`;
  const artistDir = path.join(libDir, artistName);
  const destFile = path.join(artistDir, `${artistName} - ${title}.mp3`);
  createdDirs.push(artistDir);
  fs.mkdirSync(artistDir, { recursive: true });
  // Exists on disk -> processTrack reaches persistTrackUpdate immediately without calling yt-dlp
  fs.writeFileSync(destFile, Buffer.alloc(4096, 'f'));
  createdFiles.push(destFile);

  const originalEnqueue = processingQueue.enqueue.bind(processingQueue);
  let sawQueueRowBeforeFailure = false;

  (processingQueue as any).enqueue = async (req: ProcessSongRequest) => {
    const preRows = await db.select().from(queueItems).where(eq(queueItems.downloadTrackId, req.downloadTrackId));
    sawQueueRowBeforeFailure = preRows.length === 1;
    throw new Error('Simulated immediate processing failure');
  };

  try {
    const queueRes = await fetch(`${baseUrl}/api/karaoke/sessions/${session.id}/queue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({
        track: { title, artist: artistName },
      }),
    });
    assert.equal(queueRes.status, 200);
    const queued = await queueRes.json();

    let item: any = null;
    for (let i = 0; i < 40; i++) {
      const rows = await db.select().from(queueItems).where(eq(queueItems.id, queued.id)).limit(1);
      item = rows[0];
      if (item?.downloadStatus === 'failed') break;
      await new Promise((r) => setTimeout(r, 25));
    }

    assert.equal(sawQueueRowBeforeFailure, true, 'queue_items row must exist before immediate worker failure');
    assert.equal(item.downloadStatus, 'failed', 'Failed download/processing must transition queue item to failed');
    assert.equal(item.songId, null);
  } finally {
    (processingQueue as any).enqueue = originalEnqueue;
  }
});

test('4. Pre-processing track failure (no valid YouTube stream / download failure) updates existing queue_items to failed', async () => {
  const session = await createTestSession('PreProcessFail');
  const title = `PreFail ${Date.now()}`;
  const artistName = 'PreFail Artist';

  const originalProcessTrack = (downloadQueue as any).processTrack;
  let sawRowBeforeFailurePersist = false;

  (downloadQueue as any).processTrack = async function (_job: any, track: any) {
    const preRows = await db.select().from(queueItems).where(eq(queueItems.downloadTrackId, track.id));
    sawRowBeforeFailurePersist = preRows.length === 1;
    track.status = 'failed';
    track.progress = 0;
    track.error = 'Simulated immediate YouTube match failure';
    await this.persistTrackUpdate(track);
  };

  try {
    const queueRes = await fetch(`${baseUrl}/api/karaoke/sessions/${session.id}/queue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({
        track: { title, artist: artistName },
      }),
    });
    assert.equal(queueRes.status, 200);
    const queued = await queueRes.json();

    let item: any = null;
    for (let i = 0; i < 40; i++) {
      const rows = await db.select().from(queueItems).where(eq(queueItems.id, queued.id)).limit(1);
      item = rows[0];
      if (item?.downloadStatus === 'failed') break;
      await new Promise((r) => setTimeout(r, 25));
    }

    assert.equal(sawRowBeforeFailurePersist, true, 'queue_items must exist before processTrack persists immediate failure');
    assert.equal(item.downloadStatus, 'failed');
  } finally {
    (downloadQueue as any).processTrack = originalProcessTrack;
  }
});

test('5. Async/delayed download transitions downloading -> processing -> ready with songId and notifies room WebSocket', async () => {
  const session = await createTestSession('DelayedDownload');
  const title = `Delayed Track ${Date.now()}`;
  const artistName = 'Delayed Artist';
  const artistDir = path.join(libDir, artistName);
  const destFile = path.join(artistDir, `${artistName} - ${title}.mp3`);
  createdDirs.push(artistDir);

  const wsUrl = `${baseUrl.replace('http', 'ws')}/ws/karaoke?sessionId=${session.id}&isHost=true&token=${hostToken}`;
  const wsClient = new WebSocket(wsUrl);
  const wsEvents: string[] = [];

  await new Promise<void>((resolve, reject) => {
    wsClient.on('open', () => resolve());
    wsClient.on('error', reject);
  });

  wsClient.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg?.type) wsEvents.push(msg.type);
    } catch {}
  });

  const originalProcessTrack = (downloadQueue as any).processTrack;
  const originalEnqueue = processingQueue.enqueue.bind(processingQueue);
  let releaseDownload!: () => void;
  const downloadGate = new Promise<void>((resolve) => {
    releaseDownload = resolve;
  });
  let createdSongId: number | null = null;

  (downloadQueue as any).processTrack = async function (_job: any, track: any) {
    // Simulate async network download taking time
    await downloadGate;
    fs.mkdirSync(artistDir, { recursive: true });
    fs.writeFileSync(destFile, Buffer.alloc(4096, 'd'));
    createdFiles.push(destFile);
    track.status = 'completed';
    track.progress = 100;
    track.outputPath = destFile;
    track.error = null;
    await this.persistTrackUpdate(track);
  };

  (processingQueue as any).enqueue = async (req: ProcessSongRequest) => {
    await db.update(queueItems)
      .set({ downloadStatus: 'processing' })
      .where(eq(queueItems.downloadTrackId, req.downloadTrackId));
    const matched = await db.select().from(queueItems).where(eq(queueItems.downloadTrackId, req.downloadTrackId));
    for (const row of matched) notifyQueueUpdate(row.sessionId);

    await new Promise((r) => setTimeout(r, 40));
    createdSongId = await createLibrarySong(req.title, req.artist, req.originalAudioPath);
    await db.update(queueItems)
      .set({ songId: createdSongId, downloadStatus: 'ready' })
      .where(eq(queueItems.downloadTrackId, req.downloadTrackId));
    for (const row of matched) notifyQueueUpdate(row.sessionId);
  };

  try {
    const queueRes = await fetch(`${baseUrl}/api/karaoke/sessions/${session.id}/queue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({
        track: { title, artist: artistName },
      }),
    });
    assert.equal(queueRes.status, 200);
    const queued = await queueRes.json();
    assert.equal(queued.downloadStatus, 'downloading');
    assert.equal(queued.songId, null);

    // Confirm HTTP /state sees downloading while in progress
    const stateWhileDownloading = await fetch(`${baseUrl}/api/karaoke/sessions/${session.id}/state`, {
      headers: { Authorization: `Bearer ${hostToken}` },
    }).then((r) => r.json());
    assert.equal(stateWhileDownloading.queue.length, 1);
    assert.equal(stateWhileDownloading.queue[0].downloadStatus, 'downloading');

    // Release download so it enters processing -> ready
    releaseDownload();

    let finalItem: any = null;
    for (let i = 0; i < 60; i++) {
      const state = await fetch(`${baseUrl}/api/karaoke/sessions/${session.id}/state`, {
        headers: { Authorization: `Bearer ${hostToken}` },
      }).then((r) => r.json());
      finalItem = state.queue[0];
      if (finalItem?.downloadStatus === 'ready' && finalItem?.status === 'playing') break;
      await new Promise((r) => setTimeout(r, 25));
    }

    assert.equal(finalItem.downloadStatus, 'ready');
    assert.equal(finalItem.songId, createdSongId);
    assert.equal(finalItem.status, 'playing', 'checkAndAutoPlay must start playing once top downloading item becomes ready');
    assert.ok(wsEvents.includes('SONG_CHANGED'), 'WebSocket must receive SONG_CHANGED when download becomes ready');
    assert.ok(wsEvents.includes('QUEUE_UPDATED'), 'WebSocket must receive QUEUE_UPDATED');
  } finally {
    wsClient.close();
    (downloadQueue as any).processTrack = originalProcessTrack;
    (processingQueue as any).enqueue = originalEnqueue;
  }
});

test('6. Repeated submissions by same requester do not create duplicate queue entries, while distinct requesters reuse active download', async () => {
  const session = await createTestSession('DedupSubmissions');
  const title = `Repeat Track ${Date.now()}`;
  const artistName = 'Repeat Artist';

  // Join as two distinct guests in the same session
  const joinRes1 = await fetch(`${baseUrl}/api/karaoke/sessions/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomCode: session.roomCode, guestName: 'GuestOne', device: 'Phone1' }),
  });
  assert.equal(joinRes1.status, 200);
  const guest1 = await joinRes1.json();
  assert.ok(guest1.controllerId);

  const joinRes2 = await fetch(`${baseUrl}/api/karaoke/sessions/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomCode: session.roomCode, guestName: 'GuestTwo', device: 'Phone2' }),
  });
  assert.equal(joinRes2.status, 200);
  const guest2 = await joinRes2.json();
  assert.ok(guest2.controllerId);

  const originalProcessTrack = (downloadQueue as any).processTrack;
  let releaseDownload!: () => void;
  const downloadGate = new Promise<void>((resolve) => {
    releaseDownload = resolve;
  });
  let startedDownloadCount = 0;

  (downloadQueue as any).processTrack = async function (_job: any, track: any) {
    startedDownloadCount++;
    await downloadGate;
    track.status = 'failed';
    track.error = 'Test cleanup';
    await this.persistTrackUpdate(track);
  };

  try {
    // Host sends concurrent duplicate submissions for the same track
    const [hostRes1, hostRes2] = await Promise.all([
      fetch(`${baseUrl}/api/karaoke/sessions/${session.id}/queue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({ track: { title, artist: artistName } }),
      }),
      fetch(`${baseUrl}/api/karaoke/sessions/${session.id}/queue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hostToken}`,
        },
        body: JSON.stringify({ track: { title, artist: artistName } }),
      }),
    ]);

    assert.equal(hostRes1.status, 200);
    assert.equal(hostRes2.status, 200);
    const hostItem1 = await hostRes1.json();
    const hostItem2 = await hostRes2.json();
    assert.equal(hostItem1.id, hostItem2.id, 'Repeated host submission must return existing queue item without duplicating');

    // Guest 1 repeats submission twice
    const g1Res1 = await fetch(`${baseUrl}/api/karaoke/sessions/${session.id}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ track: { title, artist: artistName }, controllerId: guest1.controllerId }),
    });
    const g1Res2 = await fetch(`${baseUrl}/api/karaoke/sessions/${session.id}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ track: { title, artist: artistName }, controllerId: guest1.controllerId }),
    });
    const g1Item1 = await g1Res1.json();
    const g1Item2 = await g1Res2.json();
    assert.equal(g1Item1.id, g1Item2.id, 'Repeated guest submission must return existing queue item without duplicating');
    assert.notEqual(g1Item1.id, hostItem1.id, 'Distinct requester gets their own queue turn');
    assert.equal(g1Item1.downloadTrackId, hostItem1.downloadTrackId, 'Distinct requester reuses active downloadTrackId');

    // Guest 2 submits once -> gets own turn reusing the same downloadTrackId
    const g2Res = await fetch(`${baseUrl}/api/karaoke/sessions/${session.id}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ track: { title, artist: artistName }, controllerId: guest2.controllerId }),
    });
    const g2Item = await g2Res.json();
    assert.equal(g2Item.downloadTrackId, hostItem1.downloadTrackId);

    // Wait briefly to confirm only 1 download was ever spawned
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(startedDownloadCount, 1, 'Reused download must only execute once');

    const rowsInSession = await db.select().from(queueItems).where(eq(queueItems.sessionId, session.id));
    assert.equal(rowsInSession.length, 3, 'Must have exactly 3 queue entries (host + guest1 + guest2), no duplicates');
  } finally {
    releaseDownload();
    await new Promise((r) => setTimeout(r, 30));
    (downloadQueue as any).processTrack = originalProcessTrack;
  }
});

test('7. Cross-session duplicate reuse handles already-completed or already-failed track jobs safely', async () => {
  const sessionA = await createTestSession('CrossSessionA');
  const sessionB = await createTestSession('CrossSessionB');
  const title = `CrossTrack ${Date.now()}`;
  const artistName = 'CrossArtist';
  const artistDir = path.join(libDir, artistName);
  const destFile = path.join(artistDir, `${artistName} - ${title}.mp3`);
  createdDirs.push(artistDir);

  // Create a synthetic active queue item in sessionA whose underlying trackJob already completed
  const completedJobId = `job_cross_${Date.now()}`;
  const completedTrackId = `tr_cross_${Date.now()}`;
  const now = new Date();
  await db.insert(downloadJobs).values({
    id: completedJobId,
    userId: hostUserId,
    type: 'playlist',
    status: 'completed',
    libraryId: libId,
    libraryPath: libDir,
    totalCount: 1,
    completedCount: 1,
    failedCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(downloadTrackJobs).values({
    id: completedTrackId,
    jobId: completedJobId,
    title,
    artist: artistName,
    album: 'Single',
    status: 'completed',
    progress: 100,
    outputPath: destFile,
    position: 0,
    createdAt: now,
    updatedAt: now,
  });

  // Deliberately simulate a stale downloading queue item in sessionA while trackJob is already completed with a real song
  const importedSongId = await createLibrarySong(title, artistName, destFile);
  await db.insert(queueItems).values({
    sessionId: sessionA.id,
    songId: null,
    userId: hostUserId,
    addedAt: now,
    position: 1,
    status: 'pending',
    tempTitle: title,
    tempArtist: artistName,
    downloadJobId: completedJobId,
    downloadTrackId: completedTrackId,
    downloadStatus: 'downloading',
  });

  // Ensure local song lookup does NOT short-circuit before testing dup path by using an artist/title mismatch only if needed;
  // Wait: local library lookup uses findExistingSongRecord, so test specifically with a track that has different album/temp title
  // OR verify both ready resolution and failed-track non-reuse directly:
  const failTitle = `CrossFail ${Date.now()}`;
  const failArtist = 'CrossFailArtist';
  const failedJobId = `job_cross_fail_${Date.now()}`;
  const failedTrackId = `tr_cross_fail_${Date.now()}`;
  await db.insert(downloadJobs).values({
    id: failedJobId,
    userId: hostUserId,
    type: 'playlist',
    status: 'failed',
    libraryId: libId,
    libraryPath: libDir,
    totalCount: 1,
    completedCount: 0,
    failedCount: 1,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(downloadTrackJobs).values({
    id: failedTrackId,
    jobId: failedJobId,
    title: failTitle,
    artist: failArtist,
    album: 'Single',
    status: 'failed',
    progress: 0,
    error: 'Previous failure',
    position: 0,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(queueItems).values({
    sessionId: sessionA.id,
    songId: null,
    userId: hostUserId,
    addedAt: now,
    position: 2,
    status: 'pending',
    tempTitle: failTitle,
    tempArtist: failArtist,
    downloadJobId: failedJobId,
    downloadTrackId: failedTrackId,
    downloadStatus: 'downloading',
  });

  const originalProcessTrack = (downloadQueue as any).processTrack;
  (downloadQueue as any).processTrack = async function (_job: any, track: any) {
    track.status = 'completed';
    track.progress = 100;
    track.outputPath = destFile;
    await this.persistTrackUpdate(track);
  };
  const originalEnqueue = processingQueue.enqueue.bind(processingQueue);
  (processingQueue as any).enqueue = async (req: ProcessSongRequest) => {
    await db.update(queueItems)
      .set({ songId: importedSongId, downloadStatus: 'ready' })
      .where(eq(queueItems.downloadTrackId, req.downloadTrackId));
  };

  try {
    // SessionB queues failTitle -> must NOT reuse failedTrackId, starts fresh downloadTrackId
    const resB = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionB.id}/queue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ track: { title: failTitle, artist: failArtist } }),
    });
    assert.equal(resB.status, 200);
    const itemB = await resB.json();
    assert.notEqual(itemB.downloadTrackId, failedTrackId, 'Must not attach new queue item to an already-failed track job');

    // Also test cross-session reuse when dup trackJob already completed and songs.mainAudioPath exists,
    // using a slightly different artist credit string so findExistingSongRecord does not short-circuit before dup check.
    const resCompleted = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionB.id}/queue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ track: { title, artist: artistName } }),
    });
    assert.equal(resCompleted.status, 200);
    const itemCompleted = await resCompleted.json();
    assert.equal(itemCompleted.songId, importedSongId, 'Completed song must resolve to imported songId');
    assert.notEqual(itemCompleted.downloadStatus, 'downloading', 'Completed track must never remain stuck in downloading');
  } finally {
    (downloadQueue as any).processTrack = originalProcessTrack;
    (processingQueue as any).enqueue = originalEnqueue;
  }
});

test('8. Queue ordering & advancement: ready item moves ahead of downloading item, failed item stays non-blocking', async () => {
  const session = await createTestSession('OrderingAndAdvancement');
  const title = `Order Track ${Date.now()}`;
  const artistName = 'Order Artist';

  const originalProcessTrack = (downloadQueue as any).processTrack;
  let releaseFailure!: () => void;
  const failGate = new Promise<void>((resolve) => {
    releaseFailure = resolve;
  });

  (downloadQueue as any).processTrack = async function (_job: any, track: any) {
    await failGate;
    track.status = 'failed';
    track.error = 'Simulated failure for queue advancement';
    await this.persistTrackUpdate(track);
  };

  try {
    // 1. Add external downloading track at position 1
    const dlRes = await fetch(`${baseUrl}/api/karaoke/sessions/${session.id}/queue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ track: { title, artist: artistName } }),
    });
    assert.equal(dlRes.status, 200);
    const dlItem = await dlRes.json();

    // 2. Add ready library song at position 2
    const libRes = await fetch(`${baseUrl}/api/karaoke/sessions/${session.id}/queue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ songId: readyLibSongId }),
    });
    assert.equal(libRes.status, 200);
    const libItem = await libRes.json();

    assert.equal(dlItem.position, 1);

    // Ready song at position 2 must move ahead of downloading item and start playing
    await checkAndAutoPlay(session.id);
    const midRows = await db.select().from(queueItems)
      .where(eq(queueItems.sessionId, session.id))
      .orderBy(asc(queueItems.position));
    assert.equal(midRows[0].id, libItem.id, 'Ready item must move ahead of downloading item');
    assert.equal(midRows[0].status, 'playing', 'Ready item must be promoted to playing');
    assert.equal(midRows[1].id, dlItem.id, 'Downloading item must move behind ready item');
    assert.equal(midRows[1].status, 'pending', 'Downloading item must remain pending');

    // Release failure -> downloading item becomes failed without interrupting playing item
    releaseFailure();

    let afterRows: any[] = [];
    for (let i = 0; i < 40; i++) {
      afterRows = await db.select().from(queueItems)
        .where(eq(queueItems.sessionId, session.id))
        .orderBy(asc(queueItems.position));
      if (afterRows.some((r) => r.id === dlItem.id && r.downloadStatus === 'failed')) break;
      await new Promise((r) => setTimeout(r, 25));
    }

    const playingRow = afterRows.find((r) => r.id === libItem.id);
    const failedRow = afterRows.find((r) => r.id === dlItem.id);
    assert.equal(playingRow?.status, 'playing', 'Failure of downloading item must not interrupt active playing song');
    assert.equal(failedRow?.downloadStatus, 'failed', 'Failed download item must be marked failed');

    // Advancing cleans up playing item and leaves failed item non-playing without error
    await advanceQueueBySessionId(session.id);
    const remaining = await db.select().from(queueItems).where(eq(queueItems.sessionId, session.id));
    assert.equal(remaining.some((r) => r.id === libItem.id), false, 'Played song should be removed on advance');
    assert.equal(remaining.every((r) => r.status !== 'playing'), true, 'Failed item must not start playing');
  } finally {
    (downloadQueue as any).processTrack = originalProcessTrack;
  }
});

test('A. Processing completion does NOT interrupt active playing song (playing or paused)', async () => {
  const session = await createTestSession('TestA_NoInterrupt');
  const songAId = await createLibrarySong(
    `Song A ${Date.now()}`,
    'Artist A',
    path.join(libDir, 'Artist A', `Artist A - Song A ${Date.now()}.mp3`)
  );
  const songBPath = path.join(libDir, 'Artist B', `Artist B - Song B ${Date.now()}.mp3`);

  const wsUrl = `${baseUrl.replace('http', 'ws')}/ws/karaoke?sessionId=${session.id}&isHost=true&token=${hostToken}`;
  const wsClient = new WebSocket(wsUrl);
  const wsMessages: Array<{ type: string; payload?: any }> = [];

  await new Promise<void>((resolve, reject) => {
    wsClient.on('open', () => resolve());
    wsClient.on('error', reject);
  });
  wsClient.on('message', (raw) => {
    try {
      wsMessages.push(JSON.parse(raw.toString()));
    } catch {}
  });

  try {
    // Song A is actively playing at position 1
    const [itemA] = await db.insert(queueItems).values({
      sessionId: session.id,
      songId: songAId,
      userId: hostUserId,
      position: 1,
      status: 'playing',
      addedAt: new Date(),
    }).returning();

    // Song B is processing at position 2
    const trackIdB = `tr_testA_${Date.now()}`;
    const [itemB] = await db.insert(queueItems).values({
      sessionId: session.id,
      songId: null,
      userId: hostUserId,
      position: 2,
      status: 'pending',
      tempTitle: 'Song B',
      tempArtist: 'Artist B',
      downloadJobId: `job_testA_${Date.now()}`,
      downloadTrackId: trackIdB,
      downloadStatus: 'processing',
      addedAt: new Date(),
    }).returning();

    const room = getRoomState(session.id)!;
    room.currentSongId = songAId;
    room.currentQueueItemId = itemA.id;
    room.playing = true;

    wsMessages.length = 0;

    // Song B finishes processing while Song A is actively playing
    const songBId = await createLibrarySong(`Song B ${Date.now()}`, 'Artist B', songBPath);
    await db.update(queueItems)
      .set({ songId: songBId, downloadStatus: 'ready' })
      .where(eq(queueItems.id, itemB.id));

    await checkAndAutoPlay(session.id);
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(
      wsMessages.some((m) => m.type === 'SONG_CHANGED'),
      false,
      'SONG_CHANGED must NOT be emitted when Song B finishes processing during Song A'
    );
    assert.equal(
      wsMessages.some((m) => m.type === 'QUEUE_UPDATED'),
      true,
      'QUEUE_UPDATED must be emitted'
    );

    const rows = await db.select().from(queueItems)
      .where(eq(queueItems.sessionId, session.id))
      .orderBy(asc(queueItems.position));
    assert.equal(rows[0].id, itemA.id);
    assert.equal(rows[0].status, 'playing', 'Song A must remain playing');
    assert.equal(rows[1].id, itemB.id);
    assert.equal(rows[1].status, 'pending', 'Song B must remain pending behind Song A');
    assert.equal(room.currentSongId, songAId);
    assert.equal(room.currentQueueItemId, itemA.id);
    assert.equal(room.playing, true);

    // Even if host temporarily pauses Song A, newly ready Song C must still NOT replace Song A
    room.playing = false;
    const [itemC] = await db.insert(queueItems).values({
      sessionId: session.id,
      songId: readyLibSongId,
      userId: hostUserId,
      position: 3,
      status: 'pending',
      downloadStatus: 'ready',
      addedAt: new Date(),
    }).returning();

    wsMessages.length = 0;
    await checkAndAutoPlay(session.id);
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(wsMessages.some((m) => m.type === 'SONG_CHANGED'), false, 'Paused active song A must not be interrupted');
    assert.equal(room.currentQueueItemId, itemA.id);
    const rowC = (await db.select().from(queueItems).where(eq(queueItems.id, itemC.id)))[0];
    assert.equal(rowC.status, 'pending');
  } finally {
    wsClient.close();
  }
});

test('B. Ready song moves ahead of downloading/processing song when turn arrives', async () => {
  const session = await createTestSession('TestB_ReadyAhead');
  const songXId = await createLibrarySong(
    `Song X ${Date.now()}`,
    'Artist X',
    path.join(libDir, 'Artist X', `Artist X - Song X ${Date.now()}.mp3`)
  );
  const songAId = await createLibrarySong(
    `Song A ${Date.now()}`,
    'Artist A',
    path.join(libDir, 'Artist A', `Artist A - Song A B ${Date.now()}.mp3`)
  );

  const [itemX] = await db.insert(queueItems).values({
    sessionId: session.id,
    songId: songXId,
    userId: hostUserId,
    position: 1,
    status: 'playing',
    addedAt: new Date(),
  }).returning();

  const [itemB] = await db.insert(queueItems).values({
    sessionId: session.id,
    songId: null,
    userId: hostUserId,
    position: 2,
    status: 'pending',
    tempTitle: 'Song B',
    tempArtist: 'Artist B',
    downloadStatus: 'downloading',
    addedAt: new Date(),
  }).returning();

  const [itemA] = await db.insert(queueItems).values({
    sessionId: session.id,
    songId: songAId,
    userId: hostUserId,
    position: 3,
    status: 'pending',
    addedAt: new Date(),
  }).returning();

  const room = await (await import('../ws/index.js')).getOrCreateRoom(session.id);
  room.currentSongId = songXId;
  room.currentQueueItemId = itemX.id;
  room.playing = true;

  // Song X finishes while Song B is still downloading and Song A is ready
  await advanceQueueBySessionId(session.id);

  const rows = await db.select().from(queueItems)
    .where(eq(queueItems.sessionId, session.id))
    .orderBy(asc(queueItems.position));

  assert.equal(rows.length, 2, 'Song X should be removed leaving Song A and Song B');
  assert.equal(rows[0].id, itemA.id, 'Ready Song A must move ahead of downloading Song B');
  assert.equal(rows[0].status, 'playing', 'Song A must become playing');
  assert.equal(rows[1].id, itemB.id, 'Downloading Song B must move behind Song A');
  assert.equal(rows[1].status, 'pending', 'Song B must remain pending');
  assert.equal(rows[1].downloadStatus, 'downloading');
  assert.ok(rows[0].position < rows[1].position, 'DB position of Song A must be less than Song B');
  assert.equal(room.currentSongId, songAId);
  assert.equal(room.playing, true);
});

test('C. Delayed song remains queued behind ready song and eventually plays once ready', async () => {
  const session = await createTestSession('TestC_DelayedPlaysLater');
  const songXId = await createLibrarySong(
    `Song X C ${Date.now()}`,
    'Artist XC',
    path.join(libDir, 'Artist XC', `Artist XC - Song X ${Date.now()}.mp3`)
  );
  const songAId = await createLibrarySong(
    `Song A C ${Date.now()}`,
    'Artist AC',
    path.join(libDir, 'Artist AC', `Artist AC - Song A ${Date.now()}.mp3`)
  );
  const songBPath = path.join(libDir, 'Artist BC', `Artist BC - Song B ${Date.now()}.mp3`);

  const wsUrl = `${baseUrl.replace('http', 'ws')}/ws/karaoke?sessionId=${session.id}&isHost=true&token=${hostToken}`;
  const wsClient = new WebSocket(wsUrl);
  const wsEvents: Array<{ type: string; payload?: any }> = [];

  await new Promise<void>((resolve, reject) => {
    wsClient.on('open', () => resolve());
    wsClient.on('error', reject);
  });
  wsClient.on('message', (raw) => {
    try { wsEvents.push(JSON.parse(raw.toString())); } catch {}
  });

  try {
    const [itemX] = await db.insert(queueItems).values({
      sessionId: session.id,
      songId: songXId,
      userId: hostUserId,
      position: 1,
      status: 'playing',
      addedAt: new Date(),
    }).returning();

    const [itemB] = await db.insert(queueItems).values({
      sessionId: session.id,
      songId: null,
      userId: hostUserId,
      position: 2,
      status: 'pending',
      tempTitle: 'Delayed Song B',
      tempArtist: 'Artist BC',
      downloadStatus: 'processing',
      addedAt: new Date(),
    }).returning();

    const [itemA] = await db.insert(queueItems).values({
      sessionId: session.id,
      songId: songAId,
      userId: hostUserId,
      position: 3,
      status: 'pending',
      addedAt: new Date(),
    }).returning();

    const room = getRoomState(session.id)!;
    room.currentSongId = songXId;
    room.currentQueueItemId = itemX.id;
    room.playing = true;

    // 1. Song X finishes -> Song A plays, Song B stays pending
    await advanceQueueBySessionId(session.id);
    assert.equal(room.currentSongId, songAId);
    assert.equal(room.playing, true);

    // 2. Song A finishes while Song B is still processing -> room enters waiting state
    await new Promise((r) => setTimeout(r, 420));
    wsEvents.length = 0;
    await advanceQueueBySessionId(session.id);
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(room.currentSongId, null, 'Room must clear active song when only unready song remains');
    assert.equal(room.playing, false, 'Room must not stay playing while waiting');
    assert.equal(wsEvents.some((e) => e.type === 'QUEUE_EMPTY'), true, 'QUEUE_EMPTY must be emitted while waiting');

    const waitingRows = await db.select().from(queueItems).where(eq(queueItems.sessionId, session.id));
    assert.equal(waitingRows.length, 1);
    assert.equal(waitingRows[0].id, itemB.id);
    assert.equal(waitingRows[0].status, 'pending');

    // 3. Delayed Song B finishes processing and becomes ready -> checkAndAutoPlay starts Song B
    const songBId = await createLibrarySong(`Delayed Song B ${Date.now()}`, 'Artist BC', songBPath);
    await db.update(queueItems)
      .set({ songId: songBId, downloadStatus: 'ready' })
      .where(eq(queueItems.id, itemB.id));

    wsEvents.length = 0;
    await checkAndAutoPlay(session.id);
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(room.currentSongId, songBId, 'Delayed Song B must play once ready');
    assert.equal(room.currentQueueItemId, itemB.id);
    assert.equal(room.playing, true);
    assert.equal(wsEvents.some((e) => e.type === 'SONG_CHANGED' && e.payload?.songId === songBId), true);

    const finalRows = await db.select().from(queueItems).where(eq(queueItems.sessionId, session.id));
    assert.equal(finalRows[0].status, 'playing');
  } finally {
    wsClient.close();
  }
});

test('D. Multiple unready songs and multiple ready songs maintain predictable order without loss or duplication', async () => {
  const session = await createTestSession('TestD_MultiUnready');
  const songXId = await createLibrarySong(`Multi X ${Date.now()}`, 'Artist MX', path.join(libDir, 'Artist MX', `MX-${Date.now()}.mp3`));
  const songAId = await createLibrarySong(`Multi A ${Date.now()}`, 'Artist MA', path.join(libDir, 'Artist MA', `MA-${Date.now()}.mp3`));
  const songDId = await createLibrarySong(`Multi D ${Date.now()}`, 'Artist MD', path.join(libDir, 'Artist MD', `MD-${Date.now()}.mp3`));

  const [itemX] = await db.insert(queueItems).values({
    sessionId: session.id, songId: songXId, userId: hostUserId, position: 1, status: 'playing', addedAt: new Date(),
  }).returning();
  const [itemB] = await db.insert(queueItems).values({
    sessionId: session.id, songId: null, userId: hostUserId, position: 2, status: 'pending', tempTitle: 'Song B', tempArtist: 'Artist MB', downloadStatus: 'processing', addedAt: new Date(),
  }).returning();
  const [itemC] = await db.insert(queueItems).values({
    sessionId: session.id, songId: null, userId: hostUserId, position: 3, status: 'pending', tempTitle: 'Song C', tempArtist: 'Artist MC', downloadStatus: 'downloading', addedAt: new Date(),
  }).returning();
  const [itemA] = await db.insert(queueItems).values({
    sessionId: session.id, songId: songAId, userId: hostUserId, position: 4, status: 'pending', addedAt: new Date(),
  }).returning();
  const [itemD] = await db.insert(queueItems).values({
    sessionId: session.id, songId: songDId, userId: hostUserId, position: 5, status: 'pending', addedAt: new Date(),
  }).returning();

  const room = await (await import('../ws/index.js')).getOrCreateRoom(session.id);
  room.currentSongId = songXId;
  room.currentQueueItemId = itemX.id;
  room.playing = true;

  // 1. Song X finishes -> Song A plays; [B, C] preserve relative order ahead of D
  await advanceQueueBySessionId(session.id);
  let rows = await db.select().from(queueItems).where(eq(queueItems.sessionId, session.id)).orderBy(asc(queueItems.position));
  assert.deepEqual(rows.map((r) => r.id), [itemA.id, itemB.id, itemC.id, itemD.id]);
  assert.equal(rows[0].status, 'playing');
  assert.equal(room.currentSongId, songAId);

  // 2. Song A finishes while B & C are still unready -> Song D plays; [B, C] remain in retained order behind D
  await new Promise((r) => setTimeout(r, 420));
  await advanceQueueBySessionId(session.id);
  rows = await db.select().from(queueItems).where(eq(queueItems.sessionId, session.id)).orderBy(asc(queueItems.position));
  assert.deepEqual(rows.map((r) => r.id), [itemD.id, itemB.id, itemC.id]);
  assert.equal(rows[0].status, 'playing');
  assert.equal(room.currentSongId, songDId);

  // 3. Song D finishes while B & C still unready -> room waits with [B, C] in retained order
  await new Promise((r) => setTimeout(r, 420));
  await advanceQueueBySessionId(session.id);
  rows = await db.select().from(queueItems).where(eq(queueItems.sessionId, session.id)).orderBy(asc(queueItems.position));
  assert.deepEqual(rows.map((r) => r.id), [itemB.id, itemC.id]);
  assert.equal(room.currentSongId, null);
  assert.equal(room.playing, false);

  // 4. Song C becomes ready first while Song B is still processing -> Song C plays, Song B stays queued behind C
  const songCId = await createLibrarySong(`Multi C ${Date.now()}`, 'Artist MC', path.join(libDir, 'Artist MC', `MC-${Date.now()}.mp3`));
  await db.update(queueItems).set({ songId: songCId, downloadStatus: 'ready' }).where(eq(queueItems.id, itemC.id));
  await checkAndAutoPlay(session.id);
  rows = await db.select().from(queueItems).where(eq(queueItems.sessionId, session.id)).orderBy(asc(queueItems.position));
  assert.deepEqual(rows.map((r) => r.id), [itemC.id, itemB.id]);
  assert.equal(rows[0].status, 'playing');
  assert.equal(room.currentSongId, songCId);

  // 5. Song B becomes ready while Song C is playing -> no interruption, then Song B plays after C finishes
  const songBId = await createLibrarySong(`Multi B ${Date.now()}`, 'Artist MB', path.join(libDir, 'Artist MB', `MB-${Date.now()}.mp3`));
  await db.update(queueItems).set({ songId: songBId, downloadStatus: 'ready' }).where(eq(queueItems.id, itemB.id));
  await checkAndAutoPlay(session.id);
  assert.equal(room.currentSongId, songCId, 'Song B becoming ready must not interrupt Song C');

  await new Promise((r) => setTimeout(r, 420));
  await advanceQueueBySessionId(session.id);
  rows = await db.select().from(queueItems).where(eq(queueItems.sessionId, session.id)).orderBy(asc(queueItems.position));
  assert.deepEqual(rows.map((r) => r.id), [itemB.id]);
  assert.equal(rows[0].status, 'playing');
  assert.equal(room.currentSongId, songBId);
});

test('E. No ready songs when current song finishes clears active song safely and resumes when ready', async () => {
  const session = await createTestSession('TestE_NoReadyWaiting');
  const songAId = await createLibrarySong(`Wait A ${Date.now()}`, 'Artist WA', path.join(libDir, 'Artist WA', `WA-${Date.now()}.mp3`));

  const wsUrl = `${baseUrl.replace('http', 'ws')}/ws/karaoke?sessionId=${session.id}&isHost=true&token=${hostToken}`;
  const wsClient = new WebSocket(wsUrl);
  const wsEvents: string[] = [];

  await new Promise<void>((resolve, reject) => {
    wsClient.on('open', () => resolve());
    wsClient.on('error', reject);
  });
  wsClient.on('message', (raw) => {
    try {
      const parsed = JSON.parse(raw.toString());
      if (parsed?.type) wsEvents.push(parsed.type);
    } catch {}
  });

  try {
    const [itemA] = await db.insert(queueItems).values({
      sessionId: session.id, songId: songAId, userId: hostUserId, position: 1, status: 'playing', addedAt: new Date(),
    }).returning();
    const [itemB] = await db.insert(queueItems).values({
      sessionId: session.id, songId: null, userId: hostUserId, position: 2, status: 'pending', tempTitle: 'Wait B', tempArtist: 'Artist WB', downloadStatus: 'downloading', addedAt: new Date(),
    }).returning();
    const [itemC] = await db.insert(queueItems).values({
      sessionId: session.id, songId: null, userId: hostUserId, position: 3, status: 'pending', tempTitle: 'Wait C', tempArtist: 'Artist WC', downloadStatus: 'processing', addedAt: new Date(),
    }).returning();

    const room = getRoomState(session.id)!;
    room.currentSongId = songAId;
    room.currentQueueItemId = itemA.id;
    room.playing = true;

    wsEvents.length = 0;
    await advanceQueueBySessionId(session.id);
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(room.playing, false, 'room.playing must be false when no ready song exists');
    assert.equal(room.currentSongId, null, 'room.currentSongId must be null when no ready song exists');
    assert.equal(room.currentQueueItemId, null, 'room.currentQueueItemId must be null when no ready song exists');
    assert.ok(wsEvents.includes('QUEUE_EMPTY'));
    assert.ok(wsEvents.includes('PAUSED'));

    const pending = await db.select().from(queueItems).where(eq(queueItems.sessionId, session.id)).orderBy(asc(queueItems.position));
    assert.deepEqual(pending.map((r) => r.id), [itemB.id, itemC.id]);
    assert.ok(pending.every((r) => r.status === 'pending'));

    // Later Song B becomes ready -> resumes playback cleanly
    const songBId = await createLibrarySong(`Wait B ${Date.now()}`, 'Artist WB', path.join(libDir, 'Artist WB', `WB-${Date.now()}.mp3`));
    await db.update(queueItems).set({ songId: songBId, downloadStatus: 'ready' }).where(eq(queueItems.id, itemB.id));
    await checkAndAutoPlay(session.id);

    assert.equal(room.playing, true);
    assert.equal(room.currentSongId, songBId);
    assert.equal(room.currentQueueItemId, itemB.id);
  } finally {
    wsClient.close();
  }
});

test('F. Failed song at top of queue does not block ready song behind it', async () => {
  const session = await createTestSession('TestF_FailedNonBlocking');
  const [failedItem] = await db.insert(queueItems).values({
    sessionId: session.id,
    songId: null,
    userId: hostUserId,
    position: 1,
    status: 'pending',
    tempTitle: 'Failed Song',
    tempArtist: 'Failed Artist',
    downloadStatus: 'failed',
    addedAt: new Date(),
  }).returning();

  const [readyItem] = await db.insert(queueItems).values({
    sessionId: session.id,
    songId: readyLibSongId,
    userId: hostUserId,
    position: 2,
    status: 'pending',
    addedAt: new Date(),
  }).returning();

  await checkAndAutoPlay(session.id);

  const room = getRoomState(session.id)!;
  assert.equal(room.playing, true);
  assert.equal(room.currentSongId, readyLibSongId);
  assert.equal(room.currentQueueItemId, readyItem.id);

  const rows = await db.select().from(queueItems).where(eq(queueItems.sessionId, session.id)).orderBy(asc(queueItems.position));
  const dbReady = rows.find((r) => r.id === readyItem.id);
  const dbFailed = rows.find((r) => r.id === failedItem.id);
  assert.equal(dbReady?.status, 'playing', 'Ready item behind failed item must play');
  assert.equal(dbFailed?.downloadStatus, 'failed', 'Failed entry remains marked failed per policy');
  assert.equal(dbFailed?.status, 'pending');
});

test('G. Host WebSocket PLAY and SYNC cannot set room.playing = true without a valid active song', async () => {
  const session = await createTestSession('TestG_PlayGuard');

  // Put only a downloading item (songId = null, status = 'pending') in the queue
  await db.insert(queueItems).values({
    sessionId: session.id,
    songId: null,
    userId: hostUserId,
    position: 1,
    status: 'pending',
    tempTitle: 'Unready Track',
    tempArtist: 'Unready Artist',
    downloadStatus: 'downloading',
    addedAt: new Date(),
  });

  const wsUrl = `${baseUrl.replace('http', 'ws')}/ws/karaoke?sessionId=${session.id}&isHost=true&token=${hostToken}`;
  const hostWs = new WebSocket(wsUrl);
  const receivedTypes: string[] = [];

  await new Promise<void>((resolve, reject) => {
    hostWs.on('open', () => resolve());
    hostWs.on('error', reject);
  });
  hostWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg?.type) receivedTypes.push(msg.type);
    } catch {}
  });

  try {
    await new Promise((r) => setTimeout(r, 40));
    receivedTypes.length = 0;

    // Attempt invalid PLAY and SYNC(playing: true) while no active song exists
    hostWs.send(JSON.stringify({ type: 'PLAY' }));
    hostWs.send(JSON.stringify({ type: 'SYNC', payload: { position: 12, playing: true } }));
    await new Promise((r) => setTimeout(r, 80));

    const room = getRoomState(session.id)!;
    assert.equal(room.playing, false, 'room.playing must remain false when no valid active song exists');
    assert.equal(room.currentSongId, null, 'room.currentSongId must remain null');
    assert.equal(room.currentQueueItemId, null, 'room.currentQueueItemId must remain null');
    assert.equal(receivedTypes.includes('PLAYING'), false, 'PLAYING broadcast must NOT be emitted without active song');
  } finally {
    hostWs.close();
  }
});

test('H. Frontend host (RoomSession) and guest (GuestRoom) queue helpers reflect authoritative backend state', async () => {
  // 1. Only unready (pos 1) and pending-ready (pos 2) -> host must NOT pick pending song as currentSong,
  //    and guest index 0 (downloading) must NOT show NOW PLAYING.
  const waitingQueue = [
    { id: 101, position: 1, status: 'pending', songId: null, downloadStatus: 'downloading', songTitle: 'Song B' },
    { id: 102, position: 2, status: 'pending', songId: 500, downloadStatus: 'ready', songTitle: 'Song A' },
  ];

  assert.equal(
    selectCurrentPlayingSong(waitingQueue),
    undefined,
    'Host RoomSession must not independently select a pending song as currentSong'
  );
  assert.equal(
    hasPreparingQueueItems(waitingQueue),
    true,
    'RoomSession must show preparing state while downloading/processing items remain'
  );
  assert.deepEqual(
    getUpcomingQueueItems(waitingQueue, undefined).map((i) => i.id),
    [101, 102],
    'Upcoming queue must include all non-playing items in order'
  );
  assert.equal(getQueueItemDisplayState(waitingQueue[0]), 'downloading', 'Guest index 0 downloading must not be playing');
  assert.equal(getQueueItemDisplayState(waitingQueue[1]), 'ready', 'Pending ready item must not be playing');

  // 2. Processing / failed / playing / pending-ready mix (even if failed item precedes playing item)
  const mixedQueue = [
    { id: 201, position: 1, status: 'pending', songId: null, downloadStatus: 'failed', songTitle: 'Failed' },
    { id: 202, position: 2, status: 'playing', songId: 501, downloadStatus: 'ready', songTitle: 'Playing' },
    { id: 203, position: 3, status: 'pending', songId: null, downloadStatus: 'processing', songTitle: 'Processing' },
    { id: 204, position: 4, status: 'pending', songId: 502, downloadStatus: 'ready', songTitle: 'Up Next' },
  ];

  const active = selectCurrentPlayingSong(mixedQueue);
  assert.equal(active?.id, 202, 'Authoritative currentSong must select status === playing item');
  assert.deepEqual(
    getUpcomingQueueItems(mixedQueue, active).map((i) => i.id),
    [201, 203, 204],
    'Upcoming queue must exclude only the playing item and never drop other items'
  );
  assert.equal(getQueueItemDisplayState(mixedQueue[0]), 'failed');
  assert.equal(getQueueItemDisplayState(mixedQueue[1]), 'playing');
  assert.equal(getQueueItemDisplayState(mixedQueue[2]), 'processing');
  assert.equal(getQueueItemDisplayState(mixedQueue[3]), 'ready');
});

test('Teardown karaoke Download & Queue race test harness', async () => {
  for (const sId of createdSessionIds) {
    await db.delete(queueItems).where(eq(queueItems.sessionId, sId));
    await db.delete(controllers).where(eq(controllers.sessionId, sId));
    await db.delete(sessions).where(eq(sessions.id, sId));
  }
  for (const songId of createdSongIds) {
    await db.delete(songs).where(eq(songs.id, songId));
  }
  for (const artistId of createdArtistIds) {
    await db.delete(artists).where(eq(artists.id, artistId));
  }
  if (createdTempLibDir && libDir && fs.existsSync(libDir)) {
    fs.rmSync(libDir, { recursive: true, force: true });
  } else {
    for (const f of createdFiles) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
    }
    for (const d of createdDirs) {
      try { if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true }); } catch {}
    }
  }

  wss?.close();
  if (typeof (server as any).closeAllConnections === 'function') {
    (server as any).closeAllConnections();
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    setTimeout(() => resolve(), 300);
  });
});
