import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema.js';
import fs from 'fs';
import path from 'path';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';

// Ensure data directory and artwork directory exist
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const artworkDir = path.join(dataDir, 'artwork');
if (!fs.existsSync(artworkDir)) {
  fs.mkdirSync(artworkDir, { recursive: true });
}
const playlistCoversDir = path.join(dataDir, 'playlist_covers');
if (!fs.existsSync(playlistCoversDir)) {
  fs.mkdirSync(playlistCoversDir, { recursive: true });
}
const fontsDir = path.join(dataDir, 'fonts');
if (!fs.existsSync(fontsDir)) {
  fs.mkdirSync(fontsDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'yimly.db');

export let sqlite = createClient({
  url: `file:${dbPath}`,
});

export let db = drizzle(sqlite, { schema });

export let databaseCorrupted = false;
export let databaseErrorMessage: string | null = null;

// Run migrations on startup and check for corruption
export async function setupDatabase() {
  const migrationsFolder = path.resolve(process.cwd(), 'server/db/migrations');
  
  let isCorrupt = false;
  let corruptionReason = '';

  try {
    // Configure robust SQLite pragmas for stability and corruption prevention
    await sqlite.execute('PRAGMA journal_mode = WAL;');
    await sqlite.execute('PRAGMA synchronous = NORMAL;');
    await sqlite.execute('PRAGMA busy_timeout = 5000;');
    await sqlite.execute('PRAGMA foreign_keys = ON;');

    const result = await sqlite.execute('PRAGMA integrity_check;');
    if (result.rows && result.rows.length > 0) {
      const val = Object.values(result.rows[0])[0];
      if (val !== 'ok') {
        corruptionReason = `PRAGMA integrity_check returned: ${val}`;
        isCorrupt = true;
      }
    }
  } catch (err: any) {
    if (err && (err.message?.includes('CORRUPT') || err.message?.includes('malformed') || err.code === 'SQLITE_CORRUPT')) {
      corruptionReason = err.message || 'SQLITE_CORRUPT error during integrity check';
      isCorrupt = true;
    }
  }

  if (!isCorrupt) {
    try {
      await db.select().from(schema.users).limit(1);
    } catch (err: any) {
      if (err && (err.message?.includes('CORRUPT') || err.message?.includes('malformed') || err.code === 'SQLITE_CORRUPT')) {
        corruptionReason = err.message || 'SQLITE_CORRUPT error querying users table';
        isCorrupt = true;
      }
    }
  }

  if (isCorrupt) {
    databaseCorrupted = true;
    databaseErrorMessage = `Database corruption detected: ${corruptionReason}. Manual database recovery required.`;

    console.error('========================================================================');
    console.error('🚨 CRITICAL DATABASE CORRUPTION ERROR');
    console.error(`Database Path: ${dbPath}`);
    console.error(`Reason: ${corruptionReason}`);
    console.error('Action taken: Stopped database initialization. Preserved original database.');
    console.error('A timestamped backup copy has been created for diagnostic purposes.');
    console.error('MANUAL DATABASE RECOVERY IS REQUIRED. Do not delete or overwrite data.');
    console.error('========================================================================');

    try {
      if (fs.existsSync(dbPath)) {
        const timestamp = Date.now();
        const backupPath = `${dbPath}.corrupt.${timestamp}`;
        fs.copyFileSync(dbPath, backupPath);
        if (fs.existsSync(`${dbPath}-wal`)) {
          fs.copyFileSync(`${dbPath}-wal`, `${backupPath}-wal`);
        }
        if (fs.existsSync(`${dbPath}-shm`)) {
          fs.copyFileSync(`${dbPath}-shm`, `${backupPath}-shm`);
        }
        console.log(`📁 Created timestamped backup copy of corrupted database at: ${backupPath}`);
      }
    } catch (backupErr) {
      console.error('Failed to create backup copy of corrupted database:', backupErr);
    }

    // Stop normal database initialization. Do NOT create a new empty database, do NOT run migrations.
    return;
  }

  // Check if migrations folder exists before running migrate to avoid crashing if it's not generated yet
  if (fs.existsSync(migrationsFolder)) {
    try {
      await migrate(db, { migrationsFolder });
      console.log('Database migrations applied successfully.');
    } catch (error) {
      console.error('Error applying migrations:', error);
    }
  } else {
    console.warn('Migrations folder not found, skipping migrations.');
  }

  // Ensure elrc_path column exists in lyrics table
  try {
    await sqlite.execute('ALTER TABLE lyrics ADD COLUMN elrc_path text;');
    await sqlite.execute("UPDATE lyrics SET elrc_path = lrc_path, lrc_path = '' WHERE lrc_path LIKE '%.elrc.lrc'");
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure artwork_path, lyric_offset, lrc_offset, and elrc_offset columns exist in songs table (backward compatibility safety)
  try {
    await sqlite.execute('ALTER TABLE songs ADD COLUMN artwork_path text;');
  } catch (e) {
    // Column already exists, safe to ignore
  }
  try {
    await sqlite.execute('ALTER TABLE songs ADD COLUMN lyric_offset integer DEFAULT 0;');
  } catch (e) {
    // Column already exists, safe to ignore
  }
  try {
    await sqlite.execute('ALTER TABLE songs ADD COLUMN lrc_offset integer DEFAULT 0;');
  } catch (e) {
    // Column already exists, safe to ignore
  }
  try {
    await sqlite.execute('ALTER TABLE songs ADD COLUMN elrc_offset integer DEFAULT 0;');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure lyric_settings column exists in sessions table
  try {
    await sqlite.execute('ALTER TABLE sessions ADD COLUMN lyric_settings text;');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure guest_name column exists in controllers and queue_items
  try {
    await sqlite.execute('ALTER TABLE controllers ADD COLUMN guest_name text;');
  } catch (e) {
    // Column already exists, safe to ignore
  }
  try {
    await sqlite.execute('ALTER TABLE queue_items ADD COLUMN guest_name text;');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Ensure queue_items user_id is nullable (allow guest queueing)
  try {
    const tableInfo = await sqlite.execute("PRAGMA table_info(queue_items);");
    const userIdCol = tableInfo.rows?.find((r: any) => r.name === 'user_id');
    if (userIdCol && userIdCol.notnull === 1) {
      await sqlite.execute('PRAGMA foreign_keys=OFF;');
      await sqlite.execute(`
        CREATE TABLE IF NOT EXISTS queue_items_new (
          id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
          session_id text NOT NULL,
          song_id integer NOT NULL,
          user_id integer,
          guest_name text,
          added_at integer NOT NULL,
          position integer NOT NULL,
          status text DEFAULT 'pending' NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
          FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        );
      `);
      await sqlite.execute(`
        INSERT INTO queue_items_new (id, session_id, song_id, user_id, guest_name, added_at, position, status)
        SELECT id, session_id, song_id, user_id, guest_name, added_at, position, status FROM queue_items;
      `);
      await sqlite.execute('DROP TABLE queue_items;');
      await sqlite.execute('ALTER TABLE queue_items_new RENAME TO queue_items;');
      await sqlite.execute('PRAGMA foreign_keys=ON;');
      console.log('Migrated queue_items.user_id to be nullable for guests.');
    }
  } catch (e) {
    console.error('Failed to ensure nullable queue_items.user_id:', e);
  }

  // Ensure queue_items.song_id is nullable (to support downloading tracks) and add temp/download columns
  try {
    const tableInfo = await sqlite.execute("PRAGMA table_info(queue_items);");
    const songIdCol = tableInfo.rows?.find((r: any) => r.name === 'song_id');
    const hasTempTitle = tableInfo.rows?.some((r: any) => r.name === 'temp_title');
    
    if ((songIdCol && songIdCol.notnull === 1) || !hasTempTitle) {
      await sqlite.execute('PRAGMA foreign_keys=OFF;');
      await sqlite.execute(`
        CREATE TABLE IF NOT EXISTS queue_items_new (
          id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
          session_id text NOT NULL,
          song_id integer,
          user_id integer,
          guest_name text,
          added_at integer NOT NULL,
          position integer NOT NULL,
          status text DEFAULT 'pending' NOT NULL,
          temp_title text,
          temp_artist text,
          temp_artwork_url text,
          download_job_id text,
          download_track_id text,
          download_status text,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
          FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        );
      `);
      
      const hasGuestName = tableInfo.rows?.some((r: any) => r.name === 'guest_name');
      const insertCols = `id, session_id, song_id, user_id, ${hasGuestName ? 'guest_name, ' : ''}added_at, position, status`;
      const selectCols = `id, session_id, song_id, user_id, ${hasGuestName ? 'guest_name, ' : ''}added_at, position, status`;
      
      await sqlite.execute(`
        INSERT INTO queue_items_new (${insertCols})
        SELECT ${selectCols} FROM queue_items;
      `);
      await sqlite.execute('DROP TABLE queue_items;');
      await sqlite.execute('ALTER TABLE queue_items_new RENAME TO queue_items;');
      await sqlite.execute('PRAGMA foreign_keys=ON;');
      console.log('Migrated queue_items.song_id to be nullable and added temp/download columns.');
    }
  } catch (e) {
    console.error('Failed to ensure nullable queue_items.song_id and download columns:', e);
  }

  // Ensure songs.main_audio_path is nullable (to support instrumental-only songs)
  try {
    const songTableInfo = await sqlite.execute("PRAGMA table_info(songs);");
    const mainAudioCol = songTableInfo.rows?.find((r: any) => r.name === 'main_audio_path');
    if (mainAudioCol && mainAudioCol.notnull === 1) {
      await sqlite.execute('PRAGMA foreign_keys=OFF;');
      await sqlite.execute(`
        CREATE TABLE IF NOT EXISTS songs_new (
          id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
          library_id integer NOT NULL,
          artist_id integer NOT NULL,
          album_id integer,
          title text NOT NULL,
          main_audio_path text,
          instrumental_audio_path text,
          duration integer,
          track_number integer,
          disc_number integer,
          genre text,
          year integer,
          variant text DEFAULT 'original' NOT NULL,
          file_size integer,
          format text,
          artwork_path text,
          lrc_offset integer DEFAULT 0,
          elrc_offset integer DEFAULT 0,
          lyric_offset integer DEFAULT 0,
          FOREIGN KEY (library_id) REFERENCES libraries(id) ON DELETE CASCADE,
          FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE,
          FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE SET NULL
        );
      `);
      await sqlite.execute(`
        INSERT INTO songs_new (id, library_id, artist_id, album_id, title, main_audio_path, instrumental_audio_path, duration, track_number, disc_number, genre, year, variant, file_size, format, artwork_path, lrc_offset, elrc_offset, lyric_offset)
        SELECT id, library_id, artist_id, album_id, title, main_audio_path, instrumental_audio_path, duration, track_number, disc_number, genre, year, variant, file_size, format, artwork_path, lrc_offset, elrc_offset, lyric_offset FROM songs;
      `);
      await sqlite.execute('DROP TABLE songs;');
      await sqlite.execute('ALTER TABLE songs_new RENAME TO songs;');
      await sqlite.execute('PRAGMA foreign_keys=ON;');
      console.log('Migrated songs.main_audio_path to be nullable.');
    }
  } catch (e) {
    console.error('Failed to ensure nullable songs.main_audio_path:', e);
  }

  // Ensure song_artists table exists (backward compatibility safety)
  try {
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS song_artists (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        song_id integer NOT NULL,
        artist_id integer NOT NULL,
        position integer DEFAULT 0 NOT NULL,
        FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
        FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
      );
    `);
    await sqlite.execute('CREATE INDEX IF NOT EXISTS song_artists_song_id_idx ON song_artists (song_id);');
    await sqlite.execute('CREATE INDEX IF NOT EXISTS song_artists_artist_id_idx ON song_artists (artist_id);');
  } catch (e) {
    // Table/indices already exist, safe to ignore
  }

  // Ensure playlists and playlist_songs tables exist
  try {
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS playlists (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        user_id integer NOT NULL,
        name text NOT NULL,
        description text,
        is_public integer DEFAULT 0 NOT NULL,
        cover_path text,
        created_at integer NOT NULL,
        updated_at integer NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS playlist_songs (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        playlist_id integer NOT NULL,
        song_id integer NOT NULL,
        position integer DEFAULT 0 NOT NULL,
        added_at integer NOT NULL,
        FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
        FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
      );
    `);
    await sqlite.execute('CREATE INDEX IF NOT EXISTS playlists_user_id_idx ON playlists (user_id);');
    await sqlite.execute('CREATE INDEX IF NOT EXISTS playlist_songs_playlist_id_idx ON playlist_songs (playlist_id);');
  } catch (e) {
    // Table/indices already exist, safe to ignore
  }

  // Ensure playlist_shares table exists
  try {
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS playlist_shares (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        playlist_id integer NOT NULL,
        user_id integer NOT NULL,
        permission text DEFAULT 'view' NOT NULL,
        created_at integer NOT NULL,
        FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    await sqlite.execute('CREATE UNIQUE INDEX IF NOT EXISTS playlist_shares_user_id_playlist_id_idx ON playlist_shares (user_id, playlist_id);');
  } catch (e) {
    console.error('Failed to create playlist_shares table:', e);
  }

  // Ensure favorites table exists
  try {
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS favorites (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        user_id integer NOT NULL,
        song_id integer NOT NULL,
        created_at integer NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
      );
    `);
    await sqlite.execute('CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_id_song_id_idx ON favorites (user_id, song_id);');
    await sqlite.execute('CREATE INDEX IF NOT EXISTS favorites_user_id_idx ON favorites (user_id);');
  } catch (e) {
    // Table/indices already exist, safe to ignore
  }

  // Ensure download_jobs and download_track_jobs tables exist
  try {
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS download_jobs (
        id text PRIMARY KEY NOT NULL,
        playlist_name text,
        type text DEFAULT 'playlist' NOT NULL,
        status text DEFAULT 'queued' NOT NULL,
        library_id integer,
        library_path text NOT NULL,
        format text DEFAULT 'mp3' NOT NULL,
        quality text DEFAULT '320k' NOT NULL,
        embed_metadata integer DEFAULT 1 NOT NULL,
        embed_artwork integer DEFAULT 1 NOT NULL,
        download_lyrics integer DEFAULT 1 NOT NULL,
        lyrics_providers text,
        folder_structure text DEFAULT 'artist/album' NOT NULL,
        playlist_folder integer DEFAULT 0 NOT NULL,
        total_count integer DEFAULT 0 NOT NULL,
        completed_count integer DEFAULT 0 NOT NULL,
        failed_count integer DEFAULT 0 NOT NULL,
        created_at integer NOT NULL,
        updated_at integer NOT NULL,
        FOREIGN KEY (library_id) REFERENCES libraries(id) ON DELETE CASCADE
      );
    `);
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS download_track_jobs (
        id text PRIMARY KEY NOT NULL,
        job_id text NOT NULL,
        title text NOT NULL,
        artist text NOT NULL,
        album text DEFAULT '' NOT NULL,
        track_number integer,
        disc_number integer,
        release_year integer,
        duration integer,
        artwork_url text,
        source_url text,
        status text DEFAULT 'queued' NOT NULL,
        progress integer DEFAULT 0 NOT NULL,
        retry_count integer DEFAULT 0 NOT NULL,
        error text,
        output_path text,
        position integer DEFAULT 0 NOT NULL,
        created_at integer NOT NULL,
        updated_at integer NOT NULL,
        FOREIGN KEY (job_id) REFERENCES download_jobs(id) ON DELETE CASCADE
      );
    `);
    await sqlite.execute('CREATE INDEX IF NOT EXISTS download_jobs_status_idx ON download_jobs (status);');
    await sqlite.execute('CREATE INDEX IF NOT EXISTS download_track_jobs_job_id_idx ON download_track_jobs (job_id);');
    await sqlite.execute('CREATE INDEX IF NOT EXISTS download_track_jobs_status_idx ON download_track_jobs (status);');
  } catch (e) {
    console.error('Failed to create download jobs tables:', e);
  }

  // Ensure cover_path column exists in playlists table (backward compatibility safety)
  try {
    await sqlite.execute('ALTER TABLE playlists ADD COLUMN cover_path text;');
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Normalize multi-artist metadata, backfill song_artists, and cleanup orphaned records
  try {
    const { normalizeMultiArtistsInDatabase, cleanupOrphanedRecords } = await import('../lib/artist-utils.js');
    await normalizeMultiArtistsInDatabase();
    await cleanupOrphanedRecords();
    console.log('Multi-artist metadata normalized and orphaned records cleaned.');
  } catch (err) {
    console.error('Failed to normalize multi-artist metadata and clean orphaned records:', err);
  }

  // Cleanup any sessions that were left active when the server last shut down/crashed
  try {
    await db.update(schema.sessions).set({ status: 'closed' }).where(eq(schema.sessions.status, 'active'));
    console.log('Cleaned up stale sessions on startup.');
  } catch (error) {
    console.error('Failed to cleanup stale sessions on startup:', error);
  }
}

export async function checkpointAndCloseDatabase() {
  try {
    if (sqlite && !databaseCorrupted) {
      await sqlite.execute('PRAGMA wal_checkpoint(TRUNCATE);');
      await sqlite.close();
      console.log('Database WAL checkpointed and closed cleanly.');
    }
  } catch (err) {
    console.error('Error during database clean shutdown:', err);
  }
}

