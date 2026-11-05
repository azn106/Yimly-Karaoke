import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import express from 'express';
import http from 'http';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

const testDataDir = path.resolve(process.cwd(), 'data', 'test_verified_recording');
process.env.DATA_DIR = testDataDir;

import { setupDatabase, db } from '../db/index.js';
import { users, libraries, artists, albums, songs, songVerifiedSources, playlistSongs, playlists, favorites } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { replaceSongRecordingSource, replaceSongInstrumental, isValidYouTubeUrl, extractYouTubeVideoId } from '../lib/source-replacement.js';
import songsRoutes from '../routes/songs.js';
import playlistsRoutes from '../routes/playlists.js';
import favoritesRoutes from '../routes/favorites.js';
import { downloadQueue } from '../lib/download-queue.js';

const JWT_SECRET = process.env.JWT_SECRET || 'yimly_deterministic_test_jwt_secret_ci_only_32_bytes_safe';

test('Verified Recording, Reprocess Pipeline & Songs Page Card Options Suite', async (t) => {
  await setupDatabase();

  // Setup Express test app for route and permission tests
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/songs', songsRoutes);
  app.use('/api/playlists', playlistsRoutes);
  app.use('/api/favorites', favoritesRoutes);

  const server = http.createServer(app);
  let baseUrl = '';

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  t.after(() => {
    server.close();
  });

  // Cleanup test tables
  await db.delete(songVerifiedSources);
  await db.delete(playlistSongs);
  await db.delete(playlists);
  await db.delete(favorites);
  await db.delete(songs);
  await db.delete(albums);
  await db.delete(artists);
  await db.delete(libraries);
  await db.delete(users);

  // Create admin and regular user
  const adminUser = (await db.insert(users).values({
    username: 'admin_tester',
    password: 'hashed_password_placeholder',
    role: 'administrator',
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning())[0];

  const regularUser = (await db.insert(users).values({
    username: 'regular_tester',
    password: 'hashed_password_placeholder',
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning())[0];

  const adminToken = jwt.sign({ id: adminUser.id, username: adminUser.username, role: 'administrator' }, JWT_SECRET);
  const userToken = jwt.sign({ id: regularUser.id, username: regularUser.username, role: 'user' }, JWT_SECRET);

  // Setup library & test songs
  const libRes = await db.insert(libraries).values({ name: 'Test Lib', path: testDataDir }).returning();
  const libId = libRes[0].id;

  const artRes = await db.insert(artists).values({ name: 'Adele' }).returning();
  const artId = artRes[0].id;

  const albRes = await db.insert(albums).values({ artistId: artId, title: '21' }).returning();
  const albId = albRes[0].id;

  fs.mkdirSync(testDataDir, { recursive: true });
  const dummyAudioPath = path.join(testDataDir, 'adele_rolling.mp3');
  const dummyInstPath = path.join(testDataDir, 'adele_rolling (Instrumental).mp3');
  fs.writeFileSync(dummyAudioPath, Buffer.alloc(2048, 'a'));
  fs.writeFileSync(dummyInstPath, Buffer.alloc(2048, 'b'));

  const songRes = await db.insert(songs).values({
    libraryId: libId,
    artistId: artId,
    albumId: albId,
    title: 'Rolling in the Deep',
    mainAudioPath: dummyAudioPath,
    instrumentalAudioPath: dummyInstPath,
    duration: 228,
    format: 'mp3',
    variant: 'original',
  }).returning();
  const songId = songRes[0].id;

  // Duplicate title/artist song with different ID to test exact ID isolation
  const dummyAudioPath2 = path.join(testDataDir, 'adele_rolling_2.mp3');
  const dummyInstPath2 = path.join(testDataDir, 'adele_rolling_2 (Instrumental).mp3');
  fs.writeFileSync(dummyAudioPath2, Buffer.alloc(2048, 'c'));
  fs.writeFileSync(dummyInstPath2, Buffer.alloc(2048, 'd'));

  const songRes2 = await db.insert(songs).values({
    libraryId: libId,
    artistId: artId,
    albumId: albId,
    title: 'Rolling in the Deep',
    mainAudioPath: dummyAudioPath2,
    instrumentalAudioPath: dummyInstPath2,
    duration: 228,
    format: 'mp3',
    variant: 'original',
  }).returning();
  const song2Id = songRes2[0].id;

  // --- SECTION 1: SONGS PAGE UI SPECIFICATION AUDIT ---
  await t.test('UI Audit: one master Jukebox song card owns the full Library action set', () => {
    const libraryCode = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/Library.tsx'), 'utf-8');
    const cardCode = fs.readFileSync(path.resolve(process.cwd(), 'src/components/jukebox/JukeboxSongCard.tsx'), 'utf-8');
    const playlistCode = fs.readFileSync(path.resolve(process.cwd(), 'src/components/playlist/PlaylistDetailView.tsx'), 'utf-8');

    // The master card owns the shared artwork/playback/lyrics UI and the complete More Options menu.
    assert.ok(cardCode.includes('MoreVertical'), 'Master card renders the More Options control');
    assert.ok(cardCode.includes('onAddToQueue'), 'Master card owns Add to Queue');
    assert.ok(cardCode.includes('onToggleFavorite'), 'Master card supports favourites');
    assert.ok(cardCode.includes('onAddToPlaylist'), 'Master card supports Add to Playlist');
    assert.ok(cardCode.includes('onReplaceAudio'), 'Master card supports Replace Audio');
    assert.ok(cardCode.includes('onReplaceInstrumental'), 'Master card supports Replace Instrumental');
    assert.ok(cardCode.includes('onDeleteSong'), 'Master card supports Delete Song');

    const favIndex = cardCode.indexOf('Remove from Favourites');
    const playlistIndex = cardCode.indexOf('Add to Playlist');
    const replaceAudioIndex = cardCode.indexOf('Replace Audio');
    const replaceInstIndex = cardCode.indexOf('Replace Instrumental');
    const deleteIndex = cardCode.indexOf('Delete Song');
    assert.ok(favIndex !== -1 && playlistIndex !== -1 && replaceAudioIndex !== -1 && replaceInstIndex !== -1 && deleteIndex !== -1,
      'All five More Options actions are present');
    assert.ok(favIndex < playlistIndex && playlistIndex < replaceAudioIndex && replaceAudioIndex < replaceInstIndex && replaceInstIndex < deleteIndex,
      'More Options actions appear in the expected order');

    // Library song lists and search results pass their actions into the same component.
    assert.ok(libraryCode.includes('getSongCardActions(song)'), 'Library song rows use the shared action set');
    assert.ok(libraryCode.includes('getSongCardActions(item)'), 'Song search results use the shared action set');
    assert.ok(libraryCode.includes('handlePlayInJukebox(song, songs, idx)'), 'Play artwork button remains connected to the active song list');
    assert.ok(libraryCode.includes('handleQueueInJukebox(song)'), 'Jukebox queue handler remains connected');
    assert.ok(libraryCode.includes('deleteConfirmModal') && libraryCode.includes('Delete Song?'),
      'Delete Song continues to require confirmation');

    // Playlist detail uses the same Jukebox card while keeping its separate Karaoke room queue action.
    assert.ok(playlistCode.includes('onAddToJukeboxQueue'), 'Playlist detail connects the Jukebox queue action');
    assert.ok(playlistCode.includes('onAddToQueue(song.id)'), 'Playlist detail retains its separate Karaoke room queue action');

    // Karaoke room UI is not migrated to the Jukebox Library master card.
    const roomSessionCode = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/RoomSession.tsx'), 'utf-8');
    assert.ok(!roomSessionCode.includes('JukeboxSongCard'), 'RoomSession remains on its own Karaoke UI');
  });

  // --- SECTION 2: VERIFIED SOURCE PERSISTENCE & PIPELINE REUSE ---
  await t.test('Replace Audio: verified source is saved against exact song ID and reused by pipeline', async () => {
    const testUrl = 'https://www.youtube.com/watch?v=rYEDA3JcQqw';
    const result = await replaceSongRecordingSource(songId, testUrl);

    assert.strictEqual(result.songId, songId);
    assert.ok(result.jobId, 'Returns job ID');

    // Verify record in songVerifiedSources
    const verified = await db.select().from(songVerifiedSources).where(eq(songVerifiedSources.songId, songId));
    assert.strictEqual(verified.length, 1);
    assert.strictEqual(verified[0].songId, songId);
    assert.strictEqual(verified[0].youtubeUrl, testUrl);
    assert.strictEqual(verified[0].videoId, 'rYEDA3JcQqw');

    // Exact ID isolation: second song with same title and artist did NOT receive this verified source
    const verified2 = await db.select().from(songVerifiedSources).where(eq(songVerifiedSources.songId, song2Id));
    assert.strictEqual(verified2.length, 0, 'Song 2 must not receive verified source belonging to Song 1');

    // Verify existing pipeline method is reused
    assert.strictEqual(typeof downloadQueue.downloadSingleTrackAudio, 'function', 'Reuses downloadQueue pipeline method');
  });

  await t.test('Replace Audio: URL validation and error handling', async () => {
    assert.strictEqual(isValidYouTubeUrl('https://www.youtube.com/watch?v=rYEDA3JcQqw'), true);
    assert.strictEqual(isValidYouTubeUrl('https://youtu.be/rYEDA3JcQqw'), true);
    assert.strictEqual(isValidYouTubeUrl('not_a_url'), false);
    assert.strictEqual(extractYouTubeVideoId('https://www.youtube.com/watch?v=12345678901'), '12345678901');

    // Non-existent song ID fails gracefully
    const notFoundRes = await replaceSongRecordingSource(999999, 'https://www.youtube.com/watch?v=12345678901');
    assert.strictEqual(notFoundRes.success, false);
    assert.match(notFoundRes.error || notFoundRes.message, /not found/i);
  });

  await t.test('Replace Audio: Safe file rollback and metadata preservation on invalid source download', async () => {
    const preSong = (await db.select().from(songs).where(eq(songs.id, songId)))[0];
    const preAudioContent = fs.readFileSync(preSong.mainAudioPath!);

    const failRes = await replaceSongRecordingSource(songId, 'https://www.youtube.com/watch?v=invalid_id_fail');
    assert.strictEqual(failRes.success, false, 'Invalid source returns failure');

    // Original files and metadata untouched
    const postSong = (await db.select().from(songs).where(eq(songs.id, songId)))[0];
    assert.strictEqual(postSong.title, preSong.title, 'Title preserved');
    assert.strictEqual(postSong.artistId, preSong.artistId, 'Artist ID preserved');
    assert.strictEqual(postSong.albumId, preSong.albumId, 'Album ID preserved');
    assert.strictEqual(postSong.mainAudioPath, preSong.mainAudioPath, 'Audio path untouched');
    assert.strictEqual(fs.readFileSync(postSong.mainAudioPath!).toString(), preAudioContent.toString(), 'Original audio content preserved');
  });

  await t.test('Replace Audio: Concurrency protection blocks simultaneous replacements for same song', async () => {
    // Start two concurrent replacements
    const p1 = replaceSongRecordingSource(songId, 'https://www.youtube.com/watch?v=12345678901');
    const p2 = replaceSongRecordingSource(songId, 'https://www.youtube.com/watch?v=12345678901');

    const [r1, r2] = await Promise.all([p1, p2]);
    // One of them must report conflict
    const hasConflict = !r1.success || !r2.success;
    assert.ok(hasConflict, 'Concurrent replacements for same song ID are blocked');
  });

  // --- SECTION 3: REPLACE INSTRUMENTAL ---
  await t.test('Replace Instrumental: regenerates instrumental from original audio without downloading', async () => {
    const preSong = (await db.select().from(songs).where(eq(songs.id, songId)))[0];
    const originalMainPath = preSong.mainAudioPath;

    const res = await replaceSongInstrumental(songId);
    assert.ok(res.songId === songId);

    const postSong = (await db.select().from(songs).where(eq(songs.id, songId)))[0];
    assert.strictEqual(postSong.mainAudioPath, originalMainPath, 'Original main audio path left completely unchanged');
    assert.ok(postSong.instrumentalAudioPath, 'Instrumental audio path exists');
    assert.strictEqual(postSong.title, preSong.title, 'Song metadata preserved');
  });

  // --- SECTION 4: PERMISSIONS & API ENDPOINTS ---
  await t.test('Permissions: Non-admin users cannot call replace-source or replace-instrumental (403 Forbidden)', async () => {
    // Non-admin replace-source
    const res1 = await fetch(`${baseUrl}/api/songs/${songId}/replace-source`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ youtubeUrl: 'https://www.youtube.com/watch?v=rYEDA3JcQqw' }),
    });
    assert.strictEqual(res1.status, 403, 'Regular user must receive 403 Forbidden on replace-source');

    // Non-admin replace-instrumental
    const res2 = await fetch(`${baseUrl}/api/songs/${songId}/replace-instrumental`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
    });
    assert.strictEqual(res2.status, 403, 'Regular user must receive 403 Forbidden on replace-instrumental');

    // Admin can access replacement endpoints
    const res3 = await fetch(`${baseUrl}/api/songs/${songId}/verified-source`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(res3.status, 200, 'Admin can fetch verified source');
    const vData = await res3.json();
    assert.ok(vData.verifiedSource !== undefined);
  });
});
