import express, { Router } from 'express';
import { db } from '../db/index.js';
import { songs, artists, albums, lyrics, songArtists, playlistSongs, favorites, queueItems } from '../db/schema.js';
import { eq, like, or, inArray, asc } from 'drizzle-orm';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '../middleware/auth.js';
import { formatArtistDisplay, cleanupOrphanedRecords } from '../lib/artist-utils.js';
import { broadcastSongOffsetToRooms } from '../ws/index.js';
import { isLrcContentValid } from '../lib/lyrics.js';
import fs from 'fs';
import path from 'path';

const router = Router();
router.use(requireAuth);

/**
 * Helper to fetch and map multiple artists for a list of song IDs
 */
export async function getSongArtistsMap(songIds: number[]) {
  const map = new Map<number, Array<{ id: number; name: string }>>();
  if (songIds.length === 0) return map;

  const records = await db.select({
    songId: songArtists.songId,
    artistId: artists.id,
    artistName: artists.name,
    position: songArtists.position,
  })
  .from(songArtists)
  .innerJoin(artists, eq(songArtists.artistId, artists.id))
  .where(inArray(songArtists.songId, songIds))
  .orderBy(asc(songArtists.position));

  for (const r of records) {
    if (!map.has(r.songId)) {
      map.set(r.songId, []);
    }
    map.get(r.songId)!.push({ id: r.artistId, name: r.artistName });
  }

  return map;
}

router.get('/', async (req, res) => {
  try {
    const allSongs = await db.select({
      id: songs.id,
      title: songs.title,
      artist: artists.name,
      artistId: songs.artistId,
      album: albums.title,
      albumId: songs.albumId,
      duration: songs.duration,
      variant: songs.variant,
      genre: songs.genre,
      year: songs.year,
      trackNumber: songs.trackNumber,
      artworkPath: songs.artworkPath,
      albumArtworkPath: albums.artworkPath,
      lyricOffset: songs.lyricOffset,
    })
    .from(songs)
    .leftJoin(artists, eq(songs.artistId, artists.id))
    .leftJoin(albums, eq(songs.albumId, albums.id));

    const songIds = allSongs.map(s => s.id);
    const artistsMap = await getSongArtistsMap(songIds);

    // Fetch lyrics presence without joining on table to avoid duplicate rows
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

    const formatted = allSongs.map(s => {
      const trackArtists = artistsMap.get(s.id) || (s.artist ? [{ id: s.artistId, name: s.artist }] : []);
      const l = lyricsMap.get(s.id) || { hasLrc: false, hasElrc: false };
      return {
        ...s,
        artist: formatArtistDisplay(trackArtists.length > 0 ? trackArtists : s.artist),
        artists: trackArtists,
        hasArtwork: !!s.artworkPath || !!s.albumArtworkPath,
        hasLrc: l.hasLrc,
        hasElrc: l.hasElrc
      };
    });

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch songs' });
  }
});

