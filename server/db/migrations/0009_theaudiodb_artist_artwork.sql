ALTER TABLE `artists` ADD COLUMN `artwork_source` text;
--> statement-breakpoint
ALTER TABLE `artists` ADD COLUMN `artwork_source_url` text;
--> statement-breakpoint
ALTER TABLE `artists` ADD COLUMN `artwork_verified` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `artists` ADD COLUMN `musicbrainz_id` text;
