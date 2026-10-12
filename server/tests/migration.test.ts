import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';

test('Migration safety: empty database initializes correctly and applies migrations', async () => {
  const testDir = path.resolve(process.cwd(), 'data/test_migration_empty_isolated');
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });
  process.env.DATA_DIR = testDir;

  const dbModule = await import('../db/index.js');
  await dbModule.setupDatabase();

  const res = await dbModule.sqlite.execute('PRAGMA integrity_check;');
  assert.strictEqual(Object.values(res.rows[0])[0], 'ok', 'Integrity check should be ok');

  const fkRes = await dbModule.sqlite.execute('PRAGMA foreign_key_check;');
  assert.strictEqual(fkRes.rows.length, 0, 'Foreign key check should have no violations');

  const migrationsTable = await dbModule.sqlite.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations';");
  assert.strictEqual(migrationsTable.rows.length, 1, '__drizzle_migrations table should exist');

  fs.rmSync(testDir, { recursive: true, force: true });
});

test('Migration safety: populated database retains records and relationships', async () => {
  const testDir = path.resolve(process.cwd(), 'data/test_migration_populated_isolated');
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });
  process.env.DATA_DIR = testDir + '_2';
  fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

  const dbModule = await import('../db/index.js');
  await dbModule.setupDatabase();

  const [insertedUser] = await dbModule.db.insert(schema.users).values({
    username: 'migtestuser',
    password: 'hashedpassword',
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date()
  }).returning();

  const [insertedLibrary] = await dbModule.db.insert(schema.libraries).values({
    name: 'Test Lib',
    path: '/test/path',
    lastScan: new Date()
  }).returning();

  const [insertedArtist] = await dbModule.db.insert(schema.artists).values({
    name: 'Test Artist'
  }).returning();

  const [insertedSong] = await dbModule.db.insert(schema.songs).values({
    libraryId: insertedLibrary.id,
    artistId: insertedArtist.id,
    title: 'Test Song',
    mainAudioPath: '/test/audio.mp3',
    variant: 'original'
  }).returning();

  await dbModule.db.insert(schema.favorites).values({
    userId: insertedUser.id,
    songId: insertedSong.id,
    createdAt: new Date()
  });

  // Re-run setupDatabase (simulating restart / migration check)
  await dbModule.setupDatabase();

  const usersFound = await dbModule.db.select().from(schema.users).where(eq(schema.users.id, insertedUser.id));
  assert.strictEqual(usersFound.length, 1, 'User should be retained');
  assert.strictEqual(usersFound[0].username, 'migtestuser');

  const songsFound = await dbModule.db.select().from(schema.songs).where(eq(schema.songs.id, insertedSong.id));
  assert.strictEqual(songsFound.length, 1, 'Song should be retained');
  assert.strictEqual(songsFound[0].title, 'Test Song');

  const favsFound = await dbModule.db.select().from(schema.favorites);
  assert.strictEqual(favsFound.length, 1, 'Favorite should be retained');
  assert.strictEqual(favsFound[0].songId, insertedSong.id);

  const integ = await dbModule.sqlite.execute('PRAGMA integrity_check;');
  assert.strictEqual(Object.values(integ.rows[0])[0], 'ok');

  const fkCheck = await dbModule.sqlite.execute('PRAGMA foreign_key_check;');
  assert.strictEqual(fkCheck.rows.length, 0);

  fs.rmSync(testDir + '_2', { recursive: true, force: true });
});

