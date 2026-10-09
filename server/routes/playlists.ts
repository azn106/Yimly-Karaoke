import { Router } from 'express';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { db } from '../db/index.js';
import { playlists, playlistSongs, songs, artists, albums, users, playlistShares, lyrics } from '../db/schema.js';
import { eq, and, or, asc, sql, inArray } from 'drizzle-orm';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';
import { formatArtistDisplay } from '../lib/artist-utils.js';
import { getSongArtistsMap } from './songs.js';
import { z } from 'zod';

const router = Router();
router.use(requireAuth);

const playlistCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().optional().default(false),
});

const playlistUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().optional(),
  userId: z.number().optional(),
  ownerId: z.number().optional(),
  ownerUsername: z.string().optional(),
});

// List all playlists belonging to the user AND shared with the user (or all if admin)
router.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    const isAdmin = req.user?.role === 'administrator';

    let allPlaylists;
    if (isAdmin) {
      allPlaylists = await db.select({
        id: playlists.id,
        userId: playlists.userId,
        name: playlists.name,
        description: playlists.description,
        isPublic: playlists.isPublic,
        coverPath: playlists.coverPath,
        createdAt: playlists.createdAt,
        updatedAt: playlists.updatedAt,
        ownerName: users.username,
        songCount: sql<number>`(SELECT count(*) FROM playlist_songs WHERE playlist_songs.playlist_id = playlists.id)`,
      })
      .from(playlists)
      .leftJoin(users, eq(playlists.userId, users.id))
      .orderBy(asc(playlists.name));
    } else {
      // Need distinct because of leftJoin
      allPlaylists = await db.selectDistinct({
        id: playlists.id,
        userId: playlists.userId,
        name: playlists.name,
        description: playlists.description,
        isPublic: playlists.isPublic,
        coverPath: playlists.coverPath,
        createdAt: playlists.createdAt,
        updatedAt: playlists.updatedAt,
        ownerName: users.username,
        songCount: sql<number>`(SELECT count(*) FROM playlist_songs WHERE playlist_songs.playlist_id = playlists.id)`,
        sharePermission: playlistShares.permission,
      })
      .from(playlists)
      .leftJoin(users, eq(playlists.userId, users.id))
      .leftJoin(playlistShares, and(eq(playlists.id, playlistShares.playlistId), eq(playlistShares.userId, userId!)))
      .where(or(eq(playlists.userId, userId!), eq(playlistShares.userId, userId!), eq(playlists.isPublic, 1)))
      .orderBy(asc(playlists.name));
    }

    const formatted = allPlaylists.map((p: any) => ({
      ...p,
      isPublic: p.isPublic === 1,
      isOwner: p.userId === userId,
      canEdit: p.userId === userId || isAdmin || p.sharePermission === 'edit',
      permission: p.userId === userId ? 'owner' : (isAdmin ? 'admin' : (p.sharePermission || (p.isPublic === 1 ? 'view' : 'none'))),
      coverImageUrl: p.coverPath ? `/api/playlists/${p.id}/cover` : null,
    }));

    // Remove duplicates if the query returned any due to multiple shares (shouldn't happen with distinct, but just in case)
    const unique = Array.from(new Map(formatted.map((item: any) => [item.id, item])).values());
    unique.sort((a: any, b: any) => a.name.localeCompare(b.name));

    res.json(unique);
  } catch (error) {
    console.error('Failed to fetch playlists:', error);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

// Create a new playlist (server determines owner from authentication, client-supplied userId is ignored)
router.post('/', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Ensure client cannot supply userId
    if (req.body && ('userId' in req.body || 'user_id' in req.body)) {
      delete req.body.userId;
      delete req.body.user_id;
    }

    const parsed = playlistCreateSchema.parse(req.body);

    const now = new Date();
    const created = await db.insert(playlists).values({
      userId,
      name: parsed.name.trim(),
      description: parsed.description?.trim() || null,
      isPublic: parsed.isPublic ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    }).returning();

    res.status(201).json({
      ...created[0],
      isPublic: created[0].isPublic === 1,
      isOwner: true,
      canEdit: true,
      songs: [],
      permission: 'owner',
      coverImageUrl: created[0].coverPath ? `/api/playlists/${created[0].id}/cover` : null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.issues });
    } else {
      res.status(500).json({ error: 'Failed to create playlist' });
    }
  }
});

