CREATE TABLE IF NOT EXISTS `download_jobs` (
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
CREATE TABLE IF NOT EXISTS `download_track_jobs` (
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
CREATE TABLE IF NOT EXISTS `favorites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`song_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `favorites_user_id_song_id_idx` ON `favorites` (`user_id`,`song_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `playlist_shares` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`playlist_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`permission` text DEFAULT 'view' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `playlist_shares_user_id_playlist_id_idx` ON `playlist_shares` (`user_id`,`playlist_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `playlist_songs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`playlist_id` integer NOT NULL,
	`song_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`added_at` integer NOT NULL,
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `playlists` (
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
CREATE TABLE IF NOT EXISTS `song_artists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`song_id` integer NOT NULL,
	`artist_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `songs_title_idx` ON `songs` (`title`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `songs_artist_id_idx` ON `songs` (`artist_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `songs_album_id_idx` ON `songs` (`album_id`);