test('Migration safety: a failed migration makes setupDatabase reject startup', async () => {
  const testDir = path.resolve(process.cwd(), 'data/test_migration_failure_isolated');
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });

  const badMigrationsDir = path.join(testDir, 'bad_migrations');
  const metaDir = path.join(badMigrationsDir, 'meta');
  fs.mkdirSync(metaDir, { recursive: true });
  fs.writeFileSync(path.join(badMigrationsDir, '0000_invalid.sql'), 'INVALID SQL SYNTAX;');
  fs.writeFileSync(path.join(metaDir, '_journal.json'), JSON.stringify({
    version: '7',
    dialect: 'sqlite',
    entries: [{
      idx: 0,
      version: '6',
      when: 1787360339586,
      tag: '0000_invalid',
      breakpoints: true
    }]
  }, null, 2));

  process.env.DATA_DIR = testDir;
  const dbModule = await import('../db/index.js');
  await assert.rejects(
    () => dbModule.setupDatabase(badMigrationsDir),
    /Database migration failed/
  );

  await dbModule.sqlite.close();
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('Interrupted migration recovery: unrecorded tables and indexes survive and retry succeeds', async () => {
  const testDir = path.resolve(process.cwd(), 'data/test_migration_interrupted_table');
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });

  const { createClient } = await import('@libsql/client');
  const dbPath = path.join(testDir, 'yimly.db');
  const rawSqlite = createClient({ url: `file:${dbPath}` });

  // Simulate database migrated through 0006
  await rawSqlite.execute('CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric);');
  await rawSqlite.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('h0', 1787360339586);");
  await rawSqlite.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('h1', 1787360524936);");
  await rawSqlite.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('h2', 1787360595346);");
  await rawSqlite.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('h3', 1787370000000);");
  await rawSqlite.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('h4', 1787395719808);");
  await rawSqlite.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('h5', 1787400000000);");
  await rawSqlite.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('h6', 1787410000000);");

  // Create base 0006 schema tables needed for 0007 rebuilds
  await rawSqlite.execute('CREATE TABLE libraries (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, name text NOT NULL, path text NOT NULL, last_scan integer);');
  await rawSqlite.execute('CREATE TABLE artists (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, name text NOT NULL, artwork_path text);');
  await rawSqlite.execute('CREATE TABLE albums (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, artist_id integer NOT NULL, title text NOT NULL, year integer, artwork_path text);');
  await rawSqlite.execute('CREATE TABLE users (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, username text NOT NULL, password text NOT NULL, role text NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL);');
  await rawSqlite.execute('CREATE TABLE sessions (id text PRIMARY KEY NOT NULL, room_code text NOT NULL, host_id integer NOT NULL, host_device text NOT NULL, status text NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL);');
  await rawSqlite.execute('CREATE TABLE controllers (id text PRIMARY KEY NOT NULL, session_id text NOT NULL, user_id integer, device text NOT NULL, last_seen_time integer NOT NULL);');
  await rawSqlite.execute('CREATE TABLE songs (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, library_id integer NOT NULL, artist_id integer NOT NULL, album_id integer, title text NOT NULL, main_audio_path text NOT NULL, instrumental_audio_path text, duration integer, track_number integer, disc_number integer, genre text, year integer, variant text NOT NULL, file_size integer, format text, artwork_path text);');
  await rawSqlite.execute('CREATE TABLE lyrics (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, song_id integer NOT NULL, lrc_path text NOT NULL);');
  await rawSqlite.execute('CREATE TABLE queue_items (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, session_id text NOT NULL, song_id integer NOT NULL, user_id integer NOT NULL, added_at integer NOT NULL, position integer NOT NULL, status text NOT NULL);');
  await rawSqlite.execute('CREATE TABLE song_artists (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, song_id integer NOT NULL, artist_id integer NOT NULL, position integer NOT NULL);');

  // Seed representative existing records so the interrupted migration proves data preservation.
  await rawSqlite.execute("INSERT INTO libraries (id, name, path, last_scan) VALUES (1, 'Keep Library', '/keep', 100);");
  await rawSqlite.execute("INSERT INTO artists (id, name, artwork_path) VALUES (1, 'Keep Artist', NULL);");
  await rawSqlite.execute("INSERT INTO albums (id, artist_id, title, year, artwork_path) VALUES (1, 1, 'Keep Album', 2020, NULL);");
  await rawSqlite.execute("INSERT INTO users (id, username, password, role, created_at, updated_at) VALUES (1, 'keep-user', 'hash', 'user', 100, 100);");
  await rawSqlite.execute("INSERT INTO sessions (id, room_code, host_id, host_device, status, created_at, updated_at) VALUES ('keep-session', 'KEEP1', 1, 'host', 'closed', 100, 100);");
  await rawSqlite.execute("INSERT INTO controllers (id, session_id, user_id, device, last_seen_time) VALUES ('keep-controller', 'keep-session', 1, 'phone', 100);");
  await rawSqlite.execute("INSERT INTO songs (id, library_id, artist_id, album_id, title, main_audio_path, instrumental_audio_path, duration, track_number, disc_number, genre, year, variant, file_size, format, artwork_path) VALUES (1, 1, 1, 1, 'Keep Song', '/keep/song.mp3', NULL, 180, 1, 1, NULL, 2020, 'original', 1000, 'mp3', NULL);");
  await rawSqlite.execute("INSERT INTO lyrics (id, song_id, lrc_path) VALUES (1, 1, '/keep/song.lrc');");
  await rawSqlite.execute("INSERT INTO queue_items (id, session_id, song_id, user_id, added_at, position, status) VALUES (1, 'keep-session', 1, 1, 100, 0, 'pending');");

  // Simulate an interrupted migration where download_jobs and favorites were already created,
  // but migration 0007 was interrupted before completing
  await rawSqlite.execute('CREATE TABLE download_jobs (id text PRIMARY KEY NOT NULL, playlist_name text, type text DEFAULT "playlist" NOT NULL, status text DEFAULT "queued" NOT NULL, library_id integer, library_path text NOT NULL, format text DEFAULT "mp3" NOT NULL, quality text DEFAULT "320k" NOT NULL, embed_metadata integer DEFAULT 1 NOT NULL, embed_artwork integer DEFAULT 1 NOT NULL, download_lyrics integer DEFAULT 1 NOT NULL, lyrics_providers text, folder_structure text DEFAULT "artist/album" NOT NULL, playlist_folder integer DEFAULT 0 NOT NULL, total_count integer DEFAULT 0 NOT NULL, completed_count integer DEFAULT 0 NOT NULL, failed_count integer DEFAULT 0 NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL);');
  await rawSqlite.execute('CREATE TABLE favorites (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, user_id integer NOT NULL, song_id integer NOT NULL, created_at integer NOT NULL);');

  rawSqlite.close();

  // Now run setupDatabase to verify it recovers cleanly and completes migration 0007
  process.env.DATA_DIR = testDir;
  const dbModule = await import('../db/index.js');
  await dbModule.setupDatabase();

  const retainedSong = await dbModule.sqlite.execute("SELECT title FROM songs WHERE id = 1;");
  assert.strictEqual(retainedSong.rows[0]?.title, 'Keep Song', 'Existing song must survive migration recovery');
  const retainedController = await dbModule.sqlite.execute("SELECT session_id FROM controllers WHERE id = 'keep-controller';");
  assert.strictEqual(retainedController.rows[0]?.session_id, 'keep-session', 'Existing controller relationship must survive recovery');
  const retainedLyrics = await dbModule.sqlite.execute("SELECT lrc_path FROM lyrics WHERE id = 1;");
  assert.strictEqual(retainedLyrics.rows[0]?.lrc_path, '/keep/song.lrc', 'Existing lyrics path must survive recovery');
  const retainedQueueItem = await dbModule.sqlite.execute("SELECT song_id, session_id FROM queue_items WHERE id = 1;");
  assert.strictEqual(retainedQueueItem.rows[0]?.song_id, 1, 'Existing queue item song relationship must survive recovery');
  assert.strictEqual(retainedQueueItem.rows[0]?.session_id, 'keep-session', 'Existing queue item session relationship must survive recovery');

  const integrity = await dbModule.sqlite.execute('PRAGMA integrity_check;');
  assert.strictEqual(Object.values(integrity.rows[0])[0], 'ok', 'Integrity check must pass after recovery');

  const fk = await dbModule.sqlite.execute('PRAGMA foreign_key_check;');
  assert.strictEqual(fk.rows.length, 0, 'Foreign key check must have 0 violations after recovery');

  fs.rmSync(testDir, { recursive: true, force: true });
});