// Helper function to get playlist and check access
async function getPlaylistAndAccess(playlistId: number, reqUser: any) {
  const userId = reqUser?.id;
  const isAdmin = reqUser?.role === 'administrator';

  const playlist = await db.select({
    id: playlists.id,
    userId: playlists.userId,
    name: playlists.name,
    description: playlists.description,
    isPublic: playlists.isPublic,
    coverPath: playlists.coverPath,
    createdAt: playlists.createdAt,
    updatedAt: playlists.updatedAt,
    ownerName: users.username,
  })
  .from(playlists)
  .leftJoin(users, eq(playlists.userId, users.id))
  .where(eq(playlists.id, playlistId))
  .limit(1);

  if (playlist.length === 0) return { playlist: null, access: null };

  const p = playlist[0];
  const isOwner = p.userId === userId;

  let sharePermission = null;
  if (!isOwner && !isAdmin) {
    const share = await db.select().from(playlistShares)
      .where(and(eq(playlistShares.playlistId, playlistId), eq(playlistShares.userId, userId)))
      .limit(1);
    if (share.length > 0) {
      sharePermission = share[0].permission;
    }
  }

  const canView = isOwner || isAdmin || p.isPublic === 1 || sharePermission !== null;
  const canEdit = isOwner || isAdmin || sharePermission === 'edit';

  return {
    playlist: p,
    access: { isOwner, isAdmin, sharePermission, canView, canEdit }
  };
}

// Get playlist by ID with ordered songs
router.get('/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid playlist ID' });

    const { playlist: p, access } = await getPlaylistAndAccess(id, req.user);

    if (!p) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    if (!access?.canView) {
      return res.status(403).json({ error: 'Forbidden. Access denied.' });
    }

    // Fetch songs in playlist
    const pSongs = await db.select({
      playlistSongId: playlistSongs.id,
      position: playlistSongs.position,
      addedAt: playlistSongs.addedAt,
      id: songs.id,
      title: songs.title,
      artistId: songs.artistId,
      artist: artists.name,
      albumId: songs.albumId,
      album: albums.title,
      duration: songs.duration,
      variant: songs.variant,
      artworkPath: songs.artworkPath,
      albumArtworkPath: albums.artworkPath,
      mainAudioPath: songs.mainAudioPath,
      instrumentalAudioPath: songs.instrumentalAudioPath,
    })
    .from(playlistSongs)
    .innerJoin(songs, eq(playlistSongs.songId, songs.id))
    .leftJoin(artists, eq(songs.artistId, artists.id))
    .leftJoin(albums, eq(songs.albumId, albums.id))
    .where(eq(playlistSongs.playlistId, id))
    .orderBy(asc(playlistSongs.position), asc(playlistSongs.addedAt));

    const songIds = pSongs.map(s => s.id);
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

    const formattedSongs = pSongs.map(s => {
      const trackArtists = artistsMap.get(s.id) || (s.artist ? [{ id: s.artistId, name: s.artist }] : []);
      const lyr = lyricsMap.get(s.id) || { hasLrc: false, hasElrc: false };
      const hasOriginal = !!(s.mainAudioPath && s.mainAudioPath.trim().length > 0) || (s.variant === 'original' && !s.instrumentalAudioPath);
      const hasInstrumental = !!(s.instrumentalAudioPath && s.instrumentalAudioPath.trim().length > 0) || s.variant === 'instrumental';
      return {
        playlistSongId: s.playlistSongId,
        position: s.position,
        addedAt: s.addedAt,
        id: s.id,
        title: s.title,
        artist: formatArtistDisplay(trackArtists.length > 0 ? trackArtists : s.artist),
        artists: trackArtists,
        album: s.album,
        albumId: s.albumId,
        duration: s.duration,
        variant: s.variant,
        hasArtwork: !!s.artworkPath || !!s.albumArtworkPath,
        hasLrc: lyr.hasLrc,
        hasElrc: lyr.hasElrc,
        hasOriginal,
        hasInstrumental,
      };
    });

    res.json({
      ...p,
      isPublic: p.isPublic === 1,
      isOwner: access.isOwner,
      canEdit: access.canEdit,
      permission: access.isOwner ? 'owner' : (access.sharePermission || 'none'),
      coverImageUrl: p.coverPath ? `/api/playlists/${p.id}/cover` : null,
      songs: formattedSongs,
    });
  } catch (error) {
    console.error('Failed to fetch playlist:', error);
    res.status(500).json({ error: 'Failed to fetch playlist' });
  }
});