router.get('/search', async (req, res) => {
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

    const searchSongs = await db.select({
      id: songs.id,
      title: songs.title,
      artist: artists.name,
      artistId: songs.artistId,
      album: albums.title,
      albumId: songs.albumId,
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
        like(albums.title, searchStr),
        like(songs.mainAudioPath, searchStr),
        songIdsFromArtists.length > 0 ? inArray(songs.id, songIdsFromArtists) : undefined
      )
    )
    .limit(30);

    const songIds = searchSongs.map(s => s.id);
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

    const formatted = searchSongs.map(s => {
      const trackArtists = artistsMap.get(s.id) || (s.artist ? [{ id: s.artistId, name: s.artist }] : []);
      const l = lyricsMap.get(s.id) || { hasLrc: false, hasElrc: false };
      return {
        type: 'song',
        ...s,
        artist: formatArtistDisplay(trackArtists.length > 0 ? trackArtists : s.artist),
        artists: trackArtists,
        hasArtwork: !!s.artworkPath || !!s.albumArtworkPath,
        hasLrc: l.hasLrc,
        hasElrc: l.hasElrc,
      };
    });

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: 'Search failed' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid song ID' });

    const songRec = await db.select({
      id: songs.id,
      title: songs.title,
      artistId: songs.artistId,
      artist: artists.name,
      albumId: songs.albumId,
      album: albums.title,
      duration: songs.duration,
      variant: songs.variant,
      genre: songs.genre,
      year: songs.year,
      trackNumber: songs.trackNumber,
      discNumber: songs.discNumber,
      mainAudioPath: songs.mainAudioPath,
      instrumentalAudioPath: songs.instrumentalAudioPath,
      artworkPath: songs.artworkPath,
      albumArtworkPath: albums.artworkPath,
      lrcOffset: songs.lrcOffset,
      elrcOffset: songs.elrcOffset,
      lyricOffset: songs.lyricOffset,
    })
    .from(songs)
    .leftJoin(artists, eq(songs.artistId, artists.id))
    .leftJoin(albums, eq(songs.albumId, albums.id))
    .where(eq(songs.id, id))
    .limit(1);

    if (songRec.length === 0) return res.status(404).json({ error: 'Song not found' });

    const songLyrics = await db.select().from(lyrics).where(eq(lyrics.songId, id));
    let hasElrc = songLyrics.some(l => !!l.elrcPath && l.elrcPath.trim().length > 0 && fs.existsSync(l.elrcPath));
    let hasLrc = songLyrics.some(l => !!l.lrcPath && l.lrcPath.trim().length > 0 && fs.existsSync(l.lrcPath));
    const audioPath = songRec[0].mainAudioPath || songRec[0].instrumentalAudioPath;
    
    // Fallback: check filesystem if not in db
    if ((!hasLrc || !hasElrc) && audioPath && fs.existsSync(audioPath)) {
      const dir = path.dirname(audioPath);
      if (fs.existsSync(dir)) {
        try {
          const entries = await fs.promises.readdir(dir, { withFileTypes: true });
          const audioExt = path.extname(audioPath);
          const baseName = path.basename(audioPath, audioExt);
          const cleanBase = baseName.replace(/\s*\((instrumental|karaoke|vocals|backing version|backing)\)\s*/gi, '').trim().toLowerCase();

          for (const e of entries) {
            if (!e.isFile()) continue;
            const nameLower = e.name.toLowerCase();
            if (nameLower.endsWith('.elrc.lrc')) {
              const elrcBase = nameLower.slice(0, -9).replace(/\s*\((instrumental|karaoke|vocals|backing version|backing)\)\s*/gi, '').trim();
              if (elrcBase === cleanBase) {
                hasElrc = true;
              }
            } else if (nameLower.endsWith('.lrc')) {
              const lrcBase = nameLower.slice(0, -4).replace(/\s*\((instrumental|karaoke|vocals|backing version|backing)\)\s*/gi, '').trim();
              if (lrcBase === cleanBase) {
                hasLrc = true;
              }
            }
          }
        } catch (e) {}
      }
    }

    const artistsMap = await getSongArtistsMap([id]);
    const trackArtists = artistsMap.get(id) || (songRec[0].artist ? [{ id: songRec[0].artistId, name: songRec[0].artist }] : []);

    const lrcOffsetVal = typeof songRec[0].lrcOffset === 'number' ? songRec[0].lrcOffset : (songRec[0].lyricOffset ?? 0);
    const elrcOffsetVal = typeof songRec[0].elrcOffset === 'number' ? songRec[0].elrcOffset : (songRec[0].lyricOffset ?? 0);
    const hasInstrumental = !!(songRec[0].instrumentalAudioPath && fs.existsSync(songRec[0].instrumentalAudioPath));

    res.json({
      ...songRec[0],
      artist: formatArtistDisplay(trackArtists.length > 0 ? trackArtists : songRec[0].artist),
      artists: trackArtists,
      hasArtwork: !!songRec[0].artworkPath || !!songRec[0].albumArtworkPath,
      hasLrc: hasLrc,
      hasElrc: hasElrc,
      hasInstrumental,
      lrcOffset: lrcOffsetVal,
      elrcOffset: elrcOffsetVal,
      lyricOffset: songRec[0].lyricOffset ?? 0,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch song details' });
  }
});

router.get('/:id/artwork', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid song ID' });

    const song = await db.select({
      artworkPath: songs.artworkPath,
      albumId: songs.albumId,
    }).from(songs).where(eq(songs.id, id)).limit(1);

    if (song.length === 0) return res.status(404).json({ error: 'Song not found' });

    let artworkFilename = song[0].artworkPath;

    // Fallback to album's embedded artwork if song does not directly reference it
    if (!artworkFilename && song[0].albumId) {
      const album = await db.select({ artworkPath: albums.artworkPath })
        .from(albums)
        .where(eq(albums.id, song[0].albumId))
        .limit(1);
      if (album.length > 0 && album[0].artworkPath) {
        artworkFilename = album[0].artworkPath;
      }
    }

    if (!artworkFilename) {
      return res.status(404).json({ error: 'No embedded artwork found for this track' });
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
    res.status(500).json({ error: 'Failed to serve artwork' });
  }
});

