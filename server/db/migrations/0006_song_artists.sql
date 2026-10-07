CREATE TABLE IF NOT EXISTS `song_artists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`song_id` integer NOT NULL,
	`artist_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `song_artists_song_id_idx` ON `song_artists` (`song_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `song_artists_artist_id_idx` ON `song_artists` (`artist_id`);
