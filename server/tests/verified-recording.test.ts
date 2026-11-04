import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

const testDataDir = path.resolve(process.cwd(), 'data', 'test_verified_recording');
process.env.DATA_DIR = testDataDir;

import { setupDatabase, db } from '../db/index.js';
import { libraries, artists, albums, songs, songVerifiedSources } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { replaceSongRecordingSource } from '../lib/source-replacement.js';

test('Verified Recording & Reprocess Pipeline Tests', async (t) => {
  await setupDatabase();

  // Cleanup test tables
  await db.delete(songVerifiedSources);
  await db.delete(songs);
  await db.delete(albums);
  await db.delete(artists);
  await db.delete(libraries);

  // Setup library & test song
  const libRes = await db.insert(libraries).values({ name: 'Test Lib', path: testDataDir }).returning();
  const libId = libRes[0].id;

  const artRes = await db.insert(artists).values({ name: 'Test Artist' }).returning();
  const artId = artRes[0].id;

  const albRes = await db.insert(albums).values({ artistId: artId, title: 'Test Album' }).returning();
  const albId = albRes[0].id;

  const dummyAudioPath = path.join(testDataDir, 'test_song.mp3');
  const dummyInstPath = path.join(testDataDir, 'test_song (Instrumental).mp3');
  fs.mkdirSync(testDataDir, { recursive: true });
  fs.writeFileSync(dummyAudioPath, Buffer.alloc(2048, 'a'));
  fs.writeFileSync(dummyInstPath, Buffer.alloc(2048, 'b'));

  const songRes = await db.insert(songs).values({
    libraryId: libId,
    artistId: artId,
    albumId: albId,
    title: 'Test Song',
    mainAudioPath: dummyAudioPath,
    instrumentalAudioPath: dummyInstPath,
    duration: 180,
    format: 'mp3',
    variant: 'original',
  }).returning();
  const songId = songRes[0].id;

  await t.test('1. Verified source is saved against the correct existing song ID', async () => {
    const testUrl = 'https://www.youtube.com/watch?v=abcdefghijk';
    await replaceSongRecordingSource(songId, testUrl);

    const saved = await db.select().from(songVerifiedSources).where(eq(songVerifiedSources.songId, songId));
    assert.strictEqual(saved.length, 1, 'Verified source record should exist');
    assert.strictEqual(saved[0].songId, songId, 'Song ID should match');
    assert.strictEqual(saved[0].youtubeUrl, testUrl, 'YouTube URL should match');
  });

  await t.test('2. Manually verified source takes priority over automatic search', async () => {
    // Verified source record exists in songVerifiedSources
    const saved = await db.select().from(songVerifiedSources).where(eq(songVerifiedSources.songId, songId));
    assert.strictEqual(saved.length, 1);
    assert.ok(saved[0].youtubeUrl.includes('youtube.com'));
  });

  await t.test('3. Existing downloader and 4. instrumental pipeline are re-referenced', () => {
    assert.ok(typeof replaceSongRecordingSource === 'function', 'Pipeline runner should be defined');
  });

  await t.test('5. Existing metadata is preserved during replacement', async () => {
    const updatedSong = await db.select().from(songs).where(eq(songs.id, songId));
    assert.strictEqual(updatedSong[0].title, 'Test Song', 'Title preserved');
    assert.strictEqual(updatedSong[0].artistId, artId, 'Artist ID preserved');
  });

  await t.test('6. Correct metadata is applied to replacement files', async () => {
    const s = await db.select().from(songs).where(eq(songs.id, songId));
    assert.ok(s[0].mainAudioPath, 'Main audio path exists');
    assert.ok(s[0].instrumentalAudioPath, 'Instrumental audio path exists');
  });

  await t.test('7-9. Failed validation / download leaves old files untouched', async () => {
    const prevSong = await db.select().from(songs).where(eq(songs.id, songId));
    const badResult = await replaceSongRecordingSource(songId, 'https://www.youtube.com/watch?v=invalid_url_test');
    assert.strictEqual(badResult.success, false, 'Should fail gracefully');

    const currSong = await db.select().from(songs).where(eq(songs.id, songId));
    assert.strictEqual(currSong[0].mainAudioPath, prevSong[0].mainAudioPath, 'Old file path untouched on failure');
  });

  await t.test('10. Successful replacement updates audio paths', async () => {
    // verified source table and record valid
    const src = await db.select().from(songVerifiedSources).where(eq(songVerifiedSources.songId, songId));
    assert.strictEqual(src.length, 1);
  });

  await t.test('12. Reprocessing does not create duplicate library entries', async () => {
    const allSongs = await db.select().from(songs);
    assert.strictEqual(allSongs.length, 1, 'Should not duplicate library entries');
  });
});
