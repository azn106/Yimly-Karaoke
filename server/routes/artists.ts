import { Router } from 'express';
import { db } from '../db/index.js';
import { artists, albums, songs, lyrics, songArtists, libraries } from '../db/schema.js';
import { eq, sql, isNotNull, and, or, inArray, asc } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { formatArtistDisplay } from '../lib/artist-utils.js';
import { getSongArtistsMap } from './songs.js';
import fs from 'fs';
import path from 'path';

const router = Router();
router.use(requireAuth);

function hasLocalPortrait(directory: string): boolean {
  for (const filename of ['artist.jpg', 'artist.jpeg', 'artist.png', 'artist.webp', 'artist.gif']) {
    try {
      const stat = fs.statSync(path.join(directory, filename));
      if (stat.isFile() && stat.size >= 8) return true;
    } catch {
      // Continue checking supported filenames.
    }
  }
  return false;
}

function getArtistFolder(libraryPath: string, audioPath: string): string | null {
  const resolvedLibrary = path.resolve(libraryPath);
  const resolvedAudio = path.resolve(audioPath);
  if (!resolvedAudio.startsWith(resolvedLibrary + path.sep)) return null;
  const firstFolder = path.relative(resolvedLibrary, resolvedAudio).split(path.sep)[0];
  if (!firstFolder) return null;
  const directory = path.resolve(resolvedLibrary, firstFolder);
  return directory.startsWith(resolvedLibrary + path.sep) ? directory : null;
}

router.get('/', async (req, res) => {
  try {
    const paginated = req.query.limit !== undefined || req.query.offset !== undefined;
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit ?? '40'), 10) || 40));
    const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? '0'), 10) || 0);
    const totalResult = paginated ? await db.select({ total: sql<number>`count(*)` }).from(artists) : null;
    const artistQuery = db.select({
      id: artists.id,
      name: artists.name,
      artworkPath: artists.artworkPath,
      songCount: sql<number>`(
        select count(distinct s.id) from songs s
        left join song_artists sa on sa.song_id = s.id
        where s.artist_id = artists.id or sa.artist_id = artists.id
      )`,
      albumCount: sql<number>`(select count(*) from albums where albums.artist_id = artists.id)`,
    }).from(artists).orderBy(asc(artists.name));
    const allArtists = paginated ? await artistQuery.limit(limit).offset(offset) : await artistQuery;
    const pageArtistIds = allArtists.map(artist => artist.id);

    // Discover local portraits in one pass so the UI doesn't request missing images
    // individually for every artist. No external metadata or artwork services are used.
    const allLibraries = await db.select({ id: libraries.id, path: libraries.path }).from(libraries);
    const libraryPaths = new Map(allLibraries.filter(l => l.path).map(l => [l.id, path.resolve(l.path!)]));
    const foldersByArtist = new Map<number, Set<string>>();

    const primarySongs = pageArtistIds.length ? await db.select({
      artistId: songs.artistId,
      mainAudioPath: songs.mainAudioPath,
      instrumentalAudioPath: songs.instrumentalAudioPath,
      libraryId: songs.libraryId,
    }).from(songs).where(inArray(songs.artistId, pageArtistIds)) : [];

    const secondarySongs = pageArtistIds.length ? await db.select({
      artistId: songArtists.artistId,
      mainAudioPath: songs.mainAudioPath,
      instrumentalAudioPath: songs.instrumentalAudioPath,
      libraryId: songs.libraryId,
    }).from(songArtists).innerJoin(songs, eq(songArtists.songId, songs.id)).where(inArray(songArtists.artistId, pageArtistIds)) : [];

    for (const song of [...primarySongs, ...secondarySongs]) {
      const audioPath = song.mainAudioPath || song.instrumentalAudioPath;
      const libraryPath = song.libraryId ? libraryPaths.get(song.libraryId) : undefined;
      if (song.artistId == null || !audioPath || !libraryPath) continue;
      const folder = getArtistFolder(libraryPath, audioPath);
      if (!folder) continue;
      const folders = foldersByArtist.get(song.artistId) || new Set<string>();
      folders.add(folder);
      foldersByArtist.set(song.artistId, folders);
    }

    const page = allArtists.map(artist => ({
      ...artist,
      hasArtwork: [...(foldersByArtist.get(artist.id) || [])].some(hasLocalPortrait),
    }));
    res.json(paginated ? {
      artists: page,
      total: Number(totalResult?.[0]?.total || 0),
      offset,
      limit,
      hasMore: offset + page.length < Number(totalResult?.[0]?.total || 0),
    } : page);
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

    const [artist] = await db.select({ id: artists.id })
      .from(artists)
      .where(eq(artists.id, artistId))
      .limit(1);
    if (!artist) return res.status(404).json({ error: 'Artist not found' });

    // Serve portraits only from the artist's own music folder.
    const directSongs = await db.select({
      mainAudioPath: songs.mainAudioPath,
      instrumentalAudioPath: songs.instrumentalAudioPath,
      libraryId: songs.libraryId,
    }).from(songs).where(eq(songs.artistId, artistId));

    let songPaths = directSongs;
    if (songPaths.length === 0) {
      songPaths = await db.select({
        mainAudioPath: songs.mainAudioPath,
        instrumentalAudioPath: songs.instrumentalAudioPath,
        libraryId: songs.libraryId,
      }).from(songArtists)
        .innerJoin(songs, eq(songArtists.songId, songs.id))
        .where(eq(songArtists.artistId, artistId));
    }

    const allLibraries = await db.select({ id: libraries.id, path: libraries.path }).from(libraries);
    const libraryPaths = new Map(allLibraries.filter(l => l.path).map(l => [l.id, path.resolve(l.path!)]));
    const artistDirectories = new Set<string>();

    for (const song of songPaths) {
      const audioPath = song.mainAudioPath || song.instrumentalAudioPath;
      const libraryPath = song.libraryId ? libraryPaths.get(song.libraryId) : undefined;
      if (!audioPath || !libraryPath) continue;

      const resolvedAudioPath = path.resolve(audioPath);
      if (!resolvedAudioPath.startsWith(libraryPath + path.sep)) continue;
      const firstFolder = path.relative(libraryPath, resolvedAudioPath).split(path.sep)[0];
      if (!firstFolder) continue;
      const artistDirectory = path.resolve(libraryPath, firstFolder);
      if (artistDirectory.startsWith(libraryPath + path.sep)) artistDirectories.add(artistDirectory);
    }

    const candidates = ['artist.jpg', 'artist.jpeg', 'artist.png', 'artist.webp', 'artist.gif'];
    let filePath: string | null = null;
    for (const directory of artistDirectories) {
      for (const filename of candidates) {
        const candidate = path.join(directory, filename);
        try {
          const stat = fs.statSync(candidate);
          if (stat.isFile() && stat.size >= 8) {
            filePath = candidate;
            break;
          }
        } catch {
          // Try the next supported local portrait name.
        }
      }
      if (filePath) break;
    }

    if (!filePath) return res.status(404).json({ error: 'No local artist.jpg portrait found' });

    // Avoid repeatedly reading the same local portrait from disk.
    res.setHeader('Cache-Control', 'private, max-age=300');
    const ext = path.extname(filePath).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.sendFile(filePath);
  } catch (error) {
    res.status(500).json({ error: 'Failed to serve local artist artwork' });
  }
});

export default router;