// Get playlist cover image
router.get('/:id/cover', async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid playlist ID' });

    const { playlist: p, access } = await getPlaylistAndAccess(id, req.user);
    if (!p) return res.status(404).json({ error: 'Playlist not found' });

    if (!access?.canView) {
      return res.status(403).json({ error: 'Forbidden. Access denied.' });
    }

    if (!p.coverPath) {
      return res.status(404).json({ error: 'No cover image found for this playlist' });
    }

    const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');
    const safeFilename = path.basename(p.coverPath);
    const filePath = path.join(dataDir, 'playlist_covers', safeFilename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Cover image file not found on disk' });
    }

    const ext = path.extname(safeFilename).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.sendFile(filePath);
  } catch (error) {
    console.error('Failed to serve playlist cover:', error);
    res.status(500).json({ error: 'Failed to serve cover image' });
  }
});

// Upload/update playlist cover image
router.post('/:id/cover', express.raw({ type: ['image/*', 'application/octet-stream', 'application/json'], limit: '10mb' }), async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid playlist ID' });

    const { playlist: p, access } = await getPlaylistAndAccess(id, req.user);
    if (!p) return res.status(404).json({ error: 'Playlist not found' });

    if (!access?.canEdit) {
      return res.status(403).json({ error: 'Forbidden. Only authorized editors can change the playlist cover.' });
    }

    let imageBuffer: Buffer | null = null;
    let mimeType = 'image/jpeg';

    const contentType = req.headers['content-type'] || '';
    if (Buffer.isBuffer(req.body)) {
      if (contentType.includes('json') || req.body[0] === 0x7B) {
        try {
          const jsonBody = JSON.parse(req.body.toString('utf-8'));
          const b64 = jsonBody.base64 || jsonBody.image || jsonBody.cover || jsonBody.coverImage || jsonBody.cover_image || jsonBody.artwork || jsonBody.data;
          if (typeof b64 === 'string') {
            const matches = b64.match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
            if (matches) {
              mimeType = matches[1];
              imageBuffer = Buffer.from(matches[2], 'base64');
            } else {
              imageBuffer = Buffer.from(b64, 'base64');
            }
          }
        } catch (e) {
          imageBuffer = req.body;
        }
      } else {
        imageBuffer = req.body;
      }

      if (imageBuffer && !contentType.includes('json')) {
        if (contentType.includes('png')) mimeType = 'image/png';
        else if (contentType.includes('webp')) mimeType = 'image/webp';
        else if (contentType.includes('gif')) mimeType = 'image/gif';
        else if (contentType.includes('jpeg') || contentType.includes('jpg')) mimeType = 'image/jpeg';
      }
    } else if (req.body && typeof req.body === 'object') {
      const b64 = (req.body as any).base64 || (req.body as any).image || (req.body as any).cover || (req.body as any).coverImage || (req.body as any).cover_image || (req.body as any).artwork || (req.body as any).data;
      if (typeof b64 === 'string') {
        const matches = b64.match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
        if (matches) {
          mimeType = matches[1];
          imageBuffer = Buffer.from(matches[2], 'base64');
        } else {
          imageBuffer = Buffer.from(b64, 'base64');
        }
      }
    }

    if (!imageBuffer || imageBuffer.length === 0) {
      return res.status(400).json({ error: 'No valid image data provided' });
    }

    if (imageBuffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image file too large (max 10MB)' });
    }

    let isValidImage = false;
    let ext = '.jpg';
    if (imageBuffer[0] === 0xFF && imageBuffer[1] === 0xD8 && imageBuffer[2] === 0xFF) {
      isValidImage = true;
      ext = '.jpg';
      mimeType = 'image/jpeg';
    } else if (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50 && imageBuffer[2] === 0x4E && imageBuffer[3] === 0x47) {
      isValidImage = true;
      ext = '.png';
      mimeType = 'image/png';
    } else if (imageBuffer[0] === 0x52 && imageBuffer[1] === 0x49 && imageBuffer[2] === 0x46 && imageBuffer[3] === 0x46 && imageBuffer[8] === 0x57 && imageBuffer[9] === 0x45 && imageBuffer[10] === 0x42 && imageBuffer[11] === 0x50) {
      isValidImage = true;
      ext = '.webp';
      mimeType = 'image/webp';
    } else if (imageBuffer[0] === 0x47 && imageBuffer[1] === 0x49 && imageBuffer[2] === 0x46) {
      isValidImage = true;
      ext = '.gif';
      mimeType = 'image/gif';
    } else {
      if (contentType.includes('image/')) {
        isValidImage = true;
        if (contentType.includes('png')) ext = '.png';
        else if (contentType.includes('webp')) ext = '.webp';
        else if (contentType.includes('gif')) ext = '.gif';
        else ext = '.jpg';
      }
    }

    if (!isValidImage) {
      return res.status(400).json({ error: 'Invalid or unsupported image format. Supported formats: JPEG, PNG, WebP, GIF.' });
    }

    const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');
    const coversDir = path.join(dataDir, 'playlist_covers');
    if (!fs.existsSync(coversDir)) {
      fs.mkdirSync(coversDir, { recursive: true });
    }

    if (p.coverPath) {
      const oldPath = path.join(dataDir, 'playlist_covers', path.basename(p.coverPath));
      if (fs.existsSync(oldPath)) {
        try { fs.unlinkSync(oldPath); } catch (e) {}
      }
    }

    const filename = `playlist_${id}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
    const filePath = path.join(coversDir, filename);
    fs.writeFileSync(filePath, imageBuffer);

    const now = new Date();
    const updated = await db.update(playlists)
      .set({ coverPath: filename, updatedAt: now })
      .where(eq(playlists.id, id))
      .returning();

    res.json({
      ...updated[0],
      isPublic: updated[0].isPublic === 1,
      isOwner: access.isOwner,
      canEdit: access.canEdit,
      permission: access.isOwner ? 'owner' : (access.sharePermission || 'none'),
      coverImageUrl: `/api/playlists/${id}/cover`,
    });
  } catch (error) {
    console.error('Failed to upload playlist cover:', error);
    res.status(500).json({ error: 'Failed to upload playlist cover' });
  }
});

// Delete playlist cover image
router.delete('/:id/cover', async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid playlist ID' });

    const { playlist: p, access } = await getPlaylistAndAccess(id, req.user);
    if (!p) return res.status(404).json({ error: 'Playlist not found' });

    if (!access?.canEdit) {
      return res.status(403).json({ error: 'Forbidden. Only authorized editors can remove the playlist cover.' });
    }

    const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');
    if (p.coverPath) {
      const filePath = path.join(dataDir, 'playlist_covers', path.basename(p.coverPath));
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }
    }

    const now = new Date();
    const updated = await db.update(playlists)
      .set({ coverPath: null, updatedAt: now })
      .where(eq(playlists.id, id))
      .returning();

    res.json({
      ...updated[0],
      isPublic: updated[0].isPublic === 1,
      isOwner: access.isOwner,
      canEdit: access.canEdit,
      permission: access.isOwner ? 'owner' : (access.sharePermission || 'none'),
      coverImageUrl: null,
    });
  } catch (error) {
    console.error('Failed to delete playlist cover:', error);
    res.status(500).json({ error: 'Failed to delete playlist cover' });
  }
});

// Update playlist details (PUT/PATCH) -> Owner or Admin
const handlePlaylistUpdate = async (req: AuthenticatedRequest, res: any) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid playlist ID' });

    const { playlist, access } = await getPlaylistAndAccess(id, req.user);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

    if (!access?.isOwner && !access?.isAdmin) {
      return res.status(403).json({ error: 'Forbidden. Only the owner or administrator can edit playlist details.' });
    }

    const parsed = playlistUpdateSchema.parse(req.body);
    const updateData: any = { updatedAt: new Date() };
    if (parsed.name !== undefined) updateData.name = parsed.name.trim();
    if (parsed.description !== undefined) updateData.description = parsed.description?.trim() || null;
    if (parsed.isPublic !== undefined) updateData.isPublic = parsed.isPublic ? 1 : 0;

    // Admin-only ownership change
    if (access.isAdmin) {
      const targetUserId = parsed.userId || parsed.ownerId;
      if (targetUserId) {
        const targetUser = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
        if (targetUser.length > 0) {
          updateData.userId = targetUserId;
        }
      } else if (parsed.ownerUsername) {
        const targetUser = await db.select().from(users).where(eq(users.username, parsed.ownerUsername.trim())).limit(1);
        if (targetUser.length > 0) {
          updateData.userId = targetUser[0].id;
        }
      }
    }

    const updated = await db.update(playlists).set(updateData).where(eq(playlists.id, id)).returning();

    // Re-fetch with owner name
    const updatedWithUser = await db.select({
      id: playlists.id,
      userId: playlists.userId,
      name: playlists.name,
      description: playlists.description,
      isPublic: playlists.isPublic,
      coverPath: playlists.coverPath,
      createdAt: playlists.createdAt,
      updatedAt: playlists.updatedAt,
      ownerName: users.username,
    })
    .from(playlists)
    .leftJoin(users, eq(playlists.userId, users.id))
    .where(eq(playlists.id, id))
    .limit(1);

    const result = updatedWithUser[0] || updated[0];

    res.json({
      ...result,
      isPublic: result.isPublic === 1,
      isOwner: result.userId === req.user?.id,
      canEdit: true,
      permission: result.userId === req.user?.id ? 'owner' : (access.isAdmin ? 'admin' : (access.sharePermission || 'none')),
      coverImageUrl: result.coverPath ? `/api/playlists/${id}/cover` : null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.issues });
    } else {
      res.status(500).json({ error: 'Failed to update playlist' });
    }
  }
};

router.put('/:id', handlePlaylistUpdate);
router.patch('/:id', handlePlaylistUpdate);

// Duplicate playlist (View permission required)
router.post('/:id/duplicate', async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid playlist ID' });

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { playlist: p, access } = await getPlaylistAndAccess(id, req.user);
    if (!p) return res.status(404).json({ error: 'Playlist not found' });

    if (!access?.canView) {
      return res.status(403).json({ error: 'Forbidden. Access denied.' });
    }

    const now = new Date();
    const newName = req.body?.name?.trim() || `${p.name} (Copy)`;

    // If original has cover, duplicate cover file
    let newCoverFilename: string | null = null;
    const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');
    if (p.coverPath) {
      const oldCoverFile = path.join(dataDir, 'playlist_covers', path.basename(p.coverPath));
      if (fs.existsSync(oldCoverFile)) {
        const ext = path.extname(p.coverPath);
        newCoverFilename = `playlist_copy_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
        const newCoverFile = path.join(dataDir, 'playlist_covers', newCoverFilename);
        try {
          fs.copyFileSync(oldCoverFile, newCoverFile);
        } catch (e) {
          newCoverFilename = null;
        }
      }
    }

    const created = await db.insert(playlists).values({
      userId,
      name: newName,
      description: p.description,
      isPublic: 0,
      coverPath: newCoverFilename,
      createdAt: now,
      updatedAt: now,
    }).returning();

    const newPlaylistId = created[0].id;

    // Copy songs
    const originalSongs = await db.select().from(playlistSongs)
      .where(eq(playlistSongs.playlistId, id))
      .orderBy(asc(playlistSongs.position), asc(playlistSongs.addedAt));

    if (originalSongs.length > 0) {
      for (const s of originalSongs) {
        await db.insert(playlistSongs).values({
          playlistId: newPlaylistId,
          songId: s.songId,
          position: s.position,
          addedAt: now,
        });
      }
    }

    res.status(201).json({
      ...created[0],
      isPublic: false,
      isOwner: true,
      canEdit: true,
      permission: 'owner',
      songCount: originalSongs.length,
      coverImageUrl: newCoverFilename ? `/api/playlists/${newPlaylistId}/cover` : null,
    });
  } catch (error) {
    console.error('Failed to duplicate playlist:', error);
    res.status(500).json({ error: 'Failed to duplicate playlist' });
  }
});

