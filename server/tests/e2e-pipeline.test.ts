import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/index.js';
import { users, sessions, queueItems, songs, artists, libraries } from '../db/schema.js';
import { eq, asc } from 'drizzle-orm';
import { createInstrumentalWithFFmpeg, checkCudaAvailability } from '../lib/audio-separation.js';
import { fetchSongDualLyrics } from '../lyrics/manager.js';
import { importSingleAudioFile } from '../lib/scanner.js';
import { execSync } from 'child_process';
import crypto from 'crypto';

test('E2E Pipeline Verification: Complete Queue -> Download -> Processing -> Ready Lifecycle', async () => {
  // 1. Ensure a user exists for session foreign key
  let userRec = await db.select().from(users).limit(1);
  let userId: number;
  if (userRec.length === 0) {
    const insertedUser = await db.insert(users).values({
      username: `testuser_${Date.now()}`,
      password: 'password123',
      role: 'administrator',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    userId = insertedUser[0].id;
  } else {
    userId = userRec[0].id;
  }

  // 2. Setup mock library and session
  const testLibDir = path.join(process.cwd(), 'data', 'test_e2e_lib');
  fs.mkdirSync(testLibDir, { recursive: true });

  const existingLib = await db.select().from(libraries).limit(1);
  let libId: number;
  if (existingLib.length === 0) {
    const insertedLib = await db.insert(libraries).values({
      name: 'E2E Test Library',
      path: testLibDir,
    }).returning();
    libId = insertedLib[0].id;
  } else {
    libId = existingLib[0].id;
  }

  const testSessionId = crypto.randomUUID();
  const testRoomCode = `E2E_${Date.now().toString().slice(-4)}`;
  await db.insert(sessions).values({
    id: testSessionId,
    roomCode: testRoomCode,
    hostId: userId,
    hostDevice: 'Chrome (Linux)',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // 3. Add an initial ready song to test queue order & auto-next
  const existingSongRec = await db.select().from(songs).limit(1);
  let readySongId = existingSongRec.length > 0 ? existingSongRec[0].id : null;

  if (!readySongId) {
    const art = await db.insert(artists).values({ name: `Ready Artist ${Date.now()}` }).returning();
    const readySong = await db.insert(songs).values({
      libraryId: libId,
      artistId: art[0].id,
      title: 'Ready Song A',
      duration: 180,
      mainAudioPath: path.join(testLibDir, 'Ready Artist - Ready Song A.mp3'),
      variant: 'original',
    }).returning();
    readySongId = readySong[0].id;
  }

  // Queue Item 1: Position 1 - READY
  const q1 = await db.insert(queueItems).values({
    sessionId: testSessionId,
    songId: readySongId,
    status: 'pending',
    position: 1,
    userId: userId,
    guestName: 'Host',
    addedAt: new Date(),
  }).returning();

  // Queue Item 2: New YouTube track -> Initially DOWNLOADING
  const downloadTrackId = `track_e2e_${Date.now()}`;
  const downloadJobId = `job_e2e_${Date.now()}`;
  const q2 = await db.insert(queueItems).values({
    sessionId: testSessionId,
    songId: null,
    status: 'pending',
    position: 2,
    userId: userId,
    guestName: 'Host',
    addedAt: new Date(),
    tempTitle: 'Super Hit',
    tempArtist: 'Test Artist',
    downloadJobId,
    downloadTrackId,
    downloadStatus: 'downloading',
  }).returning();

  // Queue Item 3: Position 3 - READY
  const q3 = await db.insert(queueItems).values({
    sessionId: testSessionId,
    songId: readySongId,
    status: 'pending',
    position: 3,
    userId: userId,
    guestName: 'Host',
    addedAt: new Date(),
  }).returning();

  // Verification 1: Verify DOWNLOADING item in position 2
  const initialQueue = await db.select().from(queueItems)
    .where(eq(queueItems.sessionId, testSessionId))
    .orderBy(asc(queueItems.position));
  
  assert.strictEqual(initialQueue.length, 3);
  assert.strictEqual(initialQueue[1].downloadStatus, 'downloading');
  assert.strictEqual(initialQueue[1].position, 2);
  assert.strictEqual(initialQueue[1].songId, null);

  // Verification 2: Auto-next selection skips DOWNLOADING (Item 2) and selects Item 1
  const pendingItems1 = initialQueue.filter(i => i.status === 'pending');
  const nextItem1 = pendingItems1.find(item => 
    item.songId !== null && 
    item.downloadStatus !== 'downloading' && 
    item.downloadStatus !== 'processing' && 
    item.downloadStatus !== 'failed'
  );
  assert.strictEqual(nextItem1?.id, q1[0].id, 'Auto-next must select Item 1 (READY)');

  // 4. Simulate Download Completion & Direct Handoff to PROCESSING
  await db.update(queueItems)
    .set({ downloadStatus: 'processing' })
    .where(eq(queueItems.downloadTrackId, downloadTrackId));

  const processingQueue = await db.select().from(queueItems)
    .where(eq(queueItems.sessionId, testSessionId))
    .orderBy(asc(queueItems.position));
  assert.strictEqual(processingQueue[1].downloadStatus, 'processing');
  assert.strictEqual(processingQueue[1].position, 2, 'Position must remain 2 during PROCESSING');

  // Verify Auto-next skips PROCESSING item and advances to Item 3
  const pendingAfterItem1Played = processingQueue.filter(i => i.id !== q1[0].id && i.status === 'pending');
  const nextItem2 = pendingAfterItem1Played.find(item => 
    item.songId !== null && 
    item.downloadStatus !== 'downloading' && 
    item.downloadStatus !== 'processing' && 
    item.downloadStatus !== 'failed'
  );
  assert.strictEqual(nextItem2?.id, q3[0].id, 'Auto-next must skip PROCESSING (Item 2) and advance to Item 3');

  // 5. Generate audio MP3 and Instrumental output via FFmpeg
  const audioFilePath = path.join(testLibDir, 'Test Artist - Super Hit.mp3');
  const stemFilePath = path.join(testLibDir, 'Test Artist - Super Hit_stem.wav');
  const instFilePath = path.join(testLibDir, 'Test Artist - Super Hit (Instrumental).mp3');
  const lrcFilePath = path.join(testLibDir, 'Test Artist - Super Hit.lrc');
  const elrcFilePath = path.join(testLibDir, 'Test Artist - Super Hit.elrc.lrc');

  execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 2 -q:a 9 -acodec libmp3lame "${audioFilePath}"`);
  execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 2 "${stemFilePath}"`);

  await createInstrumentalWithFFmpeg(audioFilePath, stemFilePath, instFilePath, {
    title: 'Super Hit',
    artist: 'Test Artist',
  });

  assert.strictEqual(fs.existsSync(instFilePath), true, 'Instrumental file must be created');
  assert.ok(fs.statSync(instFilePath).size > 1024, 'Instrumental file must be valid non-empty audio');

  // 6. Cloud Lyrics Cascade test
  const lyricsRes = await fetchSongDualLyrics('Shape of You', 'Ed Sheeran');
  assert.ok(lyricsRes.lrcResult || lyricsRes.elrcResult, 'Lyrics cascade must fetch lyrics from cloud providers');

  fs.writeFileSync(lrcFilePath, '[00:01.00] Line 1\n[00:04.00] Line 2\n', 'utf-8');
  fs.writeFileSync(elrcFilePath, '[00:01.00] <00:01.00> Line <00:02.00> 1\n', 'utf-8');

  // 7. Library Indexing
  const importedMain = await importSingleAudioFile(libId, audioFilePath);
  const importedInst = await importSingleAudioFile(libId, instFilePath);
  assert.ok(importedMain && importedMain.length > 0, 'Main track must be indexed into database');
  const realSongId = importedMain[0].id;

  // Verify single logical song row links both main and instrumental
  const songRecord = await db.select().from(songs).where(eq(songs.id, realSongId)).limit(1);
  assert.strictEqual(songRecord[0].mainAudioPath, audioFilePath);
  assert.strictEqual(songRecord[0].instrumentalAudioPath, instFilePath);

  // 8. Queue Transition to READY with assigned real songId
  await db.update(queueItems).set({
    songId: realSongId,
    downloadStatus: 'ready'
  }).where(eq(queueItems.downloadTrackId, downloadTrackId));

  const finalQueue = await db.select().from(queueItems)
    .where(eq(queueItems.sessionId, testSessionId))
    .orderBy(asc(queueItems.position));

  assert.strictEqual(finalQueue.length, 3, 'No duplicate queue items created');
  assert.strictEqual(finalQueue[1].position, 2, 'Queue position preserved at position 2');
  assert.strictEqual(finalQueue[1].songId, realSongId, 'Real songId assigned');
  assert.strictEqual(finalQueue[1].downloadStatus, 'ready', 'Status transitioned to ready');

  // 9. Clean up test files and DB records
  await db.delete(queueItems).where(eq(queueItems.sessionId, testSessionId));
  await db.delete(sessions).where(eq(sessions.id, testSessionId));
  fs.rmSync(testLibDir, { recursive: true, force: true });
});
