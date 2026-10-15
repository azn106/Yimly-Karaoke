import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { db, setupDatabase } from '../db/index.js';
import { artists, songs, albums } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { refreshArtistProfileImage, refreshAllArtists } from '../lib/artist-image-refresher.js';

test('Artist Image Refresh: Individual and Bulk Refresh Workflow', async () => {
  await setupDatabase();

  // 1. Insert test artist and song with album artwork (to verify album artwork remains untouched)
  const testArtistName = `Test Artist ${Date.now()}`;
  const [artRec] = await db.insert(artists).values({
    name: testArtistName,
    artworkPath: null,
  }).returning();

  const [albRec] = await db.insert(albums).values({
    artistId: artRec.id,
    title: 'Test Album',
    artworkPath: 'mock_album_cover.jpg',
  }).returning();

  const [songRec] = await db.insert(songs).values({
    libraryId: 1,
    artistId: artRec.id,
    albumId: albRec.id,
    title: 'Test Track',
    mainAudioPath: 'test_track.mp3',
    artworkPath: 'mock_song_cover.jpg',
  }).returning();

  // 2. Test individual refresh for artist with no provider image -> should return 'unavailable'
  const resUnavailable = await refreshArtistProfileImage(artRec.id);
  assert.strictEqual(resUnavailable.status, 'unavailable', 'Artist with no provider image should return unavailable');

  // Verify song and album artwork are untouched
  const songCheck = await db.select().from(songs).where(eq(songs.id, songRec.id)).limit(1);
  assert.strictEqual(songCheck[0].artworkPath, 'mock_song_cover.jpg', 'Song artwork must remain untouched');

  const albCheck = await db.select().from(albums).where(eq(albums.id, albRec.id)).limit(1);
  assert.strictEqual(albCheck[0].artworkPath, 'mock_album_cover.jpg', 'Album artwork must remain untouched');

  // 3. Test bulk refresh across library
  let progressCalled = false;
  const bulkSummary = await refreshAllArtists((progress) => {
    progressCalled = true;
    assert.ok(progress.total >= 1, 'Total must be at least 1');
  });

  assert.ok(progressCalled, 'Progress callback should be invoked during bulk refresh');
  assert.ok(bulkSummary.total >= 1, 'Bulk summary should report total artists');
  assert.ok(Array.isArray(bulkSummary.details), 'Details array should be present');

  // Cleanup test records
  await db.delete(songs).where(eq(songs.id, songRec.id));
  await db.delete(albums).where(eq(albums.id, albRec.id));
  await db.delete(artists).where(eq(artists.id, artRec.id));
});
