import { Router } from 'express';
import { db } from '../db/index.js';
import { albums, artists, songs, lyrics } from '../db/schema.js';
import { eq, sql, isNotNull, and, inArray } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { formatArtistDisplay } from '../lib/artist-utils.js';
import { getSongArtistsMap } from './songs.js';
import fs from 'fs';
import path from 'path';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const allAlbums = await db.select({
      id: albums.id,
      title: albums.title,
      year: albums.year,
      artworkPath: albums.artworkPath,
      artistId: albums.artistId,
      artist: artists.name,
      songCount: sql<number>`(select count(*) from songs where songs.album_id = albums.id)`,
    })
    .from(albums)
    .leftJoin(artists, eq(albums.artistId, artists.id));

    const formatted = allAlbums.map(a => ({
      ...a,
      hasArtwork: !!a.artworkPath,
    }));

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch albums' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const albumId = parseInt(req.params.id);
    if (isNaN(albumId)) return res.status(400).json({ error: 'Invalid album ID' });

    const albumRec = await db.select({
      id: albums.id,
      title: albums.title,
      year: albums.year,
      artworkPath: albums.artworkPath,
      artistId: albums.artistId,
      artist: artists.name,
    })
    .from(albums)
    .leftJoin(artists, eq(albums.artistId, artists.id))
    .where(eq(albums.id, albumId))
    .limit(1);

    if (albumRec.length === 0) return res.status(404).json({ error: 'Album not found' });

    const albumSongs = await db.select({
      id: songs.id,
      title: songs.title,
      artistId: songs.artistId,
      trackNumber: songs.trackNumber,
      discNumber: songs.discNumber,
      duration: songs.duration,
      variant: songs.variant,
      artworkPath: songs.artworkPath,
    })
    .from(songs)
    .where(eq(songs.albumId, albumId));

    const songIds = albumSongs.map(s => s.id);
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

    res.json({
      ...albumRec[0],
      hasArtwork: !!albumRec[0].artworkPath,
      songs: albumSongs.map(s => {
        const trackArtists = artistsMap.get(s.id) || (albumRec[0].artist ? [{ id: albumRec[0].artistId, name: albumRec[0].artist }] : []);
        const lyr = lyricsMap.get(s.id) || { hasLrc: false, hasElrc: false };
        return {
          ...s,
          artist: formatArtistDisplay(trackArtists),
          artists: trackArtists,
          hasArtwork: !!s.artworkPath || !!albumRec[0].artworkPath,
          hasLrc: lyr.hasLrc,
          hasElrc: lyr.hasElrc,
        };
      }),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch album details' });
  }
});

router.get('/:id/artwork', async (req, res) => {
  try {
    const albumId = parseInt(req.params.id);
    if (isNaN(albumId)) return res.status(400).json({ error: 'Invalid album ID' });

    const album = await db.select({
      artworkPath: albums.artworkPath,
    }).from(albums).where(eq(albums.id, albumId)).limit(1);

    if (album.length === 0) return res.status(404).json({ error: 'Album not found' });

    let artworkFilename = album[0].artworkPath;

    // Fallback: Check any song inside this album with artwork
    if (!artworkFilename) {
      const songWithArt = await db.select({ artworkPath: songs.artworkPath })
        .from(songs)
        .where(and(eq(songs.albumId, albumId), isNotNull(songs.artworkPath)))
        .limit(1);
      if (songWithArt.length > 0 && songWithArt[0].artworkPath) {
        artworkFilename = songWithArt[0].artworkPath;
      }
    }

    if (!artworkFilename) {
      return res.status(404).json({ error: 'No embedded artwork found for this album' });
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
    res.status(500).json({ error: 'Failed to serve album artwork' });
  }
});

export default router;
