import { Router } from 'express';
import { db } from '../db/index.js';
import { artists, albums, songs, lyrics, songArtists, libraries } from '../db/schema.js';
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
          hasArtwork: !!s.artworkPath,
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

    // Artist portraits can change during refresh; never let a browser/shared cache keep a stale copy.
    res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');

    const artworkFilename = artist[0].artworkPath;

    // Do NOT fall back to album or song artwork; artist portraits are dedicated images
    if (!artworkFilename) {
      return res.status(404).json({ error: 'No artist portrait found for this artist' });
    }

    const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');
    let filePath: string;

    if (path.isAbsolute(artworkFilename)) {
      filePath = path.resolve(artworkFilename);
      const isInDataDir = filePath.startsWith(dataDir + path.sep);
      const allLibs = await db.select({ path: libraries.path }).from(libraries);
      const isInLibrary = allLibs.some(l => l.path && filePath.startsWith(path.resolve(l.path) + path.sep));
      if (!isInDataDir && !isInLibrary) {
        return res.status(403).json({ error: 'Access denied to artwork path' });
      }
    } else {
      const safeFilename = path.basename(artworkFilename);
      filePath = path.join(dataDir, 'artwork', safeFilename);
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Cached artwork file not found on disk' });
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';

    res.setHeader('Content-Type', contentType);
    res.sendFile(filePath);
  } catch (error) {
    res.status(500).json({ error: 'Failed to serve artist artwork' });
  }
});

// Refresh individual artist profile image
router.post('/:id/refresh', async (req, res) => {
  try {
    const artistId = parseInt(req.params.id);
    if (isNaN(artistId)) return res.status(400).json({ error: 'Invalid artist ID' });

    const { refreshArtistProfileImage } = await import('../lib/artist-image-refresher.js');
    const selectedMusicBrainzId = typeof req.body?.musicbrainzId === 'string' && req.body.musicbrainzId.trim()
      ? req.body.musicbrainzId.trim()
      : undefined;
    const forceArtistChoice = req.query.chooseArtist === 'true' || req.query.forceSearch === 'true';
    const result = await refreshArtistProfileImage(artistId, selectedMusicBrainzId, forceArtistChoice);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to refresh artist image' });
  }
});

// Search MusicBrainz candidates for an artist
router.get('/:id/musicbrainz/search', async (req, res) => {
  try {
    const artistId = parseInt(req.params.id);
    if (isNaN(artistId)) return res.status(400).json({ error: 'Invalid artist ID' });

    const artist = await db.select().from(artists).where(eq(artists.id, artistId)).limit(1);
    if (artist.length === 0) return res.status(404).json({ error: 'Artist not found' });

    const query = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : artist[0].name;
    const { searchMusicBrainzArtists } = await import('../lib/artist-image-refresher.js');
    const candidates = await searchMusicBrainzArtists(query);
    res.json({ artistId, query, candidates });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to search MusicBrainz' });
  }
});

// Manually update/validate MusicBrainz ID for an artist
router.put('/:id/musicbrainz', async (req, res) => {
  try {
    const artistId = parseInt(req.params.id);
    if (isNaN(artistId)) return res.status(400).json({ error: 'Invalid artist ID' });

    const { musicbrainzId } = req.body;
    if (!musicbrainzId || typeof musicbrainzId !== 'string') {
      return res.status(400).json({ error: 'Missing musicbrainzId' });
    }

    const artist = await db.select().from(artists).where(eq(artists.id, artistId)).limit(1);
    if (artist.length === 0) return res.status(404).json({ error: 'Artist not found' });

    const { validateMusicBrainzArtistId } = await import('../lib/artist-image-refresher.js');
    const validation = await validateMusicBrainzArtistId(musicbrainzId.trim());
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error || 'Invalid MusicBrainz ID' });
    }

    await db.update(artists)
      .set({ musicbrainzId: musicbrainzId.trim() })
      .where(eq(artists.id, artistId));

    res.json({
      success: true,
      artistId,
      musicbrainzId: musicbrainzId.trim(),
      artist: validation.artist,
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to update MusicBrainz ID' });
  }
});

// Refresh all artist profile images
router.post('/refresh-all', async (req, res) => {
  try {
    const { refreshAllArtists } = await import('../lib/artist-image-refresher.js');
    const summary = await refreshAllArtists();
    res.json(summary);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to refresh all artist images' });
  }
});

// Cancel bulk artist refresh
router.post('/refresh-cancel', async (req, res) => {
  try {
    const { cancelBulkRefresh } = await import('../lib/artist-image-refresher.js');
    cancelBulkRefresh();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to cancel refresh' });
  }
});

export default router;

