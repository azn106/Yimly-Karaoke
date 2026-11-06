import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  role: text('role', { enum: ['administrator', 'user'] }).notNull().default('user'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  roomCode: text('room_code').notNull().unique(),
  hostId: integer('host_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  hostDevice: text('host_device').notNull(),
  status: text('status', { enum: ['active', 'closed'] }).notNull().default('active'),
  lyricSettings: text('lyric_settings'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const controllers = sqliteTable('controllers', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }).notNull(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  guestName: text('guest_name'),
  device: text('device').notNull(),
  connectionState: text('connection_state').notNull().default('connected'),
  lastSeenTime: integer('last_seen_time', { mode: 'timestamp' }).notNull(),
});

export const libraries = sqliteTable('libraries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  path: text('path').notNull(),
  lastScan: integer('last_scan', { mode: 'timestamp' }),
});

export const artists = sqliteTable('artists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  artworkPath: text('artwork_path'),
  artworkSource: text('artwork_source'),
  artworkSourceUrl: text('artwork_source_url'),
  artworkVerified: integer('artwork_verified').default(0),
  musicbrainzId: text('musicbrainz_id'),
});

export const albums = sqliteTable('albums', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  artistId: integer('artist_id').references(() => artists.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').notNull(),
  year: integer('year'),
  artworkPath: text('artwork_path'),
});

export const songs = sqliteTable('songs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  libraryId: integer('library_id').references(() => libraries.id, { onDelete: 'cascade' }).notNull(),
  artistId: integer('artist_id').references(() => artists.id, { onDelete: 'cascade' }).notNull(),
  albumId: integer('album_id').references(() => albums.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  mainAudioPath: text('main_audio_path'),
  instrumentalAudioPath: text('instrumental_audio_path'),
  duration: integer('duration'), // seconds
  trackNumber: integer('track_number'),
  discNumber: integer('disc_number'),
  genre: text('genre'),
  year: integer('year'),
  variant: text('variant').notNull().default('original'),
  fileSize: integer('file_size'),
  format: text('format'),
  artworkPath: text('artwork_path'),
  lrcOffset: integer('lrc_offset').notNull().default(0),
  elrcOffset: integer('elrc_offset').notNull().default(0),
  lyricOffset: integer('lyric_offset').notNull().default(0),
}, (table) => ({
  titleIdx: index('songs_title_idx').on(table.title),
  artistIdx: index('songs_artist_id_idx').on(table.artistId),
  albumIdx: index('songs_album_id_idx').on(table.albumId),
}));

export const lyrics = sqliteTable('lyrics', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  songId: integer('song_id').references(() => songs.id, { onDelete: 'cascade' }).notNull(),
  lrcPath: text('lrc_path'),
  elrcPath: text('elrc_path'),
}, (table) => ({
  songIdIdx: index('lyrics_song_id_idx').on(table.songId),
}));

export const songArtists = sqliteTable('song_artists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  songId: integer('song_id').references(() => songs.id, { onDelete: 'cascade' }).notNull(),
  artistId: integer('artist_id').references(() => artists.id, { onDelete: 'cascade' }).notNull(),
  position: integer('position').notNull().default(0),
}, (table) => ({
  songIdIdx: index('song_artists_song_id_idx').on(table.songId),
  artistIdIdx: index('song_artists_artist_id_idx').on(table.artistId),
}));

export const queueItems = sqliteTable('queue_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }).notNull(),
  songId: integer('song_id').references(() => songs.id, { onDelete: 'cascade' }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }), // null if queued by karaoke guest
  guestName: text('guest_name'),
  controllerId: text('controller_id').references(() => controllers.id, { onDelete: 'set null' }), // exact guest requester for queue-item ownership
  addedAt: integer('added_at', { mode: 'timestamp' }).notNull(),
  position: integer('position').notNull(),
  status: text('status', { enum: ['pending', 'playing', 'finished'] }).notNull().default('pending'),
  tempTitle: text('temp_title'),
  tempArtist: text('temp_artist'),
  tempArtworkUrl: text('temp_artwork_url'),
  downloadJobId: text('download_job_id'),
  downloadTrackId: text('download_track_id'),
  downloadStatus: text('download_status'), // 'downloading', 'ready', 'failed'
}, (table) => ({
  sessionIdx: index('queue_items_session_id_idx').on(table.sessionId),
  songIdx: index('queue_items_song_id_idx').on(table.songId),
}));

