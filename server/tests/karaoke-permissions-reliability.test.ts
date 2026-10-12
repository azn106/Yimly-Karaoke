import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import http from 'http';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { WebSocket, WebSocketServer } from 'ws';
import { db, setupDatabase } from '../db/index.js';
import { users, libraries, artists, songs, sessions, controllers, queueItems } from '../db/schema.js';
import { eq, and, asc } from 'drizzle-orm';
import karaokeRoutes from '../routes/karaoke.js';
import { setupWebSockets, getRoomState } from '../ws/index.js';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev';

let server: http.Server;
let baseUrl: string;
let wsUrl: string;
let wss: WebSocketServer;

let hostToken: string;
let hostUserId: number;

let attackerToken: string;
let attackerUserId: number;

let adminToken: string;
let adminUserId: number;

let memberToken: string;
let memberUserId: number;

let testSong1Id: number;
let testSong2Id: number;
let testSong3Id: number;

test('Setup Karaoke Permissions and Reliability Test Environment', async () => {
  await setupDatabase();

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/karaoke', karaokeRoutes);

  server = http.createServer(app);
  wss = new WebSocketServer({ server, path: '/ws/karaoke' });
  setupWebSockets(wss);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      wsUrl = `ws://127.0.0.1:${addr.port}/ws/karaoke`;
      resolve();
    });
  });

  const hashedPass = await bcrypt.hash('password123', 10);
  const timestamp = Date.now();

  // Create Host User
  const hostRes = await db.insert(users).values({
    username: `host_user_${timestamp}`,
    password: hashedPass,
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date()
  }).returning();
  hostUserId = hostRes[0].id;
  hostToken = jwt.sign({ id: hostUserId, username: hostRes[0].username, role: 'user' }, JWT_SECRET, { expiresIn: '1h' });

  // Create Attacker / Regular User
  const attackerRes = await db.insert(users).values({
    username: `attacker_user_${timestamp}`,
    password: hashedPass,
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date()
  }).returning();
  attackerUserId = attackerRes[0].id;
  attackerToken = jwt.sign({ id: attackerUserId, username: attackerRes[0].username, role: 'user' }, JWT_SECRET, { expiresIn: '1h' });

  // Create Admin User
  const adminRes = await db.insert(users).values({
    username: `admin_user_${timestamp}`,
    password: hashedPass,
    role: 'administrator',
    createdAt: new Date(),
    updatedAt: new Date()
  }).returning();
  adminUserId = adminRes[0].id;
  adminToken = jwt.sign({ id: adminUserId, username: adminRes[0].username, role: 'administrator' }, JWT_SECRET, { expiresIn: '1h' });

  // Create Member User (for reassignment)
  const memberRes = await db.insert(users).values({
    username: `member_user_${timestamp}`,
    password: hashedPass,
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date()
  }).returning();
  memberUserId = memberRes[0].id;
  memberToken = jwt.sign({ id: memberUserId, username: memberRes[0].username, role: 'user' }, JWT_SECRET, { expiresIn: '1h' });

  // Seed Library and Artist
  const libRes = await db.insert(libraries).values({
    name: `Test Lib ${timestamp}`,
    path: `/tmp/test_lib_${timestamp}`
  }).returning();

  const artistRes = await db.insert(artists).values({
    name: `Test Artist ${timestamp}`
  }).returning();

  // Seed Songs
  const song1 = await db.insert(songs).values({
    libraryId: libRes[0].id,
    artistId: artistRes[0].id,
    title: `Song One ${timestamp}`,
    mainAudioPath: '/tmp/song1.mp3',
    instrumentalAudioPath: '/tmp/song1_inst.mp3',
    duration: 180,
    variant: 'original'
  }).returning();
  testSong1Id = song1[0].id;

  const song2 = await db.insert(songs).values({
    libraryId: libRes[0].id,
    artistId: artistRes[0].id,
    title: `Song Two ${timestamp}`,
    mainAudioPath: '/tmp/song2.mp3',
    instrumentalAudioPath: '/tmp/song2_inst.mp3',
    duration: 210,
    variant: 'original'
  }).returning();
  testSong2Id = song2[0].id;

  const song3 = await db.insert(songs).values({
    libraryId: libRes[0].id,
    artistId: artistRes[0].id,
    title: `Song Three ${timestamp}`,
    mainAudioPath: '/tmp/song3.mp3',
    duration: 150,
    variant: 'original'
  }).returning();
  testSong3Id = song3[0].id;
});