/**
 * Audio streaming handler supporting HTTP byte-range requests (RFC 7233),
 * seeking, efficient stream piping without buffering into memory,
 * caching headers (ETag, Last-Modified), HEAD requests, and edge-case handling.
 */
export async function handleAudioStream(req: express.Request, res: express.Response) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid song ID' });
    }

    const type = (req.query.type as string)?.toLowerCase(); // 'main' or 'instrumental'

    const song = await db.select().from(songs).where(eq(songs.id, id)).limit(1);
    if (song.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }

    let audioPath: string | null = null;

    if (type === 'instrumental') {
      audioPath = song[0].instrumentalAudioPath;
      if (!audioPath || typeof audioPath !== 'string' || audioPath.trim().length === 0) {
        return res.status(404).json({ error: 'Instrumental audio track not available for this song' });
      }
    } else if (type === 'original' || type === 'main') {
      audioPath = song[0].mainAudioPath;
      if (!audioPath || typeof audioPath !== 'string' || audioPath.trim().length === 0) {
        return res.status(404).json({ error: 'Original audio track not available for this song' });
      }
    } else {
      audioPath = song[0].mainAudioPath || song[0].instrumentalAudioPath;
      if (!audioPath || typeof audioPath !== 'string' || audioPath.trim().length === 0) {
        return res.status(404).json({ error: 'Audio file not found' });
      }
    }

    let resolvedPath = path.resolve(audioPath);

    // Verify file exists, is readable, and obtain filesystem size and modification time
    let stat: fs.Stats;
    try {
      await fs.promises.access(resolvedPath, fs.constants.R_OK);
      stat = await fs.promises.stat(resolvedPath);
    } catch (accessErr: any) {
      return res.status(404).json({ error: 'Audio file not found or inaccessible on disk' });
    }

    if (!stat.isFile()) {
      return res.status(404).json({ error: 'Audio path is not a file' });
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    let contentType = 'audio/mpeg';
    if (ext === '.mp3') {
      contentType = 'audio/mpeg';
    } else if (ext === '.flac') {
      contentType = 'audio/flac';
    } else if (ext === '.m4a' || ext === '.aac') {
      contentType = 'audio/mp4';
    } else if (ext === '.ogg' || ext === '.opus') {
      contentType = 'audio/ogg';
    } else if (ext === '.wav') {
      contentType = 'audio/wav';
    }

    const fileSize = stat.size;
    const lastModified = stat.mtime.toUTCString();
    const etag = `"${fileSize.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', lastModified);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, no-transform, max-age=3600');

    const rangeHeader = req.headers.range;

    // Handle conditional GET caching when no range is requested
    if (!rangeHeader && req.method === 'GET') {
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch && ifNoneMatch === etag) {
        return res.status(304).end();
      }

      const ifModifiedSince = req.headers['if-modified-since'];
      if (ifModifiedSince) {
        const ifModTime = new Date(ifModifiedSince).getTime();
        if (!isNaN(ifModTime) && stat.mtimeMs <= ifModTime + 1000) {
          return res.status(304).end();
        }
      }
    }

    // Handle empty file
    if (fileSize === 0) {
      res.setHeader('Content-Length', 0);
      return res.status(200).end();
    }

    // Handle standard request without Range header (HTTP 200 OK)
    if (!rangeHeader) {
      res.setHeader('Content-Length', fileSize);
      res.status(200);

      if (req.method === 'HEAD') {
        return res.end();
      }

      const stream = fs.createReadStream(resolvedPath);
      req.on('close', () => {
        stream.destroy();
      });
      stream.on('error', (err) => {
        console.error(`[AUDIO STREAM] Error on full stream for song #${id}:`, err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to stream audio file' });
        }
      });

      return stream.pipe(res);
    }

    // Handle HTTP Range Request (RFC 7233)
    if (!rangeHeader.startsWith('bytes=')) {
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      return res.status(416).end();
    }

    const rangeSpec = rangeHeader.slice(6).trim();
    const firstRange = rangeSpec.split(',')[0].trim();
    const match = /^(\d*)-(\d*)$/.exec(firstRange);

    if (!match) {
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      return res.status(416).end();
    }

    const [_, startStr, endStr] = match;
    let start: number;
    let end: number;

    if (startStr !== '' && endStr !== '') {
      start = parseInt(startStr, 10);
      end = parseInt(endStr, 10);
    } else if (startStr !== '' && endStr === '') {
      start = parseInt(startStr, 10);
      end = fileSize - 1;
    } else if (startStr === '' && endStr !== '') {
      const suffix = parseInt(endStr, 10);
      start = Math.max(0, fileSize - suffix);
      end = fileSize - 1;
    } else {
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      return res.status(416).end();
    }

    if (isNaN(start) || isNaN(end) || start < 0 || start >= fileSize || start > end) {
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      return res.status(416).end();
    }

    // Constrain end within file bounds
    end = Math.min(end, fileSize - 1);
    const contentLength = end - start + 1;

    if (contentLength <= 0) {
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      return res.status(416).end();
    }

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Content-Length', contentLength);

    if (req.method === 'HEAD') {
      return res.end();
    }

    const stream = fs.createReadStream(resolvedPath, { start, end });
    req.on('close', () => {
      stream.destroy();
    });
    stream.on('error', (err) => {
      console.error(`[AUDIO STREAM] Error on range stream for song #${id} (${start}-${end}):`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream audio chunk' });
      }
    });

    return stream.pipe(res);
  } catch (error) {
    console.error('[AUDIO STREAM] Unhandled server error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to serve audio' });
    }
  }
}

