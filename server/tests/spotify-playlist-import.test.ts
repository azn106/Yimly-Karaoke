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
import { users, libraries, playlists } from '../db/schema.js';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev';

test('Spotify Playlist Import & Automatic Yimly Playlist Creation', async () => {
  const testDataDir = path.resolve(process.cwd(), 'data/test_spotify_import_isolated');
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDataDir, { recursive: true });
  process.env.DATA_DIR = testDataDir;

  const dbModule = await import('../db/index.js');
  await dbModule.setupDatabase();

  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  const authRoutes = (await import('../routes/auth.js')).default;
  const downloaderRoutes = (await import('../routes/downloader.js')).default;
  const playlistsRoutes = (await import('../routes/playlists.js')).default;

  app.use('/api/auth', authRoutes);
  app.use('/api/downloader', downloaderRoutes);
  app.use('/api/playlists', playlistsRoutes);

  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const address = server.address() as any;
  const baseUrl = `http://localhost:${address.port}`;

  // 1. Setup test users and library
  const hashedPassword = await bcrypt.hash('password123', 10);
  const now = new Date();
  const [user1] = await dbModule.db.insert(users).values({
    username: 'spotify_user_one',
    password: hashedPassword,
    role: 'user',
    createdAt: now,
    updatedAt: now,
  }).returning();

  const [user2] = await dbModule.db.insert(users).values({
    username: 'spotify_user_two',
    password: hashedPassword,
    role: 'user',
    createdAt: now,
    updatedAt: now,
  }).returning();

  const [lib] = await dbModule.db.insert(libraries).values({
    name: 'Test Library',
    path: path.join(testDataDir, 'library'),
    lastScan: now,
  }).returning();

  const token1 = jwt.sign({ id: user1.id, username: user1.username, role: user1.role }, JWT_SECRET);
  const token2 = jwt.sign({ id: user2.id, username: user2.username, role: user2.role }, JWT_SECRET);

  // 2. Test Unauthorized request (401)
  const unauthRes = await fetch(`${baseUrl}/api/downloader/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playlistName: 'Unauth Playlist',
      tracks: [{ title: 'Song 1', artist: 'Artist 1' }]
    })
  });
  assert.strictEqual(unauthRes.status, 401);

  // 3. Test starting Spotify playlist download by User 1
  const spotifyPlaylistId = 'spot_pl_abc123';
  const playlistName = 'My Chill Hits';
  const tracksPayload = [
    { title: 'Chill Track One', artist: 'Artist A', duration: 200, spotifyId: 'tr_1' },
    { title: 'Chill Track Two', artist: 'Artist B', duration: 220, spotifyId: 'tr_2' },
  ];

  const startRes = await fetch(`${baseUrl}/api/downloader/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token1}`,
    },
    body: JSON.stringify({
      libraryId: lib.id,
      playlistName,
      spotifyPlaylistId,
      tracks: tracksPayload,
    })
  });

  assert.strictEqual(startRes.status, 200);
  const startData = await startRes.json();
  assert.ok(startData.jobId);

  // Verify Yimly playlist was created immediately and attached to User 1
  const createdPlaylists = await dbModule.db.select().from(playlists).where(eq(playlists.userId, user1.id));
  assert.strictEqual(createdPlaylists.length, 1);
  assert.strictEqual(createdPlaylists[0].name, playlistName);
  assert.strictEqual(createdPlaylists[0].sourceId, spotifyPlaylistId);
  assert.strictEqual(createdPlaylists[0].sourceType, 'spotify');

  // Verify user 2 importing same Spotify playlist creates their own separate playlist (duplicate isolation across users)
  const startRes2 = await fetch(`${baseUrl}/api/downloader/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token2}`,
    },
    body: JSON.stringify({
      libraryId: lib.id,
      playlistName,
      spotifyPlaylistId,
      tracks: tracksPayload,
    })
  });
  assert.strictEqual(startRes2.status, 200);

  const user2Playlists = await dbModule.db.select().from(playlists).where(eq(playlists.userId, user2.id));
  assert.strictEqual(user2Playlists.length, 1);
  assert.notStrictEqual(user2Playlists[0].id, createdPlaylists[0].id);

  // 4. Test duplicate handling / re-importing same playlist by User 1
  const reImportRes = await fetch(`${baseUrl}/api/downloader/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token1}`,
    },
    body: JSON.stringify({
      libraryId: lib.id,
      playlistName: 'Updated Chill Hits Name',
      spotifyPlaylistId,
      tracks: tracksPayload,
    })
  });
  assert.strictEqual(reImportRes.status, 200);

  // Verify User 1 still has only 1 playlist with this sourceId (reused, no duplicates created)
  const user1PlaylistsAfter = await dbModule.db.select().from(playlists).where(eq(playlists.userId, user1.id));
  assert.strictEqual(user1PlaylistsAfter.length, 1);
  assert.strictEqual(user1PlaylistsAfter[0].id, createdPlaylists[0].id);
  assert.strictEqual(user1PlaylistsAfter[0].name, 'Updated Chill Hits Name');

  await new Promise<void>(res => server.close(() => res()));
  fs.rmSync(testDataDir, { recursive: true, force: true });
  console.log('Spotify Playlist Import & Automatic Creation tests passed successfully!');
});