test('1. Guest can join room and add song without authentication', async () => {
  // Host creates room
  const createRes = await fetch(`${baseUrl}/api/karaoke/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hostToken}`
    },
    body: JSON.stringify({ audioMode: 'instrumental', lyricsMode: 'elrc' })
  });
  assert.strictEqual(createRes.status, 200, 'Host must be able to create session');
  const session = await createRes.json();
  const sessionId = session.id;

  // Unauthenticated guest joins room
  const joinRes = await fetch(`${baseUrl}/api/karaoke/sessions/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      displayName: 'Alice Guest'
    })
  });
  assert.strictEqual(joinRes.status, 200, 'Guest should join without authentication');
  const joinData = await joinRes.json();
  assert.ok(joinData.controllerId, 'Join response must contain controllerId');
  assert.strictEqual(joinData.sessionId, sessionId);

  // Verify controller in DB
  const ctrlRecord = await db.select().from(controllers).where(eq(controllers.id, joinData.controllerId)).limit(1);
  assert.strictEqual(ctrlRecord.length, 1);
  assert.strictEqual(ctrlRecord[0].guestName, 'Alice Guest');
  assert.strictEqual(ctrlRecord[0].userId, null, 'Guest must NOT create or link to users table');
  assert.strictEqual(ctrlRecord[0].connectionState, 'connected');

  // Validate guest access via validate endpoint
  const valRes = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/validate?role=guest&controllerId=${joinData.controllerId}`);
  assert.strictEqual(valRes.status, 200);
  const valData = await valRes.json();
  assert.strictEqual(valData.valid, true);
  assert.strictEqual(valData.role, 'guest');
  assert.strictEqual(valData.guestUsername, 'Alice Guest');

  // Guest adds song to queue without user login
  const queueRes = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      songId: testSong1Id,
      controllerId: joinData.controllerId
    })
  });
  assert.strictEqual(queueRes.status, 200, 'Guest must be able to add song with valid controllerId');
  const queueItem = await queueRes.json();
  assert.strictEqual(queueItem.songId, testSong1Id);
  assert.strictEqual(queueItem.guestName, 'Alice Guest');
  assert.strictEqual(queueItem.userId, null);
});