test('Interrupted migration recovery: orphaned table rebuild staging tables recover safely', async () => {
  const testDir = path.resolve(process.cwd(), 'data/test_migration_interrupted_rebuild');
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });

  const { createClient } = await import('@libsql/client');
  const dbPath = path.join(testDir, 'yimly.db');
  const rawSqlite = createClient({ url: `file:${dbPath}` });

  // Simulate database migrated through 0006
  await rawSqlite.execute('CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric);');
  await rawSqlite.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('h0', 1787360339586);");
  await rawSqlite.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('h1', 1787360524936);");
  await rawSqlite.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('h2', 1787360595346);");
  await rawSqlite.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('h3', 1787370000000);");
  await rawSqlite.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('h4', 1787395719808);");
  await rawSqlite.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('h5', 1787400000000);");
  await rawSqlite.execute("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('h6', 1787410000000);");

  // Create base 0006 schema tables needed for 0007 rebuilds
  await rawSqlite.execute('CREATE TABLE libraries (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, name text NOT NULL, path text NOT NULL, last_scan integer);');
  await rawSqlite.execute('CREATE TABLE artists (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, name text NOT NULL, artwork_path text);');
  await rawSqlite.execute('CREATE TABLE albums (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, artist_id integer NOT NULL, title text NOT NULL, year integer, artwork_path text);');
  await rawSqlite.execute('CREATE TABLE users (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, username text NOT NULL, password text NOT NULL, role text NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL);');
  await rawSqlite.execute('CREATE TABLE sessions (id text PRIMARY KEY NOT NULL, room_code text NOT NULL, host_id integer NOT NULL, host_device text NOT NULL, status text NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL);');
  await rawSqlite.execute('CREATE TABLE songs (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, library_id integer NOT NULL, artist_id integer NOT NULL, album_id integer, title text NOT NULL, main_audio_path text NOT NULL, instrumental_audio_path text, duration integer, track_number integer, disc_number integer, genre text, year integer, variant text NOT NULL, file_size integer, format text, artwork_path text);');
  await rawSqlite.execute('CREATE TABLE lyrics (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, song_id integer NOT NULL, lrc_path text NOT NULL);');
  await rawSqlite.execute('CREATE TABLE queue_items (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, session_id text NOT NULL, song_id integer NOT NULL, user_id integer NOT NULL, added_at integer NOT NULL, position integer NOT NULL, status text NOT NULL);');
  await rawSqlite.execute('CREATE TABLE song_artists (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, song_id integer NOT NULL, artist_id integer NOT NULL, position integer NOT NULL);');

  await rawSqlite.execute("INSERT INTO users (id, username, password, role, created_at, updated_at) VALUES (1, 'stage-user', 'hash', 'user', 100, 100);");
  await rawSqlite.execute("INSERT INTO sessions (id, room_code, host_id, host_device, status, created_at, updated_at) VALUES ('sess1', 'STAGE1', 1, 'host', 'closed', 100, 100);");

  // Simulate interrupted rebuild case: __new_controllers exists with data, but controllers was already dropped
  await rawSqlite.execute('CREATE TABLE __new_controllers (id text PRIMARY KEY NOT NULL, session_id text NOT NULL, user_id integer, guest_name text, device text NOT NULL, connection_state text NOT NULL, last_seen_time integer NOT NULL);');
  await rawSqlite.execute("INSERT INTO __new_controllers VALUES ('ctrl_survived', 'sess1', NULL, 'GuestSinger', 'Phone', 'connected', 123456789);");

  rawSqlite.close();

  // Trigger setupDatabase
  process.env.DATA_DIR = testDir;
  const dbModule = await import('../db/index.js');
  await dbModule.setupDatabase();

  // Verify that controllers was safely recovered and data was retained
  const ctrlRes = await dbModule.sqlite.execute("SELECT * FROM controllers WHERE id = 'ctrl_survived';");
  assert.strictEqual(ctrlRes.rows.length, 1, 'Recovered controller record must exist');
  assert.strictEqual(ctrlRes.rows[0].guest_name, 'GuestSinger', 'Guest name must be preserved');

  const integrity = await dbModule.sqlite.execute('PRAGMA integrity_check;');
  assert.strictEqual(Object.values(integrity.rows[0])[0], 'ok', 'Integrity check must pass');

  const fk = await dbModule.sqlite.execute('PRAGMA foreign_key_check;');
  assert.strictEqual(fk.rows.length, 0, 'Foreign key check must pass');

  fs.rmSync(testDir, { recursive: true, force: true });
});