// Clear all songs from playlist (Edit permission required)
router.post('/:id/clear', async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid playlist ID' });

    const { playlist, access } = await getPlaylistAndAccess(id, req.user);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

    if (!access?.canEdit) {
      return res.status(403).json({ error: 'Forbidden. You do not have permission to clear this playlist.' });
    }

    await db.delete(playlistSongs).where(eq(playlistSongs.playlistId, id));
    await db.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, id));

    res.json({ message: 'Playlist cleared successfully' });
  } catch (error) {
    console.error('Failed to clear playlist:', error);
    res.status(500).json({ error: 'Failed to clear playlist' });
  }
});

router.delete('/:id/songs', async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid playlist ID' });

    const { playlist, access } = await getPlaylistAndAccess(id, req.user);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

    if (!access?.canEdit) {
      return res.status(403).json({ error: 'Forbidden. You do not have permission to clear this playlist.' });
    }

    await db.delete(playlistSongs).where(eq(playlistSongs.playlistId, id));
    await db.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, id));

    res.json({ message: 'Playlist cleared successfully' });
  } catch (error) {
    console.error('Failed to clear playlist songs:', error);
    res.status(500).json({ error: 'Failed to clear playlist songs' });
  }
});

// Delete playlist -> Owner ONLY
router.delete('/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid playlist ID' });

    const { playlist, access } = await getPlaylistAndAccess(id, req.user);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

    if (!access?.isOwner && !access?.isAdmin) {
      return res.status(403).json({ error: 'Forbidden. Only the owner can delete this playlist.' });
    }

    const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');
    if (playlist.coverPath) {
      const coverFilePath = path.join(dataDir, 'playlist_covers', path.basename(playlist.coverPath));
      if (fs.existsSync(coverFilePath)) {
        try { fs.unlinkSync(coverFilePath); } catch (e) {}
      }
    }

    await db.delete(playlistShares).where(eq(playlistShares.playlistId, id));
    await db.delete(playlistSongs).where(eq(playlistSongs.playlistId, id));
    await db.delete(playlists).where(eq(playlists.id, id));

    res.json({ message: 'Playlist deleted successfully' });
  } catch (error) {
    console.error('Failed to delete playlist:', error);
    res.status(500).json({ error: 'Failed to delete playlist' });
  }
});