router.get('/:id/audio', handleAudioStream);
router.head('/:id/audio', handleAudioStream);
router.get('/:id/stream', handleAudioStream);
router.head('/:id/stream', handleAudioStream);

router.get('/:id/lyrics', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid song ID' });

    const song = await db.select().from(songs).where(eq(songs.id, id)).limit(1);
    if (song.length === 0) return res.status(404).json({ error: 'Song not found' });

    const audioPath = song[0].mainAudioPath || song[0].instrumentalAudioPath;
    const formatQuery = req.query.format as string;
    const lrcRecord = await db.select().from(lyrics).where(eq(lyrics.songId, id)).limit(1);

    // Candidates collections separated by format hierarchy:
    // 1. .elrc.lrc (Preferred format)
    // 2. .lrc (Fallback format)
    // 3. Other fallbacks
    const candidateElrcs: string[] = [];
    const candidateStdLrcs: string[] = [];
    const otherFallbacks: string[] = [];

    if (audioPath && fs.existsSync(audioPath)) {
      const dir = path.dirname(audioPath);
      const audioExt = path.extname(audioPath);
      const audioBase = path.basename(audioPath, audioExt);
      const cleanBase = audioBase.replace(/\s*\((instrumental|karaoke|vocals|backing version|backing)\)\s*/gi, '').trim();
      const songTitle = (song[0].title || '').trim();

      if (fs.existsSync(dir)) {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        const lrcEntries = entries.filter(e => e.isFile() && (e.name.toLowerCase().endsWith('.elrc.lrc') || e.name.toLowerCase().endsWith('.lrc')));

        const parsedLrcs = lrcEntries.map(e => {
          const lower = e.name.toLowerCase();
          const isElrc = lower.endsWith('.elrc.lrc');
          const extLen = isElrc ? 9 : 4;
          const lrcBase = e.name.slice(0, -extLen);
          const cleanLrcBase = lrcBase.replace(/\s*\((instrumental|karaoke|vocals|backing version|backing)\)\s*/gi, '').trim();
          return {
            name: e.name,
            fullPath: path.join(dir, e.name),
            lrcBase,
            cleanLrcBase,
            isElrc,
          };
        });

        const elrcPool = parsedLrcs.filter(l => l.isElrc);
        const stdPool = parsedLrcs.filter(l => !l.isElrc);

        const rankFiles = (pool: typeof parsedLrcs) => {
          const ranked: string[] = [];
          // 1. Exact base match (e.g. Song.mp3 -> Song.elrc.lrc / Song.lrc)
          const exact = pool.find(l => l.lrcBase.trim().toLowerCase() === audioBase.trim().toLowerCase());
          if (exact && !ranked.includes(exact.fullPath)) ranked.push(exact.fullPath);

          // 2. Clean variant match
          const clean = pool.find(l => l.cleanLrcBase.toLowerCase() === cleanBase.toLowerCase());
          if (clean && !ranked.includes(clean.fullPath)) ranked.push(clean.fullPath);

          // 3. Song title match
          if (songTitle) {
            const titleMatch = pool.find(l => l.lrcBase.trim().toLowerCase() === songTitle.toLowerCase() || l.cleanLrcBase.toLowerCase() === songTitle.toLowerCase());
            if (titleMatch && !ranked.includes(titleMatch.fullPath)) ranked.push(titleMatch.fullPath);
          }

          return ranked;
        };

        candidateElrcs.push(...rankFiles(elrcPool));
        candidateStdLrcs.push(...rankFiles(stdPool));
      }
    }

    // Also consider previously indexed database record
    if (lrcRecord.length > 0) {
      if (lrcRecord[0].elrcPath) {
        if (!candidateElrcs.includes(lrcRecord[0].elrcPath)) candidateElrcs.push(lrcRecord[0].elrcPath);
      }
      if (lrcRecord[0].lrcPath) {
        if (!candidateStdLrcs.includes(lrcRecord[0].lrcPath)) candidateStdLrcs.push(lrcRecord[0].lrcPath);
      }
    }

    // Helper to persist/sync active path in database
    const persistMatchedPath = async (p: string, isElrc: boolean) => {
      try {
        if (lrcRecord.length === 0) {
          const vals: any = { songId: id };
          if (isElrc) { vals.elrcPath = p; vals.lrcPath = ''; }
          else { vals.lrcPath = p; vals.elrcPath = null; }
          await db.insert(lyrics).values(vals);
        } else {
          const updates: any = {};
          if (isElrc && lrcRecord[0].elrcPath !== p) updates.elrcPath = p;
          else if (!isElrc && lrcRecord[0].lrcPath !== p) updates.lrcPath = p;
          if (Object.keys(updates).length > 0) {
            await db.update(lyrics).set(updates).where(eq(lyrics.id, lrcRecord[0].id));
          }
        }
      } catch (err) {
        console.warn('Failed to sync lyrics path to DB:', err);
      }
    };

    if (formatQuery === 'elrc' || !formatQuery) {
      // 1. Preferred / First Choice: Check .elrc.lrc candidates
      for (const filePath of candidateElrcs) {
        if (fs.existsSync(filePath)) {
          try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            if (isLrcContentValid(content)) {
              await persistMatchedPath(filePath, true);
              return res.type('text/plain').send(content);
            } else {
              console.warn(`[Lyrics] .elrc.lrc at ${filePath} is invalid/unparseable; falling back to .lrc`);
            }
          } catch (e) {
            console.warn(`[Lyrics] Could not read .elrc.lrc at ${filePath}:`, e);
          }
        }
      }
      if (formatQuery === 'elrc') return res.status(404).json({ error: 'ELRC not found' });
    }

    if (formatQuery === 'lrc' || !formatQuery) {
      // 2. Fallback: Check .lrc candidates if .elrc.lrc is missing or invalid
      for (const filePath of candidateStdLrcs) {
      if (fs.existsSync(filePath)) {
        try {
          const content = await fs.promises.readFile(filePath, 'utf-8');
          if (isLrcContentValid(content)) {
            await persistMatchedPath(filePath, false);
            return res.type('text/plain').send(content);
          } else {
            console.warn(`[Lyrics] .lrc at ${filePath} is invalid/unparseable; checking other fallbacks`);
          }
        } catch (e) {
          console.warn(`[Lyrics] Could not read .lrc at ${filePath}:`, e);
        }
      }
    }

    // 3. Other existing lyrics fallbacks (e.g. non-timestamped raw text)
    for (const filePath of otherFallbacks) {
      if (fs.existsSync(filePath)) {
        try {
          const content = await fs.promises.readFile(filePath, 'utf-8');
          if (content && content.trim().length > 0) {
            await persistMatchedPath(filePath, false);
            return res.type('text/plain').send(content);
          }
        } catch (e) {}
      }
    }

    }
    return res.status(404).json({ error: 'Lyrics not found' });
  } catch (error) {
    console.error('Failed to fetch lyrics:', error);
    res.status(500).json({ error: 'Failed to fetch lyrics' });
  }
});

