import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { setupDatabase, db } from '../db/index.js';
import { users, libraries, artists, songs, playlists, playlistSongs } from '../db/schema.js';
import { scanLibrary } from '../lib/scanner.js';

test('scanner preserves playlist entries when a library root is missing or empty', async () => {
  await setupDatabase();
  const suffix = `${process.pid}-${Date.now()}`;
  const now = new Date();
  const missingRoot = path.join(os.tmpdir(), `yimly-missing-library-${suffix}`);
  const emptyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'yimly-empty-library-'));
  let userId: number | undefined;
  let libraryId: number | undefined;
  let artistId: number | undefined;
  let songId: number | undefined;
  let playlistId: number | undefined;

  try {
    const [user] = await db.insert(users).values({
      username: `scan-safety-${suffix}`,
      password: 'test-only',
      createdAt: now,
      updatedAt: now,
    }).returning();
    userId = user.id;

    const [library] = await db.insert(libraries).values({
      name: `Scan Safety Library ${suffix}`,
      path: missingRoot,
    }).returning();
    libraryId = library.id;

    const [artist] = await db.insert(artists).values({ name: `Scan Safety Artist ${suffix}` }).returning();
    artistId = artist.id;

    const [song] = await db.insert(songs).values({
      libraryId,
      artistId,
      title: 'Playlist preservation test song',
      mainAudioPath: path.join(missingRoot, 'track.mp3'),
    }).returning();
    songId = song.id;

    const [playlist] = await db.insert(playlists).values({
      userId,
      name: `Scan Safety Playlist ${suffix}`,
      createdAt: now,
      updatedAt: now,
    }).returning();
    playlistId = playlist.id;

    await db.insert(playlistSongs).values({
      playlistId,
      songId,
      position: 0,
      addedAt: now,
    });

    await assert.rejects(scanLibrary(libraryId, missingRoot), /library root/i);
    let links = await db.select().from(playlistSongs).where(eq(playlistSongs.playlistId, playlistId));
    assert.equal(links.length, 1, 'missing root must not remove playlist entries');

    await assert.rejects(scanLibrary(libraryId, emptyRoot), /no supported audio files/i);
    links = await db.select().from(playlistSongs).where(eq(playlistSongs.playlistId, playlistId));
    assert.equal(links.length, 1, 'empty root must not remove playlist entries');
    assert.equal((await db.select().from(songs).where(eq(songs.id, songId))).length, 1);
  } finally {
    if (playlistId !== undefined) await db.delete(playlists).where(eq(playlists.id, playlistId));
    if (songId !== undefined) await db.delete(songs).where(eq(songs.id, songId));
    if (artistId !== undefined) await db.delete(artists).where(eq(artists.id, artistId));
    if (libraryId !== undefined) await db.delete(libraries).where(eq(libraries.id, libraryId));
    if (userId !== undefined) await db.delete(users).where(eq(users.id, userId));
    await fs.rm(emptyRoot, { recursive: true, force: true });
  }
});