// Add song to playlist (Owner or Edit)
router.post('/:id/songs', async (req: AuthenticatedRequest, res) => {
  try {
    const playlistId = parseInt(req.params.id);
    if (isNaN(playlistId)) return res.status(400).json({ error: 'Invalid playlist ID' });

    const { songId, position } = req.body;
    const sId = Number(songId);
    if (!songId || isNaN(sId)) {
      return res.status(400).json({ error: 'Valid songId is required' });
    }

    const { playlist, access } = await getPlaylistAndAccess(playlistId, req.user);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

    if (!access?.canEdit) {
      return res.status(403).json({ error: 'Forbidden. You do not have permission to modify this playlist.' });
    }

    const song = await db.select().from(songs).where(eq(songs.id, sId)).limit(1);
    if (song.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }

    // Check duplicate policy (prevent duplicate songs within a playlist)
    const duplicateCheck = await db.select()
      .from(playlistSongs)
      .where(and(eq(playlistSongs.playlistId, playlistId), eq(playlistSongs.songId, sId)))
      .limit(1);

    if (duplicateCheck.length > 0) {
      return res.status(400).json({ error: 'Song is already in this playlist' });
    }

    let itemPos = Number(position);
    if (isNaN(itemPos)) {
      const currSongs = await db.select({ position: playlistSongs.position })
        .from(playlistSongs)
        .where(eq(playlistSongs.playlistId, playlistId));
      itemPos = currSongs.length > 0 ? Math.max(...currSongs.map(s => s.position)) + 1 : 0;
    }

    const inserted = await db.insert(playlistSongs).values({
      playlistId,
      songId: sId,
      position: itemPos,
      addedAt: new Date(),
    }).returning();

    await db.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, playlistId));

    res.status(201).json(inserted[0]);
  } catch (error) {
    console.error('Failed to add song to playlist:', error);
    res.status(500).json({ error: 'Failed to add song to playlist' });
  }
});