router.get('/:id/lyrics/offset', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid song ID' });

    const song = await db.select({
      lrcOffset: songs.lrcOffset,
      elrcOffset: songs.elrcOffset,
      lyricOffset: songs.lyricOffset,
    }).from(songs).where(eq(songs.id, id)).limit(1);

    if (song.length === 0) return res.status(404).json({ error: 'Song not found' });

    const format = req.query.format === 'elrc' ? 'elrc' : (req.query.format === 'lrc' ? 'lrc' : undefined);
    const lrcOffset = typeof song[0].lrcOffset === 'number' ? song[0].lrcOffset : (song[0].lyricOffset ?? 0);
    const elrcOffset = typeof song[0].elrcOffset === 'number' ? song[0].elrcOffset : (song[0].lyricOffset ?? 0);
    const defaultOffset = format === 'elrc' ? elrcOffset : (format === 'lrc' ? lrcOffset : (song[0].lyricOffset ?? 0));

    res.json({
      songId: id,
      offset: defaultOffset,
      lrcOffset,
      elrcOffset,
      lyricOffset: song[0].lyricOffset ?? 0
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch lyric offset' });
  }
});

const updateSongLyricOffset = async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid song ID' });

    const format = req.body?.format === 'elrc' ? 'elrc' : (req.body?.format === 'lrc' ? 'lrc' : undefined);
    const rawOffset = req.body?.offset !== undefined 
      ? req.body.offset 
      : (format === 'elrc' ? req.body?.elrcOffset : (format === 'lrc' ? req.body?.lrcOffset : req.body?.lyricOffset));

    if (rawOffset === undefined || isNaN(Number(rawOffset))) {
      return res.status(400).json({ error: 'Offset must be a valid number in milliseconds' });
    }

    const offset = Math.round(Number(rawOffset));
    const existing = await db.select({
      id: songs.id,
      lrcOffset: songs.lrcOffset,
      elrcOffset: songs.elrcOffset,
      lyricOffset: songs.lyricOffset,
    }).from(songs).where(eq(songs.id, id)).limit(1);

    if (existing.length === 0) return res.status(404).json({ error: 'Song not found' });

    const updateObj: any = { lyricOffset: offset };
    let newLrcOffset = typeof existing[0].lrcOffset === 'number' ? existing[0].lrcOffset : (existing[0].lyricOffset ?? 0);
    let newElrcOffset = typeof existing[0].elrcOffset === 'number' ? existing[0].elrcOffset : (existing[0].lyricOffset ?? 0);

    if (format === 'elrc') {
      newElrcOffset = offset;
      updateObj.elrcOffset = offset;
    } else if (format === 'lrc') {
      newLrcOffset = offset;
      updateObj.lrcOffset = offset;
    } else {
      if (req.body?.lrcOffset !== undefined) {
        newLrcOffset = Math.round(Number(req.body.lrcOffset));
        updateObj.lrcOffset = newLrcOffset;
      }
      if (req.body?.elrcOffset !== undefined) {
        newElrcOffset = Math.round(Number(req.body.elrcOffset));
        updateObj.elrcOffset = newElrcOffset;
      }
    }

    await db.update(songs).set(updateObj).where(eq(songs.id, id));

    // Broadcast updated offset to active websocket rooms playing this song
    broadcastSongOffsetToRooms(id, offset, format, newLrcOffset, newElrcOffset);

    res.json({
      success: true,
      songId: id,
      offset,
      format,
      lrcOffset: newLrcOffset,
      elrcOffset: newElrcOffset,
      lyricOffset: offset
    });
  } catch (error) {
    console.error('Failed to update song lyric offset:', error);
    res.status(500).json({ error: 'Failed to update song lyric offset' });
  }
};

