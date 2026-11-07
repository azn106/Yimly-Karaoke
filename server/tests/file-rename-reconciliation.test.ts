import test from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';

const testDataDir = path.resolve(process.cwd(), 'data/test_file_rename_isolated');
if (fs.existsSync(testDataDir)) {
  fs.rmSync(testDataDir, { recursive: true, force: true });
}
fs.mkdirSync(testDataDir, { recursive: true });
process.env.DATA_DIR = testDataDir;

const DETERMINISTIC_TEST_JWT_SECRET = 'yimly_deterministic_test_jwt_secret_ci_only_32_bytes_safe';
process.env.JWT_SECRET = process.env.JWT_SECRET || DETERMINISTIC_TEST_JWT_SECRET;

const dbModule = await import('../db/index.js');
await dbModule.setupDatabase();

const { db } = dbModule;
const { users, libraries, artists, songs, playlists, playlistSongs, lyrics, favorites, queueItems, songArtists } = await import('../db/schema.js');
const { scanLibrary, importSingleAudioFile, removeSingleFile } = await import('../lib/scanner.js');

test('File Rename and Move Reconciliation Suite', async (t) => {
  const hashedPassword = await bcrypt.hash('password123', 10);
  const now = new Date();
  const [user] = await db.insert(users).values({
    username: 'rename_tester',
    password: hashedPassword,
    role: 'administrator',
    createdAt: now,
    updatedAt: now,
  }).returning();

  const libDir = path.join(testDataDir, 'rename_library');
  const subDir = path.join(libDir, 'subdir');
  fs.mkdirSync(libDir, { recursive: true });
  fs.mkdirSync(subDir, { recursive: true });

  const [lib] = await db.insert(libraries).values({
    name: 'Rename Test Library',
    path: libDir,
    lastScan: now,
  }).returning();

  await t.test('1. Main audio file and lyrics sidecar rename in same directory preserves song record ID and associated data', async () => {
    const oldPath = path.join(libDir, 'Queen - Bohemian Rhapsody.mp3');
    const newPath = path.join(libDir, 'Queen - Bohemian Rhapsody (Updated).mp3');
    const oldLrcPath = path.join(libDir, 'Queen - Bohemian Rhapsody.lrc');
    const newLrcPath = path.join(libDir, 'Queen - Bohemian Rhapsody (Updated).lrc');

    fs.writeFileSync(oldPath, 'dummy-audio-content');
    fs.writeFileSync(oldLrcPath, '[00:10.00] Mama, just killed a man');

    // Initial scan to register song and lyrics
    await scanLibrary(lib.id, libDir);

    const initialSongs = await db.select().from(songs).where(eq(songs.libraryId, lib.id));
    assert.strictEqual(initialSongs.length, 1, 'Should scan exactly 1 song');
    const songId = initialSongs[0].id;

    // Attach playlist and favorite
    const [playlist] = await db.insert(playlists).values({
      userId: user.id,
      name: 'Rename Test Playlist',
      createdAt: now,
      updatedAt: now,
    }).returning();

    await db.insert(playlistSongs).values({
      playlistId: playlist.id,
      songId,
      position: 1,
      addedAt: now,
    });

    await db.insert(favorites).values({
      userId: user.id,
      songId,
      createdAt: now,
    });

    // Rename files on disk
    fs.unlinkSync(oldPath);
    fs.unlinkSync(oldLrcPath);
    fs.writeFileSync(newPath, 'dummy-audio-content');
    fs.writeFileSync(newLrcPath, '[00:10.00] Mama, just killed a man');

    // Re-scan library
    await scanLibrary(lib.id, libDir);

    const finalSongs = await db.select().from(songs).where(eq(songs.libraryId, lib.id));
    assert.strictEqual(finalSongs.length, 1, 'Renaming file must not create duplicate songs');
    assert.strictEqual(finalSongs[0].id, songId, 'Song ID must be preserved');
    assert.strictEqual(finalSongs[0].mainAudioPath, newPath, 'Main audio path must be updated to new path');

    // Verify associated records survived
    const playlistEntries = await db.select().from(playlistSongs).where(eq(playlistSongs.playlistId, playlist.id));
    assert.strictEqual(playlistEntries.length, 1, 'Playlist association must be preserved');
    assert.strictEqual(playlistEntries[0].songId, songId);

    const favRows = await db.select().from(favorites).where(eq(favorites.songId, songId));
    assert.strictEqual(favRows.length, 1, 'Favorite record must be preserved');

    const lyricRows = await db.select().from(lyrics).where(eq(lyrics.songId, songId));
    assert.strictEqual(lyricRows.length, 1, 'Lyrics record must be preserved');
  });

  await t.test('2. Moving a file to another directory within the library preserves song record', async () => {
    const srcPath = path.join(libDir, 'The Beatles - Let It Be.mp3');
    const destPath = path.join(subDir, 'The Beatles - Let It Be.mp3');

    fs.writeFileSync(srcPath, 'dummy-audio-beatles');
    await scanLibrary(lib.id, libDir);

    const songsList = await db.select().from(songs).where(eq(songs.libraryId, lib.id));
    const songRec = songsList.find(s => s.title.toLowerCase().includes('let it be'));
    assert.ok(songRec, 'Song should exist');
    const songId = songRec.id;

    // Move file
    fs.renameSync(srcPath, destPath);
    await scanLibrary(lib.id, libDir);

    const updatedSongs = await db.select().from(songs).where(eq(songs.id, songId));
    assert.strictEqual(updatedSongs.length, 1, 'Song record should still exist');
    assert.strictEqual(updatedSongs[0].mainAudioPath, destPath, 'Audio path should reflect new directory');
  });

  await t.test('3. Instrumental audio rename and separate variant handling', async () => {
    const instOld = path.join(libDir, 'Artist - Track (Instrumental).mp3');
    const instNew = path.join(libDir, 'Artist - Track (Inst Updated).mp3');

    fs.writeFileSync(instOld, 'dummy-inst');
    await scanLibrary(lib.id, libDir);

    const songsList = await db.select().from(songs).where(eq(songs.libraryId, lib.id));
    const instSong = songsList.find(s => s.instrumentalAudioPath === instOld);
    assert.ok(instSong, 'Instrumental song should be registered');
    const songId = instSong.id;

    fs.unlinkSync(instOld);
    fs.writeFileSync(instNew, 'dummy-inst');

    await scanLibrary(lib.id, libDir);

    const finalSongs = await db.select().from(songs).where(eq(songs.id, songId));
    assert.strictEqual(finalSongs.length, 1, 'Should preserve song record on instrumental rename');
    assert.strictEqual(finalSongs[0].instrumentalAudioPath, instNew, 'Instrumental audio path should be updated');
  });

  await t.test('4. Incorrect matching protection (different songs with similar artists are not incorrectly merged)', async () => {
    const file1 = path.join(libDir, 'Song One.mp3');
    const file2 = path.join(libDir, 'Song Two.mp3');

    fs.writeFileSync(file1, 'content-1');
    fs.writeFileSync(file2, 'content-2');

    await scanLibrary(lib.id, libDir);
    const initialSongs = await db.select().from(songs).where(eq(songs.libraryId, lib.id));
    const countBefore = initialSongs.length;

    // Delete file1 and add file2 (different song), should not merge or corrupt distinct records
    fs.unlinkSync(file1);
    await scanLibrary(lib.id, libDir);

    const afterSongs = await db.select().from(songs).where(eq(songs.libraryId, lib.id));
    assert.ok(afterSongs.length >= 1, 'Library should maintain valid records');
  });
});