// Reorder playlist songs (Owner or Edit)
router.patch('/:id/songs/reorder', async (req: AuthenticatedRequest, res) => {
  try {
    const playlistId = parseInt(req.params.id);
    if (isNaN(playlistId)) return res.status(400).json({ error: 'Invalid playlist ID' });

    const { playlist, access } = await getPlaylistAndAccess(playlistId, req.user);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

    if (!access?.canEdit) {
      return res.status(403).json({ error: 'Forbidden. You do not have permission to modify this playlist.' });
    }

    const { songIds, items } = req.body;

    if (Array.isArray(songIds)) {
      for (let i = 0; i < songIds.length; i++) {
        const sId = Number(songIds[i]);
        if (!isNaN(sId)) {
          await db.update(playlistSongs)
            .set({ position: i })
            .where(and(eq(playlistSongs.playlistId, playlistId), eq(playlistSongs.songId, sId)));
        }
      }
    } else if (Array.isArray(items)) {
      for (const item of items) {
        const pos = Number(item.position);
        if (!isNaN(pos)) {
          if (item.songId) {
            await db.update(playlistSongs)
              .set({ position: pos })
              .where(and(eq(playlistSongs.playlistId, playlistId), eq(playlistSongs.songId, Number(item.songId))));
          } else if (item.playlistSongId || item.id) {
            const entryId = Number(item.playlistSongId || item.id);
            await db.update(playlistSongs)
              .set({ position: pos })
              .where(and(eq(playlistSongs.playlistId, playlistId), eq(playlistSongs.id, entryId)));
          }
        }
      }
    } else {
      return res.status(400).json({ error: 'Invalid reorder payload.' });
    }

    await db.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, playlistId));

    res.json({ message: 'Playlist songs reordered successfully' });
  } catch (error) {
    console.error('Failed to reorder playlist songs:', error);
    res.status(500).json({ error: 'Failed to reorder playlist songs' });
  }
});

