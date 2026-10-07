import { Router } from 'express';
import { db } from '../db/index.js';
import { artists, albums, songs, lyrics, songArtists } from '../db/schema.js';
import { eq, sql, isNotNull, and, or, inArray } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { formatArtistDisplay } from '../lib/artist-utils.js';
import { getSongArtistsMap } from './songs.js';
import fs from 'fs';
import path from 'path';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const allArtists = await db.select({
      id: artists.id,
      name: artists.name,
      artworkPath: artists.artworkPath,
      songCount: sql<number>`(
        select count(distinct s.id) from songs s 
        left join song_artists sa on sa.song_id = s.id 
        where s.artist_id = artists.id or sa.artist_id = artists.id
      )`,
      albumCount: sql<number>`(select count(*) from albums where albums.artist_id = artists.id)`,
    }).from(artists);

    const formatted = allArtists.map(a => ({
      ...a,
      hasArtwork: !!a.artworkPath,
    }));

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch artists' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const artistId = parseInt(req.params.id);
    if (isNaN(artistId)) return res.status(400).json({ error: 'Invalid artist ID' });

    const artistRec = await db.select().from(artists).where(eq(artists.id, artistId)).limit(1);
    if (artistRec.length === 0) return res.status(404).json({ error: 'Artist not found' });

    const artistAlbums = await db.select().from(albums).where(eq(albums.artistId, artistId));

    // Get all songs associated with this artist either directly or via song_artists
    const songIdRecords = await db.select({ songId: songArtists.songId })
      .from(songArtists)
      .where(eq(songArtists.artistId, artistId));

    const songIdsFromJoin = songIdRecords.map(r => r.songId);

    const artistSongs = await db.select({
      id: songs.id,
      title: songs.title,
      artistId: songs.artistId,
      albumId: songs.albumId,
      duration: songs.duration,
      variant: songs.variant,
      artworkPath: songs.artworkPath,
    })
    .from(songs)
    .where(
      or(
        eq(songs.artistId, artistId),
        songIdsFromJoin.length > 0 ? inArray(songs.id, songIdsFromJoin) : undefined
      )
    );

    // Deduplicate songs by id (in case an artist is both direct artistId and in songArtists)
    const uniqueSongsMap = new Map<number, typeof artistSongs[0]>();
    for (const s of artistSongs) {
      if (!uniqueSongsMap.has(s.id)) {
        uniqueSongsMap.set(s.id, s);
      }
    }
    const uniqueSongs = Array.from(uniqueSongsMap.values());
    const allSongIds = uniqueSongs.map(s => s.id);
    const artistsMap = await getSongArtistsMap(allSongIds);

    const lyricsList = allSongIds.length > 0
      ? await db.select({ songId: lyrics.songId, lrcPath: lyrics.lrcPath, elrcPath: lyrics.elrcPath }).from(lyrics).where(inArray(lyrics.songId, allSongIds))
      : [];
    const lyricsMap = new Map<number, { hasLrc: boolean; hasElrc: boolean }>();
    for (const l of lyricsList) {
      const prev = lyricsMap.get(l.songId) || { hasLrc: false, hasElrc: false };
      lyricsMap.set(l.songId, {
        hasLrc: prev.hasLrc || (!!l.lrcPath && l.lrcPath.trim().length > 0),
        hasElrc: prev.hasElrc || (!!l.elrcPath && l.elrcPath.trim().length > 0)
      });
    }

    res.json({
      ...artistRec[0],
      hasArtwork: !!artistRec[0].artworkPath,
      albums: artistAlbums.map(alb => ({
        ...alb,
        hasArtwork: !!alb.artworkPath,
      })),
      songs: uniqueSongs.map(s => {
        const trackArtists = artistsMap.get(s.id) || [{ id: artistRec[0].id, name: artistRec[0].name }];
        const lyr = lyricsMap.get(s.id) || { hasLrc: false, hasElrc: false };
        return {
          ...s,
          artist: formatArtistDisplay(trackArtists),
          artists: trackArtists,
          hasArtwork: !!s.artworkPath || !!artistRec[0].artworkPath,
          hasLrc: lyr.hasLrc,
          hasElrc: lyr.hasElrc,
        };
      }),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch artist details' });
  }
});

router.get('/:id/artwork', async (req, res) => {
  try {
    const artistId = parseInt(req.params.id);
    if (isNaN(artistId)) return res.status(400).json({ error: 'Invalid artist ID' });

    const artist = await db.select({
      artworkPath: artists.artworkPath,
    }).from(artists).where(eq(artists.id, artistId)).limit(1);

    if (artist.length === 0) return res.status(404).json({ error: 'Artist not found' });

    let artworkFilename = artist[0].artworkPath;

    // Fallback: Check any album or song by this artist that has artwork
    if (!artworkFilename) {
      const albumWithArt = await db.select({ artworkPath: albums.artworkPath })
        .from(albums)
        .where(and(eq(albums.artistId, artistId), isNotNull(albums.artworkPath)))
        .limit(1);
      if (albumWithArt.length > 0 && albumWithArt[0].artworkPath) {
        artworkFilename = albumWithArt[0].artworkPath;
      }
    }

    if (!artworkFilename) {
      // Check via song_artists
      const songArtistArt = await db.select({ artworkPath: songs.artworkPath })
        .from(songArtists)
        .innerJoin(songs, eq(songArtists.songId, songs.id))
        .where(and(eq(songArtists.artistId, artistId), isNotNull(songs.artworkPath)))
        .limit(1);
      if (songArtistArt.length > 0 && songArtistArt[0].artworkPath) {
        artworkFilename = songArtistArt[0].artworkPath;
      }
    }

    if (!artworkFilename) {
      const songWithArt = await db.select({ artworkPath: songs.artworkPath })
        .from(songs)
        .where(and(eq(songs.artistId, artistId), isNotNull(songs.artworkPath)))
        .limit(1);
      if (songWithArt.length > 0 && songWithArt[0].artworkPath) {
        artworkFilename = songWithArt[0].artworkPath;
      }
    }

    if (!artworkFilename) {
      return res.status(404).json({ error: 'No embedded artwork found for this artist' });
    }

    const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');
    const safeFilename = path.basename(artworkFilename);
    const filePath = path.join(dataDir, 'artwork', safeFilename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Cached artwork file not found on disk' });
    }

    const ext = path.extname(safeFilename).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.sendFile(filePath);
  } catch (error) {
    res.status(500).json({ error: 'Failed to serve artist artwork' });
  }
});

export default router;