test('2. Unauthorized users and guests cannot execute host-only actions', async () => {
  // Create room by host
  const createRes = await fetch(`${baseUrl}/api/karaoke/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hostToken}` }
  });
  const session = await createRes.json();
  const sessionId = session.id;

  // Add a song to queue
  await fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hostToken}` },
    body: JSON.stringify({ songId: testSong1Id })
  });

  // A. Unauthenticated request to skip track -> 403 Forbidden
  const noAuthSkip = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/skip`, {
    method: 'POST'
  });
  assert.strictEqual(noAuthSkip.status, 403, 'Unauthenticated skip must be rejected');

  // B. Attacker (non-host user) tries to skip track -> 403 Forbidden
  const attackerSkip = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/skip`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${attackerToken}` }
  });
  assert.strictEqual(attackerSkip.status, 403, 'Non-host user skip must be rejected');

  // C. Attacker tries to send host heartbeat -> 403 Forbidden
  const attackerHeartbeat = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/heartbeat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${attackerToken}` }
  });
  assert.strictEqual(attackerHeartbeat.status, 403, 'Non-host user heartbeat must be rejected');

  // D. Attacker tries to end session -> 403 Forbidden
  const attackerEnd = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/end`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${attackerToken}` }
  });
  assert.strictEqual(attackerEnd.status, 403, 'Non-host user end session must be rejected');

  // E. Attacker tries to update room lyrics settings -> 403 Forbidden
  const attackerLyrics = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/lyrics-settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${attackerToken}` },
    body: JSON.stringify({ settings: { highlighted: { size: 40 } } })
  });
  assert.strictEqual(attackerLyrics.status, 403, 'Non-host user update lyrics settings must be rejected');

  // F. Attacker tries to reassign host -> 403 Forbidden
  const attackerReassign = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/reassign-host`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${attackerToken}` },
    body: JSON.stringify({ newHostId: attackerUserId })
  });
  assert.strictEqual(attackerReassign.status, 403, 'Non-host user reassign host must be rejected');

  // G. Attacker tries to reorder queue -> 403 Forbidden
  const attackerReorder = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/queue/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${attackerToken}` },
    body: JSON.stringify({ itemIds: [1, 2] })
  });
  assert.strictEqual(attackerReorder.status, 403, 'Non-host user reorder queue must be rejected');

  // H. Legitimate host can execute host actions -> 200 Success
  const hostHeartbeat = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/heartbeat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hostToken}` }
  });
  assert.strictEqual(hostHeartbeat.status, 200, 'Authorized host heartbeat must succeed');

  const hostSkip = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/skip`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hostToken}` }
  });
  assert.strictEqual(hostSkip.status, 200, 'Authorized host skip must succeed');

  // I. Administrator can execute host actions -> 200 Success
  const adminSkip = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/skip`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.strictEqual(adminSkip.status, 200, 'Administrator skip must succeed');
});

test('3. Client cannot impersonate host via HTTP validate or WebSocket', async () => {
  const createRes = await fetch(`${baseUrl}/api/karaoke/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hostToken}` }
  });
  const session = await createRes.json();
  const sessionId = session.id;

  // Unauthenticated client claims role=host -> 401 Auth Required
  const noAuthHostVal = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/validate?role=host`);
  assert.strictEqual(noAuthHostVal.status, 401, 'Unauthenticated user claiming role=host must be rejected with 401');

  // Attacker user claims role=host -> 403 Forbidden
  const attackerHostVal = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/validate?role=host`, {
    headers: { Authorization: `Bearer ${attackerToken}` }
  });
  assert.strictEqual(attackerHostVal.status, 403, 'Non-host user claiming role=host must be rejected with 403');

  // Unauthorized client tries to connect to WebSocket with isHost=true without token -> closed with 1008
  const unauthorizedWs = new WebSocket(`${wsUrl}?sessionId=${sessionId}&isHost=true`);
  const wsCloseCode = await new Promise<number>((resolve) => {
    unauthorizedWs.on('close', (code) => resolve(code));
    unauthorizedWs.on('error', () => {});
  });
  assert.strictEqual(wsCloseCode, 1008, 'Unauthorized WS connection must be rejected with policy violation code 1008');

  // Attacker connects to WS with token and isHost=true -> connects as regular user, isHost is stripped!
  const attackerWs = new WebSocket(`${wsUrl}?sessionId=${sessionId}&isHost=true&token=${encodeURIComponent(attackerToken)}`);
  await new Promise<void>((resolve, reject) => {
    attackerWs.on('open', () => resolve());
    attackerWs.on('error', (err) => reject(err));
  });

  // Attacker tries to send PLAY message over WS
  attackerWs.send(JSON.stringify({ type: 'PLAY' }));

  // Wait a moment and check room state -> must NOT be playing
  await new Promise((r) => setTimeout(r, 100));
  const roomState = getRoomState(sessionId);
  assert.strictEqual(roomState?.playing, false, 'Attacker WS PLAY message must NOT change room playback state');

  attackerWs.close();
});

test('4. Cross-room isolation and IDOR attacks are blocked', async () => {
  // Create Room A by Host
  const resA = await fetch(`${baseUrl}/api/karaoke/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hostToken}` }
  });
  const sessionA = await resA.json();

  // Create Room B by Attacker
  const resB = await fetch(`${baseUrl}/api/karaoke/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${attackerToken}` }
  });
  const sessionB = await resB.json();

  // Guest joins Room A and gets controllerId A
  const joinA = await fetch(`${baseUrl}/api/karaoke/sessions/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: sessionA.id, displayName: 'Guest In A' })
  });
  const { controllerId: ctrlA } = await joinA.json();

  // Guest attempts to queue song in Room B using controllerId A -> 403 Forbidden
  const crossQueueRes = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionB.id}/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId: testSong1Id, controllerId: ctrlA })
  });
  assert.strictEqual(crossQueueRes.status, 403, 'Using controllerId from Room A in Room B must be rejected with 403');

  // Attacker (host of Room B) attempts to skip Room A -> 403 Forbidden
  const crossSkipRes = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionA.id}/skip`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${attackerToken}` }
  });
  assert.strictEqual(crossSkipRes.status, 403, 'Cross-room skip attempt must be rejected with 403');

  // Attacker attempts to end Room A -> 403 Forbidden
  const crossEndRes = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionA.id}/end`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${attackerToken}` }
  });
  assert.strictEqual(crossEndRes.status, 403, 'Cross-room end session attempt must be rejected with 403');

  // Controller A tries to connect to Room B WebSocket -> closed with 1008
  const crossWs = new WebSocket(`${wsUrl}?sessionId=${sessionB.id}&controllerId=${ctrlA}`);
  const crossWsClose = await new Promise<number>((resolve) => {
    crossWs.on('close', (code) => resolve(code));
    crossWs.on('error', () => {});
  });
  assert.strictEqual(crossWsClose, 1008, 'Using controllerId from Room A on Room B WebSocket must be rejected with 1008');
});