export const playlists = sqliteTable('playlists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  isPublic: integer('is_public').notNull().default(0), // 0 = private (default), 1 = public
  coverPath: text('cover_path'),
  sourceType: text('source_type'),
  sourceId: text('source_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const playlistSongs = sqliteTable('playlist_songs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  playlistId: integer('playlist_id').references(() => playlists.id, { onDelete: 'cascade' }).notNull(),
  songId: integer('song_id').references(() => songs.id, { onDelete: 'cascade' }).notNull(),
  position: integer('position').notNull().default(0),
  addedAt: integer('added_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  playlistIdx: index('playlist_songs_playlist_id_idx').on(table.playlistId),
  songIdx: index('playlist_songs_song_id_idx').on(table.songId),
}));

export const playlistShares = sqliteTable('playlist_shares', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  playlistId: integer('playlist_id').references(() => playlists.id, { onDelete: 'cascade' }).notNull(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  permission: text('permission', { enum: ['view', 'edit'] }).notNull().default('view'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  userPlaylistUnique: uniqueIndex('playlist_shares_user_id_playlist_id_idx').on(table.userId, table.playlistId),
}));

export const favorites = sqliteTable('favorites', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  songId: integer('song_id').references(() => songs.id, { onDelete: 'cascade' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  userSongUnique: uniqueIndex('favorites_user_id_song_id_idx').on(table.userId, table.songId),
}));

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const downloadJobs = sqliteTable('download_jobs', {
  id: text('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  playlistName: text('playlist_name'),
  playlistId: integer('playlist_id').references(() => playlists.id, { onDelete: 'set null' }),
  type: text('type').notNull().default('playlist'),
  status: text('status', { enum: ['queued', 'downloading', 'completed', 'failed', 'cancelled'] }).notNull().default('queued'),
  libraryId: integer('library_id').references(() => libraries.id, { onDelete: 'cascade' }),
  libraryPath: text('library_path').notNull(),
  format: text('format').notNull().default('mp3'),
  quality: text('quality').notNull().default('320k'),
  embedMetadata: integer('embed_metadata').notNull().default(1),
  embedArtwork: integer('embed_artwork').notNull().default(1),
  downloadLyrics: integer('download_lyrics').notNull().default(1),
  lyricsProviders: text('lyrics_providers'),
  folderStructure: text('folder_structure').notNull().default('artist/album'),
  playlistFolder: integer('playlist_folder').notNull().default(0),
  totalCount: integer('total_count').notNull().default(0),
  completedCount: integer('completed_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  userIdIdx: index('download_jobs_user_id_idx').on(table.userId),
}));

export const downloadTrackJobs = sqliteTable('download_track_jobs', {
  id: text('id').primaryKey(),
  jobId: text('job_id').references(() => downloadJobs.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').notNull(),
  artist: text('artist').notNull(),
  album: text('album').notNull().default(''),
  trackNumber: integer('track_number'),
  discNumber: integer('disc_number'),
  releaseYear: integer('release_year'),
  duration: integer('duration'),
  artworkUrl: text('artwork_url'),
  sourceUrl: text('source_url'),
  status: text('status', { enum: ['queued', 'searching', 'downloading', 'tagging', 'completed', 'failed'] }).notNull().default('queued'),
  progress: integer('progress').notNull().default(0),
  retryCount: integer('retry_count').notNull().default(0),
  error: text('error'),
  outputPath: text('output_path'),
  position: integer('position').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  jobIdIdx: index('download_track_jobs_job_id_idx').on(table.jobId),
}));

export const songVerifiedSources = sqliteTable('song_verified_sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  songId: integer('song_id').references(() => songs.id, { onDelete: 'cascade' }).notNull().unique(),
  youtubeUrl: text('youtube_url').notNull(),
  videoId: text('video_id'),
  sourceTitle: text('source_title'),
  sourceArtist: text('source_artist'),
  verified: integer('verified').notNull().default(1),
  verifiedAt: integer('verified_at', { mode: 'timestamp' }).notNull(),
  processedAt: integer('processed_at', { mode: 'timestamp' }),
});