router.put('/:id/lyrics/offset', updateSongLyricOffset);
router.post('/:id/lyrics/offset', updateSongLyricOffset);
router.patch('/:id/lyrics/offset', updateSongLyricOffset);

// --- LRC Management Routes ---

const handleUploadOrUpdateLrc = async (req: AuthenticatedRequest, res: any) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid song ID' });

    const song = await db.select().from(songs).where(eq(songs.id, id)).limit(1);
    if (song.length === 0) return res.status(404).json({ error: 'Song not found' });

    let lrcContent = '';
    if (typeof req.body === 'string') {
      lrcContent = req.body;
    } else if (Buffer.isBuffer(req.body)) {
      lrcContent = req.body.toString('utf-8');
    } else if (req.body && typeof req.body === 'object') {
      lrcContent = req.body.content || req.body.lyrics || req.body.lrc || '';
    }

    if (typeof lrcContent !== 'string') {
      lrcContent = String(lrcContent || '');
    }

    const isElrc = req.query.format === 'elrc';
    const existingLrc = await db.select().from(lyrics).where(eq(lyrics.songId, id)).limit(1);
    let targetPath = existingLrc.length > 0 ? (isElrc ? existingLrc[0].elrcPath : existingLrc[0].lrcPath) : null;

    if (!targetPath) {
      const audioPath = song[0].mainAudioPath || song[0].instrumentalAudioPath;
      if (!audioPath) {
        return res.status(400).json({ error: 'Song has no audio path associated' });
      }
      const dir = path.dirname(audioPath);
      const audioExt = path.extname(audioPath);
      const baseName = path.basename(audioPath, audioExt);
      const cleanBase = baseName.replace(/\s*\((instrumental|karaoke|vocals|backing version|backing)\)\s*/gi, '').trim();
      targetPath = path.join(dir, isElrc ? `${cleanBase}.elrc.lrc` : `${cleanBase}.lrc`);
    }

    const dirPath = path.dirname(targetPath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.writeFileSync(targetPath, lrcContent, 'utf-8');

    if (existingLrc.length === 0) {
      const audioPath = song[0].mainAudioPath || song[0].instrumentalAudioPath;
      let companionPath: string | null = null;
      if (audioPath && fs.existsSync(audioPath)) {
        const dir = path.dirname(audioPath);
        const audioExt = path.extname(audioPath);
        const baseName = path.basename(audioPath, audioExt);
        const cleanBase = baseName.replace(/\s*\((instrumental|karaoke|vocals|backing version|backing)\)\s*/gi, '').trim();
        const candidateCompanion = path.join(dir, isElrc ? `${cleanBase}.lrc` : `${cleanBase}.elrc.lrc`);
        if (fs.existsSync(candidateCompanion)) {
          companionPath = candidateCompanion;
        }
      }

      const vals: any = { songId: id };
      if (isElrc) {
        vals.elrcPath = targetPath;
        vals.lrcPath = companionPath || '';
      } else {
        vals.lrcPath = targetPath;
        vals.elrcPath = companionPath;
      }
      await db.insert(lyrics).values(vals);
    } else {
      const updates: any = {};
      if (isElrc) updates.elrcPath = targetPath;
      else updates.lrcPath = targetPath;
      await db.update(lyrics).set(updates).where(eq(lyrics.songId, id));
    }

    const updatedLrc = await db.select().from(lyrics).where(eq(lyrics.songId, id)).limit(1);
    const hasLrcNow = updatedLrc.length > 0 && !!updatedLrc[0].lrcPath && updatedLrc[0].lrcPath.trim().length > 0;
    const hasElrcNow = updatedLrc.length > 0 && !!updatedLrc[0].elrcPath && updatedLrc[0].elrcPath.trim().length > 0;

    res.json({
      success: true,
      songId: id,
      path: targetPath,
      hasLrc: hasLrcNow,
      hasElrc: hasElrcNow,
      content: lrcContent,
    });
  } catch (error) {
    console.error('Failed to save LRC:', error);
    res.status(500).json({ error: 'Failed to save LRC lyrics' });
  }
};

