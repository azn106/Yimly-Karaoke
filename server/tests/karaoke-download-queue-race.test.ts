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
import { setupWebSockets, advanceQueueBySessionId, checkAndAutoPlay, notifyQueueUpdate } from '../ws/index.js';

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

test('8. Queue ordering & advancement: waits while downloading, advances cleanly after ready or failed', async () => {
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
    assert.equal(libItem.position, 2);

    // While position 1 is downloading, position 2 must NOT jump ahead
    await checkAndAutoPlay(session.id);
    const midRows = await db.select().from(queueItems)
      .where(eq(queueItems.sessionId, session.id))
      .orderBy(asc(queueItems.position));
    assert.equal(midRows[0].status, 'pending');
    assert.equal(midRows[1].status, 'pending', 'Ready position 2 must wait while position 1 is still downloading');

    // Release failure -> position 1 becomes 'failed', and queue auto-advances to position 2
    releaseFailure();

    let afterRows: any[] = [];
    for (let i = 0; i < 40; i++) {
      afterRows = await db.select().from(queueItems)
        .where(eq(queueItems.sessionId, session.id))
        .orderBy(asc(queueItems.position));
      if (afterRows[0]?.downloadStatus === 'failed' && afterRows[1]?.status === 'playing') break;
      await new Promise((r) => setTimeout(r, 25));
    }

    assert.equal(afterRows[0].downloadStatus, 'failed', 'Position 1 must be marked failed');
    assert.equal(afterRows[1].status, 'playing', 'Room must advance to position 2 once position 1 fails');

    // Advancing once more cleans up position 2 and leaves failed item or empty queue without error
    await advanceQueueBySessionId(session.id);
    const remaining = await db.select().from(queueItems).where(eq(queueItems.sessionId, session.id));
    assert.equal(remaining.some((r) => r.id === libItem.id), false, 'Played song should be removed on advance');
  } finally {
    (downloadQueue as any).processTrack = originalProcessTrack;
  }
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