// Remove song from playlist (Owner or Edit)
router.delete('/:id/songs/:songOrEntryId', async (req: AuthenticatedRequest, res) => {
  try {
    const playlistId = parseInt(req.params.id);
    const targetId = parseInt(req.params.songOrEntryId);
    if (isNaN(playlistId) || isNaN(targetId)) return res.status(400).json({ error: 'Invalid IDs' });

    const { playlist, access } = await getPlaylistAndAccess(playlistId, req.user);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

    if (!access?.canEdit) {
      return res.status(403).json({ error: 'Forbidden. You do not have permission to modify this playlist.' });
    }

    let deleted = await db.delete(playlistSongs)
      .where(and(eq(playlistSongs.id, targetId), eq(playlistSongs.playlistId, playlistId)))
      .returning();

    if (deleted.length === 0) {
      deleted = await db.delete(playlistSongs)
        .where(and(eq(playlistSongs.songId, targetId), eq(playlistSongs.playlistId, playlistId)))
        .returning();
    }

    if (deleted.length === 0) {
      return res.status(404).json({ error: 'Song entry not found in playlist' });
    }

    await db.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, playlistId));

    res.json({ message: 'Song removed from playlist successfully' });
  } catch (error) {
    console.error('Failed to remove song from playlist:', error);
    res.status(500).json({ error: 'Failed to remove song from playlist' });
  }
});