router.post('/:id/lrc', requireAdmin, express.text({ type: ['text/*', 'application/octet-stream', 'application/json'] }), handleUploadOrUpdateLrc);
router.put('/:id/lrc', requireAdmin, express.text({ type: ['text/*', 'application/octet-stream', 'application/json'] }), handleUploadOrUpdateLrc);
router.patch('/:id/lrc', requireAdmin, express.text({ type: ['text/*', 'application/octet-stream', 'application/json'] }), handleUploadOrUpdateLrc);

router.delete('/:id/lrc', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid song ID' });

    const isElrc = req.query.format === 'elrc';
    const existingLrc = await db.select().from(lyrics).where(eq(lyrics.songId, id)).limit(1);
    if (existingLrc.length > 0) {
      const rec = existingLrc[0];
      const targetPath = isElrc ? rec.elrcPath : rec.lrcPath;
      if (targetPath && fs.existsSync(targetPath)) {
        try { fs.unlinkSync(targetPath); } catch (e) {}
      }
      
      const newElrc = isElrc ? null : rec.elrcPath;
      const newLrc = isElrc ? rec.lrcPath : '';
      
      if ((newElrc === null || newElrc === '') && (newLrc === null || newLrc === '')) {
        await db.delete(lyrics).where(eq(lyrics.songId, id));
      } else {
        const updates: any = {};
        if (isElrc) updates.elrcPath = null;
        else updates.lrcPath = '';
        await db.update(lyrics).set(updates).where(eq(lyrics.songId, id));
      }
    }

    const updatedLrc = await db.select().from(lyrics).where(eq(lyrics.songId, id)).limit(1);
    const hasLrcNow = updatedLrc.length > 0 && !!updatedLrc[0].lrcPath && updatedLrc[0].lrcPath.trim().length > 0;
    const hasElrcNow = updatedLrc.length > 0 && !!updatedLrc[0].elrcPath && updatedLrc[0].elrcPath.trim().length > 0;

    res.json({ success: true, songId: id, hasLrc: hasLrcNow, hasElrc: hasElrcNow });
  } catch (error) {
    console.error('Failed to delete LRC:', error);
    res.status(500).json({ error: 'Failed to delete LRC lyrics' });
  }
});

