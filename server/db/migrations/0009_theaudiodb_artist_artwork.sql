-- Migration: 0009_theaudiodb_artist_artwork
ALTER TABLE artists ADD COLUMN musicbrainz_id text;
ALTER TABLE artists ADD COLUMN artwork_source text;
ALTER TABLE artists ADD COLUMN artwork_source_url text;
ALTER TABLE artists ADD COLUMN artwork_verified integer DEFAULT 0;