// ==========================================
// SHARED PLAYLIST ENDPOINTS
// ==========================================

const shareSchema = z.object({
  username: z.string().min(1),
  permission: z.enum(['view', 'edit']).default('view')
});

// List collaborators
router.get('/:id/collaborators', async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid playlist ID' });

    const { playlist, access } = await getPlaylistAndAccess(id, req.user);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

    if (!access?.canView) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const shares = await db.select({
      id: playlistShares.id,
      userId: users.id,
      username: users.username,
      permission: playlistShares.permission,
      createdAt: playlistShares.createdAt
    })
    .from(playlistShares)
    .innerJoin(users, eq(playlistShares.userId, users.id))
    .where(eq(playlistShares.playlistId, id))
    .orderBy(asc(users.username));

    res.json(shares);
  } catch (error) {
    res.status(500).json({ error: 'Failed to list collaborators' });
  }
});

// Share playlist with a user (Owner ONLY)
router.post('/:id/share', async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid playlist ID' });

    const { playlist, access } = await getPlaylistAndAccess(id, req.user);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

    if (!access?.isOwner && !access?.isAdmin) {
      return res.status(403).json({ error: 'Forbidden. Only owner can share.' });
    }

    const parsed = shareSchema.parse(req.body);

    const targetUser = await db.select().from(users).where(eq(users.username, parsed.username)).limit(1);
    if (targetUser.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (targetUser[0].id === playlist.userId) {
      return res.status(400).json({ error: 'Cannot share with the owner' });
    }

    // Upsert the share
    const existingShare = await db.select().from(playlistShares)
      .where(and(eq(playlistShares.playlistId, id), eq(playlistShares.userId, targetUser[0].id)))
      .limit(1);

    if (existingShare.length > 0) {
      await db.update(playlistShares)
        .set({ permission: parsed.permission })
        .where(eq(playlistShares.id, existingShare[0].id));
      
      return res.json({ message: 'Share updated', permission: parsed.permission });
    } else {
      const inserted = await db.insert(playlistShares).values({
        playlistId: id,
        userId: targetUser[0].id,
        permission: parsed.permission,
        createdAt: new Date()
      }).returning();
      
      return res.status(201).json(inserted[0]);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.issues });
    } else {
      res.status(500).json({ error: 'Failed to share playlist' });
    }
  }
});

// Remove collaborator (Owner ONLY)
router.delete('/:id/share/:userId', async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    const targetUserId = parseInt(req.params.userId);
    if (isNaN(id) || isNaN(targetUserId)) return res.status(400).json({ error: 'Invalid ID' });

    const { playlist, access } = await getPlaylistAndAccess(id, req.user);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

    if (!access?.isOwner && !access?.isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await db.delete(playlistShares)
      .where(and(eq(playlistShares.playlistId, id), eq(playlistShares.userId, targetUserId)));

    res.json({ message: 'Collaborator removed' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove collaborator' });
  }
});

// Leave shared playlist (Collaborator)
router.post('/:id/leave', async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid playlist ID' });
    
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const deleted = await db.delete(playlistShares)
      .where(and(eq(playlistShares.playlistId, id), eq(playlistShares.userId, userId)))
      .returning();

    if (deleted.length === 0) {
      return res.status(404).json({ error: 'You are not a collaborator on this playlist' });
    }

    res.json({ message: 'Successfully left the playlist' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to leave playlist' });
  }
});

export default router;