// --- Complete Song Delete Route ---

router.delete('/:id', requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid song ID' });

    const song = await db.select().from(songs).where(eq(songs.id, id)).limit(1);
    if (song.length === 0) return res.status(404).json({ error: 'Song not found' });

    const targetSong = song[0];
    const filesToDelete: string[] = [];

    if (targetSong.mainAudioPath && fs.existsSync(targetSong.mainAudioPath)) {
      filesToDelete.push(targetSong.mainAudioPath);
    }
    if (targetSong.instrumentalAudioPath && fs.existsSync(targetSong.instrumentalAudioPath)) {
      filesToDelete.push(targetSong.instrumentalAudioPath);
    }

    const lrcRec = await db.select().from(lyrics).where(eq(lyrics.songId, id)).limit(1);
    if (lrcRec.length > 0 && lrcRec[0].lrcPath && fs.existsSync(lrcRec[0].lrcPath)) {
      filesToDelete.push(lrcRec[0].lrcPath);
    }

    if (targetSong.mainAudioPath) {
      const dir = path.dirname(targetSong.mainAudioPath);
      const audioExt = path.extname(targetSong.mainAudioPath);
      const baseName = path.basename(targetSong.mainAudioPath, audioExt);
      const cleanBase = baseName.replace(/\s*\((instrumental|karaoke|vocals|backing version|backing)\)\s*/gi, '').trim().toLowerCase();

      if (fs.existsSync(dir)) {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const lowerName = entry.name.toLowerCase();
            if (entry.isFile() && (lowerName.endsWith('.elrc.lrc') || lowerName.endsWith('.lrc'))) {
              const isElrc = lowerName.endsWith('.elrc.lrc');
              const extLen = isElrc ? 9 : 4;
              const lrcBase = entry.name.slice(0, -extLen);
              const cleanLrcBase = lrcBase.replace(/\s*\((instrumental|karaoke|vocals|backing version|backing)\)\s*/gi, '').trim().toLowerCase();
              if (cleanLrcBase === cleanBase || lrcBase.toLowerCase() === baseName.toLowerCase()) {
                const fullLrcPath = path.join(dir, entry.name);
                if (!filesToDelete.includes(fullLrcPath)) {
                  filesToDelete.push(fullLrcPath);
                }
              }
            }
          }
        } catch (e) {}
      }
    }

    for (const filePath of filesToDelete) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        console.error(`Failed to delete file ${filePath}:`, err);
      }
    }

    await db.delete(lyrics).where(eq(lyrics.songId, id));
    await db.delete(playlistSongs).where(eq(playlistSongs.songId, id));
    await db.delete(favorites).where(eq(favorites.songId, id));
    await db.delete(queueItems).where(eq(queueItems.songId, id));
    await db.delete(songArtists).where(eq(songArtists.songId, id));
    await db.delete(songs).where(eq(songs.id, id));

    await cleanupOrphanedRecords();

    res.json({
      success: true,
      deletedSongId: id,
      deletedFiles: filesToDelete,
    });
  } catch (error) {
    console.error('Failed to delete song completely:', error);
    res.status(500).json({ error: 'Failed to delete song' });
  }
});

export default router;
