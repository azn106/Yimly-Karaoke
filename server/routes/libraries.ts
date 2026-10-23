import { Router } from 'express';
import { db } from '../db/index.js';
import { libraries, songs, artists, albums, lyrics, queueItems, playlists, playlistSongs, favorites, songArtists } from '../db/schema.js';
import { eq, inArray, sql } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { scanLibrary, SUPPORTED_AUDIO_EXTS } from '../lib/scanner.js';
import { cleanupOrphanedRecords } from '../lib/artist-utils.js';
import { libraryWatcher } from '../lib/watcher.js';
import fs from 'fs';
import path from 'path';

async function containsSupportedAudio(rootPath: string): Promise<boolean> {
  const pending = [rootPath];
  while (pending.length > 0) {
    const currentPath = pending.pop()!;
    const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile() && SUPPORTED_AUDIO_EXTS.has(path.extname(entry.name).toLowerCase())) return true;
    }
  }
  return false;
}

const router = Router();
router.use(requireAuth);

// Library statistics
router.get('/stats', async (req, res) => {
  try {
    const songCountResult = await db.select({ count: sql<number>`count(*)` }).from(songs);
    const artistCountResult = await db.select({ count: sql<number>`count(*)` }).from(artists);
    const albumCountResult = await db.select({ count: sql<number>`count(*)` }).from(albums);
    const playlistCountResult = await db.select({ count: sql<number>`count(*)` }).from(playlists);
    res.json({ 
      songs: songCountResult[0].count, 
      artists: artistCountResult[0].count, 
      albums: albumCountResult[0].count,
      playlists: playlistCountResult[0].count,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

router.get('/', async (req, res) => {
  try {
    const allLibs = await db.select().from(libraries);
    res.json(allLibs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch libraries' });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, path: libPath } = req.body;
    if (!name || !libPath) {
      return res.status(400).json({ error: 'Name and path required' });
    }

    if (!fs.existsSync(libPath)) {
      return res.status(400).json({ error: 'Directory does not exist on server' });
    }

    const inserted = await db.insert(libraries).values({
      name,
      path: libPath,
    }).returning();

    // Start watching the newly added library
    await libraryWatcher.watchLibrary(inserted[0].id, inserted[0].path);

    res.json(inserted[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create library' });
  }
});

router.post('/:id/scan', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const lib = await db.select().from(libraries).where(eq(libraries.id, id)).limit(1);
    
    if (lib.length === 0) {
      return res.status(404).json({ error: 'Library not found' });
    }

    // Validate the library root before starting a destructive reconciliation scan.
    // A missing or empty mount must not be mistaken for an intentional deletion of
    // every song, because song deletion also removes playlist entries.
    let rootStat: fs.Stats;
    try {
      rootStat = fs.statSync(lib[0].path);
    } catch {
      return res.status(409).json({ error: 'Library folder is unavailable. No songs or playlist entries were changed.' });
    }
    if (!rootStat.isDirectory()) {
      return res.status(409).json({ error: 'Library path is not a directory. No songs or playlist entries were changed.' });
    }

    let hasAudio: boolean;
    try {
      hasAudio = await containsSupportedAudio(lib[0].path);
    } catch {
      return res.status(409).json({ error: 'Library folder could not be read. No songs or playlist entries were changed.' });
    }
    if (!hasAudio) {
      const existingSongs = await db.select({ id: songs.id }).from(songs).where(eq(songs.libraryId, id)).limit(1);
      if (existingSongs.length > 0) {
        return res.status(409).json({ error: 'No supported audio files were found. Existing songs and playlist entries were preserved.' });
      }
    }

    // Run async so it doesn't block request
    scanLibrary(lib[0].id, lib[0].path)
      .then(() => console.log(`Finished scanning library: ${lib[0].name}`))
      .catch((e) => console.error(`Error scanning library: ${e}`));

    res.json({ message: 'Scan started' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start scan' });
  }
});


// Watcher status for administration
router.get('/watcher/status', requireAdmin, async (req, res) => {
  try {
    res.json(libraryWatcher.getStatus());
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch watcher status' });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const lib = await db.select().from(libraries).where(eq(libraries.id, id)).limit(1);
    
    if (lib.length === 0) {
      return res.status(404).json({ error: 'Library not found' });
    }

    // Stop watcher for this library
    libraryWatcher.unwatchLibrary(id);

    const libSongs = await db.select({ id: songs.id }).from(songs).where(eq(songs.libraryId, id));
    const songIds = libSongs.map(s => s.id);

    if (songIds.length > 0) {
      const chunkSize = 500;
      for (let i = 0; i < songIds.length; i += chunkSize) {
        const chunk = songIds.slice(i, i + chunkSize);
        await db.delete(lyrics).where(inArray(lyrics.songId, chunk));
        await db.delete(playlistSongs).where(inArray(playlistSongs.songId, chunk));
        await db.delete(favorites).where(inArray(favorites.songId, chunk));
        await db.delete(queueItems).where(inArray(queueItems.songId, chunk));
        await db.delete(songArtists).where(inArray(songArtists.songId, chunk));
        await db.delete(songs).where(inArray(songs.id, chunk));
      }
    }

    await db.delete(libraries).where(eq(libraries.id, id));
    await cleanupOrphanedRecords();
    
    res.json({ message: 'Library removed' });
  } catch (error) {
    console.error('Error deleting library:', error);
    res.status(500).json({ error: 'Failed to remove library' });
  }
});

export default router;
