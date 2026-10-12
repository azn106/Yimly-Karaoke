CREATE TABLE `download_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`playlist_name` text,
	`type` text DEFAULT 'playlist' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`library_id` integer,
	`library_path` text NOT NULL,
	`format` text DEFAULT 'mp3' NOT NULL,
	`quality` text DEFAULT '320k' NOT NULL,
	`embed_metadata` integer DEFAULT 1 NOT NULL,
	`embed_artwork` integer DEFAULT 1 NOT NULL,
	`download_lyrics` integer DEFAULT 1 NOT NULL,
	`lyrics_providers` text,
	`folder_structure` text DEFAULT 'artist/album' NOT NULL,
	`playlist_folder` integer DEFAULT 0 NOT NULL,
	`total_count` integer DEFAULT 0 NOT NULL,
	`completed_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `download_track_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`album` text DEFAULT '' NOT NULL,
	`track_number` integer,
	`disc_number` integer,
	`release_year` integer,
	`duration` integer,
	`artwork_url` text,
	`source_url` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`error` text,
	`output_path` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `download_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `favorites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`song_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `favorites_user_id_song_id_idx` ON `favorites` (`user_id`,`song_id`);--> statement-breakpoint
CREATE TABLE `playlist_shares` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`playlist_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`permission` text DEFAULT 'view' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `playlist_shares_user_id_playlist_id_idx` ON `playlist_shares` (`user_id`,`playlist_id`);--> statement-breakpoint
CREATE TABLE `playlist_songs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`playlist_id` integer NOT NULL,
	`song_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`added_at` integer NOT NULL,
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `playlists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_public` integer DEFAULT 0 NOT NULL,
	`cover_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `song_artists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`song_id` integer NOT NULL,
	`artist_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_albums` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`artist_id` integer NOT NULL,
	`title` text NOT NULL,
	`year` integer,
	`artwork_path` text,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_albums`("id", "artist_id", "title", "year", "artwork_path") SELECT "id", "artist_id", "title", "year", "artwork_path" FROM `albums`;--> statement-breakpoint
DROP TABLE `albums`;--> statement-breakpoint
ALTER TABLE `__new_albums` RENAME TO `albums`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_controllers` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`user_id` integer,
	`guest_name` text,
	`device` text NOT NULL,
	`connection_state` text DEFAULT 'connected' NOT NULL,
	`last_seen_time` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_controllers`("id", "session_id", "user_id", "guest_name", "device", "connection_state", "last_seen_time") SELECT "id", "session_id", "user_id", "guest_name", "device", "connection_state", "last_seen_time" FROM `controllers`;--> statement-breakpoint
DROP TABLE `controllers`;--> statement-breakpoint
ALTER TABLE `__new_controllers` RENAME TO `controllers`;--> statement-breakpoint
CREATE TABLE `__new_lyrics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`song_id` integer NOT NULL,
	`lrc_path` text,
	`elrc_path` text,
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_lyrics`("id", "song_id", "lrc_path", "elrc_path") SELECT "id", "song_id", "lrc_path", "elrc_path" FROM `lyrics`;--> statement-breakpoint
DROP TABLE `lyrics`;--> statement-breakpoint
ALTER TABLE `__new_lyrics` RENAME TO `lyrics`;--> statement-breakpoint
CREATE TABLE `__new_queue_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`song_id` integer,
	`user_id` integer,
	`guest_name` text,
	`added_at` integer NOT NULL,
	`position` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`temp_title` text,
	`temp_artist` text,
	`temp_artwork_url` text,
	`download_job_id` text,
	`download_track_id` text,
	`download_status` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_queue_items`("id", "session_id", "song_id", "user_id", "guest_name", "added_at", "position", "status", "temp_title", "temp_artist", "temp_artwork_url", "download_job_id", "download_track_id", "download_status") SELECT "id", "session_id", "song_id", "user_id", "guest_name", "added_at", "position", "status", "temp_title", "temp_artist", "temp_artwork_url", "download_job_id", "download_track_id", "download_status" FROM `queue_items`;--> statement-breakpoint
DROP TABLE `queue_items`;--> statement-breakpoint
ALTER TABLE `__new_queue_items` RENAME TO `queue_items`;--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`room_code` text NOT NULL,
	`host_id` integer NOT NULL,
	`host_device` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`lyric_settings` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_sessions`("id", "room_code", "host_id", "host_device", "status", "lyric_settings", "created_at", "updated_at") SELECT "id", "room_code", "host_id", "host_device", "status", "lyric_settings", "created_at", "updated_at" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_room_code_unique` ON `sessions` (`room_code`);--> statement-breakpoint
CREATE TABLE `__new_songs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`library_id` integer NOT NULL,
	`artist_id` integer NOT NULL,
	`album_id` integer,
	`title` text NOT NULL,
	`main_audio_path` text,
	`instrumental_audio_path` text,
	`duration` integer,
	`track_number` integer,
	`disc_number` integer,
	`genre` text,
	`year` integer,
	`variant` text DEFAULT 'original' NOT NULL,
	`file_size` integer,
	`format` text,
	`artwork_path` text,
	`lrc_offset` integer DEFAULT 0 NOT NULL,
	`elrc_offset` integer DEFAULT 0 NOT NULL,
	`lyric_offset` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_songs`("id", "library_id", "artist_id", "album_id", "title", "main_audio_path", "instrumental_audio_path", "duration", "track_number", "disc_number", "genre", "year", "variant", "file_size", "format", "artwork_path", "lrc_offset", "elrc_offset", "lyric_offset") SELECT "id", "library_id", "artist_id", "album_id", "title", "main_audio_path", "instrumental_audio_path", "duration", "track_number", "disc_number", "genre", "year", "variant", "file_size", "format", "artwork_path", "lrc_offset", "elrc_offset", "lyric_offset" FROM `songs`;--> statement-breakpoint
DROP TABLE `songs`;--> statement-breakpoint
ALTER TABLE `__new_songs` RENAME TO `songs`;--> statement-breakpoint
CREATE INDEX `songs_title_idx` ON `songs` (`title`);--> statement-breakpoint
CREATE INDEX `songs_artist_id_idx` ON `songs` (`artist_id`);--> statement-breakpoint
CREATE INDEX `songs_album_id_idx` ON `songs` (`album_id`);