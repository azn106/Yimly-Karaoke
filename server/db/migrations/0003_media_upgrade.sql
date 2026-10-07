ALTER TABLE `artists` ADD COLUMN `artwork_path` text;
--> statement-breakpoint
ALTER TABLE `albums` ADD COLUMN `year` integer;
--> statement-breakpoint
ALTER TABLE `albums` ADD COLUMN `artwork_path` text;
--> statement-breakpoint
ALTER TABLE `songs` ADD COLUMN `track_number` integer;
--> statement-breakpoint
ALTER TABLE `songs` ADD COLUMN `disc_number` integer;
--> statement-breakpoint
ALTER TABLE `songs` ADD COLUMN `genre` text;
--> statement-breakpoint
ALTER TABLE `songs` ADD COLUMN `year` integer;
--> statement-breakpoint
ALTER TABLE `songs` ADD COLUMN `variant` text DEFAULT 'original' NOT NULL;
--> statement-breakpoint
ALTER TABLE `songs` ADD COLUMN `file_size` integer;
--> statement-breakpoint
ALTER TABLE `songs` ADD COLUMN `format` text;
