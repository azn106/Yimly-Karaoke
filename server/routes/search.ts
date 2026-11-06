import { Router } from 'express';
import { db } from '../db/index.js';
import { artists, albums, songs, songArtists, lyrics } from '../db/schema.js';
import { eq, like, or, inArray, asc, sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { formatArtistDisplay } from '../lib/artist-utils.js';
import { getSongArtistsMap } from './songs.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
    if (!query) return res.json([]);

    const escapedQuery = query.replace(/([%_\\])/g, '\\$1');
    const searchStr = `%${escapedQuery}%`;

    // Match artists first so an artist search can expand to their complete catalogue,
    // including songs where they are a featured/secondary artist.
    const matchingArtists = await db.select({
      id: artists.id,
      name: artists.name,
      artworkPath: artists.artworkPath,
    }).from(artists).where(sql`${artists.name} LIKE ${searchStr} ESCAPE '\\'`);
    const matchingArtistIds = matchingArtists.map(artist => artist.id);

    // An artist match includes all of that artist's albums, not just albums whose
    // own title happens to contain the search term.
    const matchingAlbums = await db.select({
      id: albums.id,
      title: albums.title,
      artistId: albums.artistId,
      artist: artists.name,
      artworkPath: albums.artworkPath,
    }).from(albums)
      .leftJoin(artists, eq(albums.artistId, artists.id))
      .where(or(
        sql`${albums.title} LIKE ${searchStr} ESCAPE '\\'`,
        ...(matchingArtistIds.length ? [inArray(albums.artistId, matchingArtistIds)] : [])
      ));

    const matchingAlbumIds = matchingAlbums.map(album => album.id);

    // Song matches include title, primary/featured artist, album title, and every
    // track belonging to an album or artist matched above.
    const linkedArtistMatches = await db.select({ songId: songArtists.songId })
      .from(songArtists)
      .innerJoin(artists, eq(songArtists.artistId, artists.id))
      .where(sql`${artists.name} LIKE ${searchStr} ESCAPE '\\'`);
    const linkedSongIds = [...new Set(linkedArtistMatches.map(row => row.songId))];

    const songConditions = [
      sql`${songs.title} LIKE ${searchStr} ESCAPE '\\'`,
      sql`${artists.name} LIKE ${searchStr} ESCAPE '\\'`,
      sql`${albums.title} LIKE ${searchStr} ESCAPE '\\'`,
      ...(linkedSongIds.length ? [inArray(songs.id, linkedSongIds)] : []),
      ...(matchingArtistIds.length ? [inArray(songs.artistId, matchingArtistIds)] : []),
      ...(matchingAlbumIds.length ? [inArray(songs.albumId, matchingAlbumIds)] : []),
    ];

    const foundSongs = await db.select({
      id: songs.id,
      title: songs.title,
      artist: artists.name,
      artistId: songs.artistId,
      album: albums.title,
      albumId: songs.albumId,
      artworkPath: songs.artworkPath,
      albumArtworkPath: albums.artworkPath,
    }).from(songs)
      .leftJoin(artists, eq(songs.artistId, artists.id))
      .leftJoin(albums, eq(songs.albumId, albums.id))
      .where(or(...songConditions))
      .orderBy(asc(artists.name), asc(albums.title), asc(songs.title), asc(songs.id));

    const songIds = foundSongs.map(song => song.id);
    const artistsMap = await getSongArtistsMap(songIds);

    // Include the related artist and album cards for song-title searches as well.
    const relatedArtistIds = new Set<number>(matchingArtistIds);
    const relatedAlbumIds = new Set<number>(matchingAlbumIds);
    for (const song of foundSongs) {
      if (song.artistId) relatedArtistIds.add(song.artistId);
      if (song.albumId) relatedAlbumIds.add(song.albumId);
      for (const artist of artistsMap.get(song.id) || []) relatedArtistIds.add(artist.id);
    }

    const [relatedArtists, relatedAlbums, lyricsList] = await Promise.all([
      relatedArtistIds.size
        ? db.select({ id: artists.id, name: artists.name, artworkPath: artists.artworkPath })
            .from(artists).where(inArray(artists.id, [...relatedArtistIds])).orderBy(asc(artists.name))
        : Promise.resolve([]),
      relatedAlbumIds.size
        ? db.select({
            id: albums.id,
            title: albums.title,
            artist: artists.name,
            artworkPath: albums.artworkPath,
          }).from(albums)
            .leftJoin(artists, eq(albums.artistId, artists.id))
            .where(inArray(albums.id, [...relatedAlbumIds]))
            .orderBy(asc(albums.title), asc(albums.id))
        : Promise.resolve([]),
      songIds.length
        ? db.select({ songId: lyrics.songId, lrcPath: lyrics.lrcPath, elrcPath: lyrics.elrcPath })
            .from(lyrics).where(inArray(lyrics.songId, songIds))
        : Promise.resolve([]),
    ]);

    const lyricsMap = new Map<number, { hasLrc: boolean; hasElrc: boolean }>();
    for (const lyric of lyricsList) {
      const previous = lyricsMap.get(lyric.songId) || { hasLrc: false, hasElrc: false };
      lyricsMap.set(lyric.songId, {
        hasLrc: previous.hasLrc || !!lyric.lrcPath?.trim(),
        hasElrc: previous.hasElrc || !!lyric.elrcPath?.trim(),
      });
    }

    const artistResults = relatedArtists.map(artist => ({
      type: 'artist',
      hasArtwork: !!artist.artworkPath,
      ...artist,
    }));
    const albumResults = relatedAlbums.map(album => ({
      type: 'album',
      hasArtwork: !!album.artworkPath,
      ...album,
    }));
    const songResults = foundSongs.map(song => {
      const trackArtists = artistsMap.get(song.id) || (song.artist ? [{ id: song.artistId, name: song.artist }] : []);
      const lyric = lyricsMap.get(song.id) || { hasLrc: false, hasElrc: false };
      return {
        type: 'song',
        ...song,
        artist: formatArtistDisplay(trackArtists.length ? trackArtists : song.artist),
        artists: trackArtists,
        hasArtwork: !!song.artworkPath || !!song.albumArtworkPath,
        hasLrc: lyric.hasLrc,
        hasElrc: lyric.hasElrc,
      };
    });

    // Preserve the existing array response contract used by the Library UI.
    // No fixed per-type limits: artist and album searches must expose the full
    // related catalogue instead of silently truncating at 10/15 results.
    res.json([...artistResults, ...albumResults, ...songResults]);
  } catch (error) {
    console.error('Global search failed:', error);
    res.status(500).json({ error: 'Global search failed' });
  }
});

export default router;
