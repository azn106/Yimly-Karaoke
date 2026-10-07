import { db } from '../db/index.js';
import { artists, songs, songArtists, albums, lyrics } from '../db/schema.js';
import { eq, sql, and, like, isNull, isNotNull, inArray } from 'drizzle-orm';

/**
 * Splits and normalizes multiple artists from metadata or raw strings.
 * Rules:
 * - Separates artists on semicolons (;)
 * - Does NOT split on commas (commas can legitimately be in artist names)
 * - Does NOT split on & unless part of multi-artist tags
 * - Trims whitespace around each parsed artist
 * - Ignores empty values
 * - Deduplicates case-insensitively while preserving original capitalizations
 */
export function parseArtists(rawArtist?: string | null, rawArtists?: (string | null | undefined)[] | null): string[] {
  const result: string[] = [];
  const seenLower = new Set<string>();

  const processChunk = (chunk: string) => {
    if (!chunk) return;
    // Split on semicolons ;
    const parts = chunk.split(';');
    for (let part of parts) {
      part = part.trim();
      if (!part) continue;
      const lower = part.toLowerCase();
      if (!seenLower.has(lower)) {
        seenLower.add(lower);
        result.push(part);
      }
    }
  };

  if (rawArtists && Array.isArray(rawArtists)) {
    for (const a of rawArtists) {
      if (typeof a === 'string') {
        processChunk(a);
      }
    }
  }

  if (rawArtist && typeof rawArtist === 'string') {
    processChunk(rawArtist);
  }

  if (result.length === 0) {
    result.push('Unknown Artist');
  }

  return result;
}

/**
 * Formats a list of artist objects or names for display (e.g. "Andrea Bocelli · Matteo Bocelli")
 */
export function formatArtistDisplay(artistList: Array<{ name: string } | string> | string | undefined | null): string {
  if (!artistList) return 'Unknown Artist';
  if (typeof artistList === 'string') {
    const parsed = parseArtists(artistList);
    return parsed.join(' · ');
  }
  if (Array.isArray(artistList)) {
    const names = artistList
      .map(a => (typeof a === 'string' ? a : a.name))
      .map(n => n.trim())
      .filter(Boolean);
    if (names.length === 0) return 'Unknown Artist';
    return names.join(' · ');
  }
  return 'Unknown Artist';
}

/**
 * Finds an existing artist by case-insensitive name, or creates a new artist record.
 * Avoids duplicate artist records caused by case or leading/trailing whitespace differences.
 */
export async function getOrCreateArtist(artistName: string, artworkPath?: string | null): Promise<number> {
  const trimmed = artistName.trim();
  if (!trimmed) {
    return getOrCreateArtist('Unknown Artist', artworkPath);
  }

  // Case-insensitive lookup
  const existing = await db.select()
    .from(artists)
    .where(sql`LOWER(TRIM(${artists.name})) = LOWER(TRIM(${trimmed}))`)
    .limit(1);

  if (existing.length > 0) {
    const found = existing[0];
    if (artworkPath && !found.artworkPath) {
      await db.update(artists)
        .set({ artworkPath })
        .where(eq(artists.id, found.id));
    }
    return found.id;
  }

  // Insert new artist
  const inserted = await db.insert(artists).values({
    name: trimmed,
    artworkPath: artworkPath || null,
  }).returning();

  return inserted[0].id;
}

/**
 * Links a song to multiple artists in song_artists table, maintaining position.
 * Also cleans up previous links for this song.
 */
export async function syncSongArtists(songId: number, artistIds: number[]): Promise<void> {
  if (artistIds.length === 0) return;

  // Clear existing song_artists entries for this song
  await db.delete(songArtists).where(eq(songArtists.songId, songId));

  // Insert new entries
  for (let i = 0; i < artistIds.length; i++) {
    await db.insert(songArtists).values({
      songId,
      artistId: artistIds[i],
      position: i,
    });
  }
}

/**
 * Backfills / normalizes any existing database records containing semicolon-separated artists.
 * 1. Finds any artist records whose name contains ';'
 * 2. Splits them into individual artist records (getOrCreateArtist)
 * 3. Re-links all songs to the individual artists in song_artists and updates songs.artistId to primary artist
 * 4. Deletes obsolete semicolon artist records
 * 5. Ensures all songs have at least one record in song_artists
 */