test('5. Duplicate joins and reconnects reuse participant records without duplication', async () => {
  const createRes = await fetch(`${baseUrl}/api/karaoke/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hostToken}` }
  });
  const session = await createRes.json();
  const sessionId = session.id;

  // 1. Initial guest join
  const join1 = await fetch(`${baseUrl}/api/karaoke/sessions/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, displayName: 'Bob' })
  });
  const data1 = await join1.json();
  const initialCtrlId = data1.controllerId;

  // 2. Rejoin with existing controllerId (simulating tab refresh / reconnect)
  const join2 = await fetch(`${baseUrl}/api/karaoke/sessions/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, controllerId: initialCtrlId, displayName: 'Bob' })
  });
  const data2 = await join2.json();
  assert.strictEqual(data2.controllerId, initialCtrlId, 'Rejoining with controllerId must return same controllerId');

  // Verify only 1 controller record in database for this session
  const allCtrls = await db.select().from(controllers).where(eq(controllers.sessionId, sessionId));
  assert.strictEqual(allCtrls.length, 1, 'Duplicate join must NOT create extra controller records in DB');

  // 3. User join and rejoin
  const userJoin1 = await fetch(`${baseUrl}/api/karaoke/sessions/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${attackerToken}` },
    body: JSON.stringify({ sessionId })
  });
  const userData1 = await userJoin1.json();

  const userJoin2 = await fetch(`${baseUrl}/api/karaoke/sessions/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${attackerToken}` },
    body: JSON.stringify({ sessionId })
  });
  const userData2 = await userJoin2.json();
  assert.strictEqual(userData1.controllerId, userData2.controllerId, 'Authenticated user rejoining must reuse controller record');

  const finalCtrls = await db.select().from(controllers).where(eq(controllers.sessionId, sessionId));
  assert.strictEqual(finalCtrls.length, 2, 'Total controllers must be exactly 2 (guest and user)');
});

