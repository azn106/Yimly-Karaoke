import { Router } from 'express';
import { db } from '../db/index.js';
import { artists, albums, songs, songArtists, lyrics } from '../db/schema.js';
import { eq, like, or, inArray } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { formatArtistDisplay } from '../lib/artist-utils.js';
import { getSongArtistsMap } from './songs.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const q = req.query.q as string;
    if (!q) return res.json([]);

    const searchStr = `%${q}%`;

    // Find song IDs where any linked artist matches search
    const matchingArtistSongIds = await db.select({ songId: songArtists.songId })
      .from(songArtists)
      .innerJoin(artists, eq(songArtists.artistId, artists.id))
      .where(like(artists.name, searchStr));

    const songIdsFromArtists = matchingArtistSongIds.map(r => r.songId);

    const foundSongs = await db.select({
      id: songs.id,
      title: songs.title,
      artist: artists.name,
      artistId: songs.artistId,
      album: albums.title,
      artworkPath: songs.artworkPath,
      albumArtworkPath: albums.artworkPath,
    })
    .from(songs)
    .leftJoin(artists, eq(songs.artistId, artists.id))
    .leftJoin(albums, eq(songs.albumId, albums.id))
    .where(
      or(
        like(songs.title, searchStr),
        like(artists.name, searchStr),
        like(songs.mainAudioPath, searchStr),
        songIdsFromArtists.length > 0 ? inArray(songs.id, songIdsFromArtists) : undefined
      )
    )
    .limit(15);

    const songIds = foundSongs.map(s => s.id);
    const artistsMap = await getSongArtistsMap(songIds);

    const lyricsList = songIds.length > 0
      ? await db.select({ songId: lyrics.songId, lrcPath: lyrics.lrcPath, elrcPath: lyrics.elrcPath }).from(lyrics).where(inArray(lyrics.songId, songIds))
      : [];
    const lyricsMap = new Map<number, { hasLrc: boolean; hasElrc: boolean }>();
    for (const l of lyricsList) {
      const prev = lyricsMap.get(l.songId) || { hasLrc: false, hasElrc: false };
      lyricsMap.set(l.songId, {
        hasLrc: prev.hasLrc || (!!l.lrcPath && l.lrcPath.trim().length > 0),
        hasElrc: prev.hasElrc || (!!l.elrcPath && l.elrcPath.trim().length > 0)
      });
    }

    const foundArtists = await db.select({
      id: artists.id,
      name: artists.name,
      artworkPath: artists.artworkPath,
    })
    .from(artists)
    .where(like(artists.name, searchStr))
    .limit(10);

    const foundAlbums = await db.select({
      id: albums.id,
      title: albums.title,
      artist: artists.name,
      artworkPath: albums.artworkPath,
    })
    .from(albums)
    .leftJoin(artists, eq(albums.artistId, artists.id))
    .where(like(albums.title, searchStr))
    .limit(10);

    res.json([
      ...foundArtists.map(a => ({ type: 'artist', hasArtwork: !!a.artworkPath, ...a })),
      ...foundAlbums.map(al => ({ type: 'album', hasArtwork: !!al.artworkPath, ...al })),
      ...foundSongs.map(s => {
        const trackArtists = artistsMap.get(s.id) || (s.artist ? [{ id: s.artistId, name: s.artist }] : []);
        const lyr = lyricsMap.get(s.id) || { hasLrc: false, hasElrc: false };
        return {
          type: 'song',
          ...s,
          artist: formatArtistDisplay(trackArtists.length > 0 ? trackArtists : s.artist),
          artists: trackArtists,
          hasArtwork: !!s.artworkPath || !!s.albumArtworkPath,
          hasLrc: lyr.hasLrc,
          hasElrc: lyr.hasElrc,
        };
      }),
    ]);
  } catch (error) {
    res.status(500).json({ error: 'Global search failed' });
  }
});

export default router;