export async function normalizeMultiArtistsInDatabase(): Promise<void> {
  try {
    // 1. Find all artists with semicolons in name
    const semicolonArtists = await db.select()
      .from(artists)
      .where(like(artists.name, '%;%'));

    for (const legacyArtist of semicolonArtists) {
      const parsedNames = parseArtists(legacyArtist.name);
      if (parsedNames.length === 0) continue;

      const newArtistIds: number[] = [];
      for (const name of parsedNames) {
        const id = await getOrCreateArtist(name, legacyArtist.artworkPath);
        newArtistIds.push(id);
      }

      const primaryArtistId = newArtistIds[0];

      // Find all songs linked to this legacy artist
      const linkedSongs = await db.select().from(songs).where(eq(songs.artistId, legacyArtist.id));
      for (const song of linkedSongs) {
        // Update song primary artist
        await db.update(songs)
          .set({ artistId: primaryArtistId })
          .where(eq(songs.id, song.id));

        // Sync many-to-many relationship
        await syncSongArtists(song.id, newArtistIds);
      }

      // Find any albums linked to this legacy artist
      const linkedAlbums = await db.select().from(albums).where(eq(albums.artistId, legacyArtist.id));
      for (const album of linkedAlbums) {
        await db.update(albums)
          .set({ artistId: primaryArtistId })
          .where(eq(albums.id, album.id));
      }

      // Delete the obsolete semicolon artist record
      await db.delete(artists).where(eq(artists.id, legacyArtist.id));
    }

    // 2. Ensure every song in the database has corresponding song_artists records
    const allDbSongs = await db.select({ id: songs.id, artistId: songs.artistId }).from(songs);
    for (const s of allDbSongs) {
      const existingLinks = await db.select()
        .from(songArtists)
        .where(eq(songArtists.songId, s.id))
        .limit(1);

      if (existingLinks.length === 0 && s.artistId) {
        await db.insert(songArtists).values({
          songId: s.id,
          artistId: s.artistId,
          position: 0,
        });
      }
    }
  } catch (error) {
    console.error('Error normalizing multi-artists in database:', error);
  }
}

/**
 * Cleans up orphaned albums, artists, and song_artists relationships from the database.
 *
 * Rules:
 * 1. Remove song_artists rows referencing non-existent songs or non-existent artists.
 * 2. Remove lyrics rows referencing non-existent songs.
 * 3. Remove album records that have 0 associated songs.
 * 4. Remove artist records that have 0 associated songs (neither as primary artist in songs nor in song_artists)
 *    and no remaining albums.
 */
export async function cleanupOrphanedRecords(): Promise<{
  deletedSongArtists: number;
  deletedAlbums: number;
  deletedArtists: number;
}> {
  try {
    // 1. Get all active song IDs and artist IDs
    const allSongRows = await db.select({ id: songs.id }).from(songs);
    const activeSongIds = new Set(allSongRows.map(s => s.id));

    const allArtistRows = await db.select({ id: artists.id }).from(artists);
    const activeArtistIds = new Set(allArtistRows.map(a => a.id));

    // Delete orphaned song_artists where songId or artistId no longer exist
    const allSongArtists = await db.select().from(songArtists);
    for (const sa of allSongArtists) {
      if (!activeSongIds.has(sa.songId) || !activeArtistIds.has(sa.artistId)) {
        await db.delete(songArtists).where(eq(songArtists.id, sa.id));
      }
    }

    // Delete orphaned lyrics where songId no longer exists
    const allLyrics = await db.select().from(lyrics);
    for (const lyr of allLyrics) {
      if (!activeSongIds.has(lyr.songId)) {
        await db.delete(lyrics).where(eq(lyrics.id, lyr.id));
      }
    }

    // 2. Find albums with 1+ songs
    const songsWithAlbum = await db.select({ albumId: songs.albumId }).from(songs).where(isNotNull(songs.albumId));
    const activeAlbumIdsWithSongs = new Set(songsWithAlbum.map(s => s.albumId!).filter(Boolean));

    // Delete albums that have 0 associated songs
    const allAlbums = await db.select().from(albums);
    for (const alb of allAlbums) {
      if (!activeAlbumIdsWithSongs.has(alb.id)) {
        await db.delete(albums).where(eq(albums.id, alb.id));
      }
    }

    // 3. Find artists associated with remaining albums
    const remainingAlbums = await db.select({ artistId: albums.artistId }).from(albums);
    const activeArtistIdsWithAlbums = new Set(remainingAlbums.map(a => a.artistId));

    // Find artists associated with songs (either as primary artist in songs or in song_artists)
    const songsPrimaryArtist = await db.select({ artistId: songs.artistId }).from(songs);
    const activeArtistIdsWithSongs = new Set(songsPrimaryArtist.map(s => s.artistId));

    const secondarySongArtists = await db.select({ artistId: songArtists.artistId }).from(songArtists);
    for (const sa of secondarySongArtists) {
      activeArtistIdsWithSongs.add(sa.artistId);
    }

    // Delete artists that have 0 associated songs AND 0 remaining albums
    for (const art of allArtistRows) {
      if (!activeArtistIdsWithSongs.has(art.id) && !activeArtistIdsWithAlbums.has(art.id)) {
        await db.delete(artists).where(eq(artists.id, art.id));
      }
    }

    return {
      deletedSongArtists: 0,
      deletedAlbums: 0,
      deletedArtists: 0,
    };
  } catch (error) {
    console.error('Error during cleanupOrphanedRecords:', error);
    throw error;
  }
}