test('6. Disconnect and reconnect updates controller connectionState', async () => {
  const createRes = await fetch(`${baseUrl}/api/karaoke/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hostToken}` }
  });
  const session = await createRes.json();
  const sessionId = session.id;

  const joinRes = await fetch(`${baseUrl}/api/karaoke/sessions/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, displayName: 'Charlie' })
  });
  const { controllerId } = await joinRes.json();

  // Connect guest WebSocket
  const guestWs = new WebSocket(`${wsUrl}?sessionId=${sessionId}&controllerId=${controllerId}`);
  await new Promise<void>((resolve, reject) => {
    guestWs.on('open', () => resolve());
    guestWs.on('error', (e) => reject(e));
  });

  // Verify DB state is connected
  let ctrl = await db.select().from(controllers).where(eq(controllers.id, controllerId)).limit(1);
  assert.strictEqual(ctrl[0].connectionState, 'connected');

  // Disconnect WebSocket
  guestWs.close();
  await new Promise((r) => setTimeout(r, 100));

  // Verify DB state updated to disconnected
  ctrl = await db.select().from(controllers).where(eq(controllers.id, controllerId)).limit(1);
  assert.strictEqual(ctrl[0].connectionState, 'disconnected');

  // Reconnect WebSocket
  const reconnectWs = new WebSocket(`${wsUrl}?sessionId=${sessionId}&controllerId=${controllerId}`);
  await new Promise<void>((resolve, reject) => {
    reconnectWs.on('open', () => resolve());
    reconnectWs.on('error', (e) => reject(e));
  });

  // Verify DB state updated back to connected
  ctrl = await db.select().from(controllers).where(eq(controllers.id, controllerId)).limit(1);
  assert.strictEqual(ctrl[0].connectionState, 'connected');

  reconnectWs.close();
});

test('7. Host reassignment dynamically transfers privileged control', async () => {
  const createRes = await fetch(`${baseUrl}/api/karaoke/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hostToken}` }
  });
  const session = await createRes.json();
  const sessionId = session.id;

  // Initial check: hostUserId is host, memberUserId is NOT host
  const initialSkip = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/skip`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${memberToken}` }
  });
  assert.strictEqual(initialSkip.status, 403, 'Member cannot skip before reassignment');

  // Host reassigns room to memberUserId
  const reassignRes = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/reassign-host`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hostToken}` },
    body: JSON.stringify({ newHostId: memberUserId })
  });
  assert.strictEqual(reassignRes.status, 200, 'Host reassignment must succeed');
  const reassignData = await reassignRes.json();
  assert.strictEqual(reassignData.newHostId, memberUserId);

  // Verify old host can NO LONGER execute host actions -> 403 Forbidden!
  const oldHostSkip = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/skip`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hostToken}` }
  });
  assert.strictEqual(oldHostSkip.status, 403, 'Old host must be rejected after reassignment');

  // Verify new host CAN execute host actions -> 200 Success!
  const newHostSkip = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/skip`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${memberToken}` }
  });
  assert.strictEqual(newHostSkip.status, 200, 'New host must be authorized to skip');
});

test('8. Concurrent guest queue additions maintain strictly consistent queue ordering', async () => {
  const createRes = await fetch(`${baseUrl}/api/karaoke/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hostToken}` }
  });
  const session = await createRes.json();
  const sessionId = session.id;

  // Create 6 guest controllers
  const guests = await Promise.all([1, 2, 3, 4, 5, 6].map(async (num) => {
    const res = await fetch(`${baseUrl}/api/karaoke/sessions/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, displayName: `Singer ${num}` })
    });
    return (await res.json()).controllerId;
  }));

  // Concurrently add songs from all 6 guests
  const queuePromises = guests.map((ctrlId, idx) => {
    const sId = idx % 2 === 0 ? testSong1Id : testSong2Id;
    return fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songId: sId, controllerId: ctrlId })
    });
  });

  const responses = await Promise.all(queuePromises);
  for (const r of responses) {
    assert.strictEqual(r.status, 200, 'All concurrent queue additions must succeed');
  }

  // Fetch final persisted queue
  const items = await db.select().from(queueItems)
    .where(eq(queueItems.sessionId, sessionId))
    .orderBy(asc(queueItems.position));

  assert.strictEqual(items.length, 6, 'Queue must contain exactly 6 items');

  // Verify positions are strictly sequential: 1, 2, 3, 4, 5, 6 with NO duplicates!
  const positions = items.map(it => it.position);
  assert.deepStrictEqual(positions, [1, 2, 3, 4, 5, 6], 'Queue positions must be contiguous and free of duplicate numbers');

  // Verify only one item is marked playing
  const playingItems = items.filter(it => it.status === 'playing');
  assert.strictEqual(playingItems.length, 1, 'Exactly one song must be in playing status');
});

test('9. Room closure terminates session, wipes queue, and notifies connected clients', async () => {
  const createRes = await fetch(`${baseUrl}/api/karaoke/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hostToken}` }
  });
  const session = await createRes.json();
  const sessionId = session.id;

  // Guest joins
  const joinRes = await fetch(`${baseUrl}/api/karaoke/sessions/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, displayName: 'Dave' })
  });
  const { controllerId } = await joinRes.json();

  // Guest queues song
  await fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId: testSong1Id, controllerId })
  });

  // Guest connects to WebSocket
  const guestWs = new WebSocket(`${wsUrl}?sessionId=${sessionId}&controllerId=${controllerId}`);
  let receivedSessionClosed = false;
  const wsClosedPromise = new Promise<void>((resolve) => {
    guestWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'SESSION_CLOSED') {
          receivedSessionClosed = true;
        }
      } catch (e) {}
    });
    guestWs.on('close', () => resolve());
  });

  await new Promise((r) => setTimeout(r, 100));

  // Host ends room
  const endRes = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/end`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hostToken}` }
  });
  assert.strictEqual(endRes.status, 200, 'End session must succeed');

  // Wait for WS to close
  await wsClosedPromise;
  assert.strictEqual(receivedSessionClosed, true, 'Connected clients must receive SESSION_CLOSED message');

  // Check database state
  const sessRec = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  assert.strictEqual(sessRec[0].status, 'closed', 'Session status must be closed in DB');

  const qItems = await db.select().from(queueItems).where(eq(queueItems.sessionId, sessionId));
  assert.strictEqual(qItems.length, 0, 'Queue items must be cleaned up on session end');

  // Validate endpoint returns 410 Expired
  const valRes = await fetch(`${baseUrl}/api/karaoke/sessions/${sessionId}/validate?role=guest&controllerId=${controllerId}`);
  assert.strictEqual(valRes.status, 410, 'Validate endpoint on closed room must return 410 Gone');
});

test('Close Karaoke Permissions Test Server', async () => {
  if (wss) {
    try {
      wss.close();
    } catch (e) {}
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});
