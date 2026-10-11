import { test } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import { db } from '../db/index.js';
import { users, sessions, queueItems, songs, artists, libraries } from '../db/schema.js';
import { eq, asc } from 'drizzle-orm';
import { checkAndAutoPlay, advanceQueue, getOrCreateRoom } from '../ws/index.js';

test('BGM & Queue Handoff: Slow-processing next song keeps room idle and preserves background music state', async () => {
  // 1. Ensure user
  let userRec = await db.select().from(users).limit(1);
  if (userRec.length === 0) {
    const insertedUser = await db.insert(users).values({
      username: `bgm_testuser_${Date.now()}`,
      password: 'password123',
      role: 'administrator',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    userRec = insertedUser;
  }
  const userId = userRec[0].id;

  // 2. Setup session
  const testSessionId = crypto.randomUUID();
  await db.insert(sessions).values({
    id: testSessionId,
    hostId: userId,
    hostDevice: 'Chrome (Linux)',
    roomCode: `BGM_${Date.now().toString().slice(-4)}`,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const room = await getOrCreateRoom(testSessionId);
  room.playing = false;
  room.currentSongId = null;
  room.currentQueueItemId = null;

  // 3. Queue a new song that requires processing (downloading, songId = null)
  const dlTrackId = `dl_track_bgm_${Date.now()}`;
  const [qItem] = await db.insert(queueItems).values({
    sessionId: testSessionId,
    songId: null,
    position: 1,
    status: 'pending',
    tempTitle: 'Slow Processing Song',
    tempArtist: 'Indie Artist',
    downloadJobId: 'job_bgm_1',
    downloadTrackId: dlTrackId,
    downloadStatus: 'downloading',
    userId,
    addedAt: new Date(),
  }).returning();

  // 4. While DOWNLOADING, checkAndAutoPlay must keep room idle (BGM active)
  await checkAndAutoPlay(testSessionId);
  assert.strictEqual(room.playing, false, 'Room must remain not playing while DOWNLOADING');
  assert.strictEqual(room.currentSongId, null, 'currentSongId must remain null');
  let [dbItem] = await db.select().from(queueItems).where(eq(queueItems.id, qItem.id)).limit(1);
  assert.strictEqual(dbItem.status, 'pending', 'Queue item status must stay pending');
  assert.strictEqual(dbItem.position, 1, 'Queue position must remain 1');

  // 5. While PROCESSING, checkAndAutoPlay must still keep room idle (BGM active)
  await db.update(queueItems).set({
    downloadStatus: 'processing'
  }).where(eq(queueItems.id, qItem.id));

  await checkAndAutoPlay(testSessionId);
  assert.strictEqual(room.playing, false, 'Room must remain not playing while PROCESSING');
  assert.strictEqual(room.currentSongId, null, 'currentSongId must remain null');
  [dbItem] = await db.select().from(queueItems).where(eq(queueItems.id, qItem.id)).limit(1);
  assert.strictEqual(dbItem.status, 'pending', 'Queue item status must stay pending during processing');

  // 6. Cleanup
  await db.delete(queueItems).where(eq(queueItems.sessionId, testSessionId));
  await db.delete(sessions).where(eq(sessions.id, testSessionId));
});

test('BGM & Queue Handoff: Successful readiness triggers transition to playing track', async () => {
  let userRec = await db.select().from(users).limit(1);
  const userId = userRec[0].id;

  const testSessionId = crypto.randomUUID();
  await db.insert(sessions).values({
    id: testSessionId,
    hostId: userId,
    hostDevice: 'Chrome (Linux)',
    roomCode: `RDY_${Date.now().toString().slice(-4)}`,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const room = await getOrCreateRoom(testSessionId);
  room.playing = false;
  room.currentSongId = null;
  room.currentQueueItemId = null;

  // Ensure a test song exists
  let songRec = await db.select().from(songs).limit(1);
  let testSongId: number;
  if (songRec.length > 0) {
    testSongId = songRec[0].id;
  } else {
    let art = await db.select().from(artists).limit(1);
    let artId = art.length > 0 ? art[0].id : (await db.insert(artists).values({ name: 'Ready Art' }).returning())[0].id;
    let lib = await db.select().from(libraries).limit(1);
    let libId = lib.length > 0 ? lib[0].id : (await db.insert(libraries).values({ name: 'Lib', path: '/tmp' }).returning())[0].id;
    const [s] = await db.insert(songs).values({
      libraryId: libId,
      artistId: artId,
      title: 'Ready Song',
      duration: 180,
    }).returning();
    testSongId = s.id;
  }

  // Insert item as ready
  const [qItem] = await db.insert(queueItems).values({
    sessionId: testSessionId,
    songId: testSongId,
    position: 1,
    status: 'pending',
    tempTitle: 'Ready Song',
    tempArtist: 'Ready Art',
    downloadStatus: 'ready',
    userId,
    addedAt: new Date(),
  }).returning();

  // checkAndAutoPlay should now promote to playing
  await checkAndAutoPlay(testSessionId);
  assert.strictEqual(room.playing, true, 'Room must transition to playing once ready');
  assert.strictEqual(room.currentSongId, testSongId, 'Room currentSongId must match ready song');
  assert.strictEqual(room.currentQueueItemId, qItem.id, 'Room currentQueueItemId must match');

  const [dbItem] = await db.select().from(queueItems).where(eq(queueItems.id, qItem.id)).limit(1);
  assert.strictEqual(dbItem.status, 'playing', 'Queue item status must be updated to playing');

  // Cleanup
  await db.delete(queueItems).where(eq(queueItems.sessionId, testSessionId));
  await db.delete(sessions).where(eq(sessions.id, testSessionId));
});

test('BGM & Queue Handoff: Duplicate readiness events do not trigger duplicate transitions or stop track', async () => {
  let userRec = await db.select().from(users).limit(1);
  const userId = userRec[0].id;

  const testSessionId = crypto.randomUUID();
  await db.insert(sessions).values({
    id: testSessionId,
    hostId: userId,
    hostDevice: 'Chrome (Linux)',
    roomCode: `DUP_${Date.now().toString().slice(-4)}`,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const room = await getOrCreateRoom(testSessionId);
  const [testSong] = await db.select().from(songs).limit(1);

  const [qItem] = await db.insert(queueItems).values({
    sessionId: testSessionId,
    songId: testSong.id,
    position: 1,
    status: 'playing',
    downloadStatus: 'ready',
    userId,
    addedAt: new Date(),
  }).returning();

  room.playing = true;
  room.currentSongId = testSong.id;
  room.currentQueueItemId = qItem.id;
  room.position = 42;

  // Trigger duplicate checkAndAutoPlay notifications
  await checkAndAutoPlay(testSessionId);
  await checkAndAutoPlay(testSessionId);
  await checkAndAutoPlay(testSessionId);

  assert.strictEqual(room.playing, true, 'Room must continue playing');
  assert.strictEqual(room.currentSongId, testSong.id, 'currentSongId must remain unchanged');
  assert.strictEqual(room.position, 42, 'Playback position must not be reset by duplicate notifications');

  const allItems = await db.select().from(queueItems).where(eq(queueItems.sessionId, testSessionId));
  assert.strictEqual(allItems.length, 1, 'No duplicate queue items created');
  assert.strictEqual(allItems[0].status, 'playing');

  // Cleanup
  await db.delete(queueItems).where(eq(queueItems.sessionId, testSessionId));
  await db.delete(sessions).where(eq(sessions.id, testSessionId));
});

test('BGM & Queue Handoff: Processing failure preserves background music and advances to next eligible song', async () => {
  let userRec = await db.select().from(users).limit(1);
  const userId = userRec[0].id;

  const testSessionId = crypto.randomUUID();
  await db.insert(sessions).values({
    id: testSessionId,
    hostId: userId,
    hostDevice: 'Chrome (Linux)',
    roomCode: `FAIL_${Date.now().toString().slice(-4)}`,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const room = await getOrCreateRoom(testSessionId);
  room.playing = false;
  room.currentSongId = null;
  room.currentQueueItemId = null;

  const [testSong] = await db.select().from(songs).limit(1);

  // Queue item 1: Failed processing
  const [q1] = await db.insert(queueItems).values({
    sessionId: testSessionId,
    songId: null,
    position: 1,
    status: 'pending',
    tempTitle: 'Failed Download Track',
    tempArtist: 'Artist',
    downloadStatus: 'failed',
    userId,
    addedAt: new Date(),
  }).returning();

  // Queue item 2: Ready song
  const [q2] = await db.insert(queueItems).values({
    sessionId: testSessionId,
    songId: testSong.id,
    position: 2,
    status: 'pending',
    tempTitle: 'Ready Track 2',
    tempArtist: 'Artist 2',
    downloadStatus: 'ready',
    userId,
    addedAt: new Date(),
  }).returning();

  // checkAndAutoPlay should skip failed q1 and promote ready q2
  await checkAndAutoPlay(testSessionId);
  assert.strictEqual(room.playing, true, 'Room should promote ready item 2');
  assert.strictEqual(room.currentSongId, testSong.id, 'Song ID should match ready item 2');
  assert.strictEqual(room.currentQueueItemId, q2.id, 'Queue item ID should match q2');

  const [dbQ1] = await db.select().from(queueItems).where(eq(queueItems.id, q1.id)).limit(1);
  assert.strictEqual(dbQ1.status, 'pending', 'Failed item status must not be set to playing');

  // Cleanup
  await db.delete(queueItems).where(eq(queueItems.sessionId, testSessionId));
  await db.delete(sessions).where(eq(sessions.id, testSessionId));
});

test('BGM & Queue Handoff: Track ends while next song is processing preserves BGM idle state', async () => {
  let userRec = await db.select().from(users).limit(1);
  const userId = userRec[0].id;

  const testSessionId = crypto.randomUUID();
  await db.insert(sessions).values({
    id: testSessionId,
    hostId: userId,
    hostDevice: 'Chrome (Linux)',
    roomCode: `END_${Date.now().toString().slice(-4)}`,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const room = await getOrCreateRoom(testSessionId);
  const [testSong] = await db.select().from(songs).limit(1);

  // Queue item 1: Currently playing song
  const [q1] = await db.insert(queueItems).values({
    sessionId: testSessionId,
    songId: testSong.id,
    position: 1,
    status: 'playing',
    downloadStatus: 'ready',
    userId,
    addedAt: new Date(),
  }).returning();

  // Queue item 2: Slow-processing next song
  const [q2] = await db.insert(queueItems).values({
    sessionId: testSessionId,
    songId: null,
    position: 2,
    status: 'pending',
    tempTitle: 'Processing Track 2',
    tempArtist: 'Artist 2',
    downloadStatus: 'processing',
    userId,
    addedAt: new Date(),
  }).returning();

  room.playing = true;
  room.currentSongId = testSong.id;
  room.currentQueueItemId = q1.id;

  // Track 1 ends: advanceQueue is called
  await advanceQueue(testSessionId, room);

  // Finished track 1 was removed from DB
  const remainingQueue = await db.select().from(queueItems).where(eq(queueItems.sessionId, testSessionId));
  assert.strictEqual(remainingQueue.length, 1);
  assert.strictEqual(remainingQueue[0].id, q2.id);
  assert.strictEqual(remainingQueue[0].status, 'pending');

  // Because next song is still processing, room MUST be idle (allowing BGM to play)
  assert.strictEqual(room.playing, false, 'Room must be idle while next track processes');
  assert.strictEqual(room.currentSongId, null, 'currentSongId must be null');
  assert.strictEqual(room.currentQueueItemId, null, 'currentQueueItemId must be null');

  // Cleanup
  await db.delete(queueItems).where(eq(queueItems.sessionId, testSessionId));
  await db.delete(sessions).where(eq(sessions.id, testSessionId));
});
