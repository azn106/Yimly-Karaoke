import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import http from 'http';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';

const testDataDir = path.resolve(process.cwd(), 'data/test_playlist_data_loss_isolated');
if (fs.existsSync(testDataDir)) {
  fs.rmSync(testDataDir, { recursive: true, force: true });
}
fs.mkdirSync(testDataDir, { recursive: true });
process.env.DATA_DIR = testDataDir;

const DETERMINISTIC_TEST_JWT_SECRET = 'yimly_deterministic_test_jwt_secret_ci_only_32_bytes_safe';
const JWT_SECRET = process.env.JWT_SECRET || DETERMINISTIC_TEST_JWT_SECRET;
process.env.JWT_SECRET = JWT_SECRET;

const dbModule = await import('../db/index.js');
await dbModule.setupDatabase();

const { db } = dbModule;
const { users, libraries, artists, songs, playlists, playlistSongs } = await import('../db/schema.js');
const { scanLibrary, removeSingleFile, reconcileDuplicateSongs } = await import('../lib/scanner.js');

test('Playlist Data Loss Safeguards Regression Suite', async (t) => {
  // Setup test user
  const hashedPassword = await bcrypt.hash('password123', 10);
  const now = new Date();
  const [user] = await db.insert(users).values({
    username: 'playlist_tester',
    password: hashedPassword,
    role: 'administrator',
    createdAt: now,
    updatedAt: now,
  }).returning();

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET);

  // Setup express app with playlists route
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const playlistsRoutes = (await import('../routes/playlists.js')).default;
  app.use('/api/playlists', playlistsRoutes);

  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const address = server.address() as any;
  const baseUrl = `http://localhost:${address.port}`;

  t.after(() => {
    server.close();
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  // Setup artist and library
  const [artist] = await db.insert(artists).values({
    name: 'Queen',
  }).returning();

  const libDir = path.join(testDataDir, 'media_library');
  fs.mkdirSync(libDir, { recursive: true });

  const [lib] = await db.insert(libraries).values({
    name: 'Safeguard Test Library',
    path: libDir,
    lastScan: now,
  }).returning();

  await t.test('1. Library root directory unavailability safeguard (aborts safely without deleting)', async () => {
    // Insert a song in DB
    const dummyAudioPath = path.join(libDir, 'Track1.mp3');
    fs.writeFileSync(dummyAudioPath, 'dummy-audio-content');

    const [song1] = await db.insert(songs).values({
      libraryId: lib.id,
      artistId: artist.id,
      title: 'Bohemian Rhapsody',
      mainAudioPath: dummyAudioPath,
      duration: 354,
      variant: 'original',
    }).returning();

    // Create a playlist and add the song
    const [playlist] = await db.insert(playlists).values({
      userId: user.id,
      name: 'Unmounted Root Test Playlist',
      createdAt: now,
      updatedAt: now,
    }).returning();

    await db.insert(playlistSongs).values({
      playlistId: playlist.id,
      songId: song1.id,
      position: 1,
      addedAt: now,
    });

    // Run scan on non-existent / unmounted directory path
    const nonExistentPath = path.join(testDataDir, 'unmounted_share_xyz');
    await scanLibrary(lib.id, nonExistentPath);

    // Verify song and playlist_songs remain intact
    const remainingSongs = await db.select().from(songs).where(eq(songs.id, song1.id));
    assert.strictEqual(remainingSongs.length, 1, 'Song record should be preserved when library root is unavailable');

    const remainingEntries = await db.select().from(playlistSongs).where(eq(playlistSongs.playlistId, playlist.id));
    assert.strictEqual(remainingEntries.length, 1, 'Playlist association should be preserved when library root is unavailable');
  });

  await t.test('2. Empty scan / unmounted mount protection (does not purge library when 0 files found)', async () => {
    // Create an empty folder simulating an unmounted mount point or temporarily empty folder
    const emptyMountPoint = path.join(testDataDir, 'empty_mount');
    fs.mkdirSync(emptyMountPoint, { recursive: true });

    // Ensure song still exists in db
    const existingSongs = await db.select().from(songs).where(eq(songs.libraryId, lib.id));
    assert.ok(existingSongs.length > 0, 'Database should contain songs prior to empty scan test');

    // Scan the empty directory
    await scanLibrary(lib.id, emptyMountPoint);

    // Verify all existing songs and playlist entries still exist
    const songsAfter = await db.select().from(songs).where(eq(songs.libraryId, lib.id));
    assert.strictEqual(songsAfter.length, existingSongs.length, 'Existing songs must not be wiped when scan finds 0 files');
  });

  await t.test('3. Temporary media unavailability (removeSingleFile does not delete song or playlist associations)', async () => {
    // Query a song
    const [song] = await db.select().from(songs).where(eq(songs.libraryId, lib.id)).limit(1);
    assert.ok(song, 'A song must exist for this test');

    // Create a playlist entry for this song
    const [playlist] = await db.insert(playlists).values({
      userId: user.id,
      name: 'Temp Inaccessible Media Playlist',
      createdAt: now,
      updatedAt: now,
    }).returning();

    await db.insert(playlistSongs).values({
      playlistId: playlist.id,
      songId: song.id,
      position: 1,
      addedAt: now,
    });

    // Simulate media file deletion or temporary unmounting
    if (song.mainAudioPath && fs.existsSync(song.mainAudioPath)) {
      fs.unlinkSync(song.mainAudioPath);
    }

    // Call removeSingleFile
    await removeSingleFile(lib.id, song.mainAudioPath || '/path/to/missing/file.mp3');

    // Verify song and playlist_songs associations are still intact
    const songAfter = await db.select().from(songs).where(eq(songs.id, song.id));
    assert.strictEqual(songAfter.length, 1, 'Song record should not be deleted when media file is inaccessible');

    const associationsAfter = await db.select().from(playlistSongs).where(eq(playlistSongs.playlistId, playlist.id));
    assert.strictEqual(associationsAfter.length, 1, 'Playlist association should not be deleted when media file is inaccessible');
  });

  await t.test('4. Playlist detail retrieval preserves valid playlist entries and handles missing song records gracefully', async () => {
    // Create a new song that exists in DB
    const validAudio = path.join(libDir, 'RadioGaGa.mp3');
    fs.writeFileSync(validAudio, 'dummy-audio');

    const [validSong] = await db.insert(songs).values({
      libraryId: lib.id,
      artistId: artist.id,
      title: 'Radio Ga Ga',
      mainAudioPath: validAudio,
      duration: 343,
      variant: 'original',
    }).returning();

    // Create a playlist
    const [testPlaylist] = await db.insert(playlists).values({
      userId: user.id,
      name: 'Resilient Retrieval Playlist',
      createdAt: now,
      updatedAt: now,
    }).returning();

    // Add valid song at position 1
    await db.insert(playlistSongs).values({
      playlistId: testPlaylist.id,
      songId: validSong.id,
      position: 1,
      addedAt: now,
    });

    // Simulate an orphaned or unlinked association:
    // Insert a row in playlist_songs referencing a non-existent song ID with foreign_keys OFF
    const { sqlite } = dbModule;
    await sqlite.execute('PRAGMA foreign_keys = OFF;');
    await sqlite.execute({
      sql: 'INSERT INTO playlist_songs (playlist_id, song_id, position, added_at) VALUES (?, ?, ?, ?)',
      args: [testPlaylist.id, 99999999, 2, Math.floor(now.getTime() / 1000)]
    });
    await sqlite.execute('PRAGMA foreign_keys = ON;');

    // Request playlist details via API
    const res = await fetch(`${baseUrl}/api/playlists/${testPlaylist.id}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    assert.strictEqual(res.status, 200, 'Playlist details request should succeed with 200');
    const data = await res.json();

    assert.strictEqual(data.id, testPlaylist.id);
    assert.ok(Array.isArray(data.songs), 'Response should include songs array');
    assert.strictEqual(data.songs.length, 2, 'Both playlist entries should be returned (neither dropped nor zeroed out)');

    // Entry 1: valid song
    const entry1 = data.songs[0];
    assert.strictEqual(entry1.id, validSong.id);
    assert.strictEqual(entry1.title, 'Radio Ga Ga');
    assert.strictEqual(entry1.isUnavailable, false);

    // Entry 2: missing song record
    const entry2 = data.songs[1];
    assert.strictEqual(entry2.id, 99999999);
    assert.strictEqual(entry2.title, 'Unavailable Track');
    assert.strictEqual(entry2.isUnavailable, true);
  });

  await t.test('5. Duplicate-song reconciliation preserves playlist associations', async () => {
    // Create two duplicate song rows in the database for the same artist & normalized title
    const [primarySong] = await db.insert(songs).values({
      libraryId: lib.id,
      artistId: artist.id,
      title: 'Somebody to Love',
      mainAudioPath: path.join(libDir, 'SomebodyToLove.mp3'),
      duration: 296,
      variant: 'original',
    }).returning();

    const [duplicateSong] = await db.insert(songs).values({
      libraryId: lib.id,
      artistId: artist.id,
      title: 'Somebody to Love',
      instrumentalAudioPath: path.join(libDir, 'SomebodyToLove_inst.mp3'),
      duration: 296,
      variant: 'instrumental',
    }).returning();

    // Create a playlist and add the duplicate song
    const [dupTestPlaylist] = await db.insert(playlists).values({
      userId: user.id,
      name: 'Duplicate Reconciliation Playlist',
      createdAt: now,
      updatedAt: now,
    }).returning();

    await db.insert(playlistSongs).values({
      playlistId: dupTestPlaylist.id,
      songId: duplicateSong.id,
      position: 1,
      addedAt: now,
    });

    // Run duplicate reconciliation
    const merged = await reconcileDuplicateSongs(lib.id, 'Somebody to Love');
    assert.ok(merged >= 1, 'Should have reconciled at least one duplicate pair');

    // Verify the playlist entry was migrated to the surviving primary song
    const playlistEntries = await db.select().from(playlistSongs).where(eq(playlistSongs.playlistId, dupTestPlaylist.id));
    assert.strictEqual(playlistEntries.length, 1, 'Playlist should still contain 1 entry');
    assert.strictEqual(playlistEntries[0].songId, primarySong.id, 'Playlist entry should now reference the surviving primary song');
  });
});
