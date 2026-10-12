import { Router } from 'express';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { db } from '../db/index.js';
import { sessions, controllers, queueItems, songs, artists, albums, songArtists, users, settings, lyrics, libraries, playlistSongs } from '../db/schema.js';
import { downloadQueue } from '../lib/download-queue.js';
import { resolveUrlOrQuery } from './downloader.js';
import { eq, and, asc, or, inArray, like, sql } from 'drizzle-orm';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '../middleware/auth.js';
import crypto from 'crypto';
import { 
  notifyQueueUpdate, 
  closeSessionWS, 
  handleHostHeartbeat, 
  advanceQueueBySessionId, 
  getRoomState,
  getOrCreateRoom,
  broadcastLyricSettingsToSession,
  broadcastLyricSettingsToAllActiveRooms,
  broadcastBackgroundMusicSettingsToAllActiveRooms,
  broadcastToRoom,
  updateRoomHostId
} from '../ws/index.js';
import { formatArtistDisplay, parseArtists } from '../lib/artist-utils.js';
import { getSongArtistsMap } from './songs.js';
import { findExistingSongRecord } from '../lib/scanner.js';
import { DEFAULT_LYRICS_SETTINGS, resolveLyricsSettings, LyricsAppearanceSettings } from '../lib/lyrics-settings.js';
import { withSessionLock } from '../lib/session-lock.js';

const router = Router();
router.use(requireAuth);

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');
const fontsDir = path.join(dataDir, 'fonts');
if (!fs.existsSync(fontsDir)) {
  fs.mkdirSync(fontsDir, { recursive: true });
}

function getFontMimeType(filenameOrExt: string): string {
  const ext = path.extname(filenameOrExt).toLowerCase();
  switch (ext) {
    case '.ttf':
      return 'font/ttf';
    case '.otf':
      return 'font/otf';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

function detectFontTypeFromBuffer(buf: Buffer): { ext: string; mime: string } | null {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x00 && buf[1] === 0x01 && buf[2] === 0x00 && buf[3] === 0x00) {
    return { ext: '.ttf', mime: 'font/ttf' };
  }
  const magic4 = buf.subarray(0, 4).toString('ascii');
  if (magic4 === 'true' || magic4 === 'typ1') {
    return { ext: '.ttf', mime: 'font/ttf' };
  }
  if (magic4 === 'OTTO') {
    return { ext: '.otf', mime: 'font/otf' };
  }
  if (magic4 === 'wOFF') {
    return { ext: '.woff', mime: 'font/woff' };
  }
  if (magic4 === 'wOF2') {
    return { ext: '.woff2', mime: 'font/woff2' };
  }
  if (magic4 === 'ttcf') {
    return { ext: '.ttf', mime: 'font/ttf' };
  }
  return null;
}

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Global Lyric Appearance Settings (Host defaults)
router.get('/settings/lyrics', async (req, res) => {
  try {
    const saved = await db.select().from(settings).where(eq(settings.key, 'lyrics_appearance_settings')).limit(1);
    if (saved.length > 0 && saved[0].value) {
      try {
        const resolved = resolveLyricsSettings(JSON.parse(saved[0].value));
        return res.json({ settings: resolved });
      } catch (e) {
        // ignore parse error
      }
    }
    res.json({ settings: DEFAULT_LYRICS_SETTINGS });
  } catch (error) {
    console.error('Failed to fetch lyric settings:', error);
    res.status(500).json({ error: 'Failed to fetch lyric settings' });
  }
});

// Serve custom font file
router.get(['/settings/lyrics/custom-font', '/settings/lyrics/custom-font/:fontId'], async (req, res) => {
  try {
    let targetFileName = req.params.fontId;
    if (!targetFileName) {
      const saved = await db.select().from(settings).where(eq(settings.key, 'lyrics_appearance_settings')).limit(1);
      if (saved.length > 0 && saved[0].value) {
        try {
          const parsed = JSON.parse(saved[0].value);
          targetFileName = parsed.customFontId;
        } catch (e) {}
      }
    }

    if (!targetFileName || typeof targetFileName !== 'string') {
      return res.status(404).json({ error: 'No custom font configured' });
    }

    const safeBaseName = path.basename(targetFileName);
    const filePath = path.join(fontsDir, safeBaseName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Custom font file not found' });
    }

    const mime = getFontMimeType(safeBaseName);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(safeBaseName)}"`);
    return res.sendFile(filePath);
  } catch (err) {
    console.error('Failed to serve custom font:', err);
    res.status(500).json({ error: 'Failed to serve custom font' });
  }
});

// Upload and replace custom font file
router.post(
  '/settings/lyrics/custom-font',
  requireAdmin,
  express.raw({ type: ['font/*', 'application/x-font-*', 'application/font-*', 'application/octet-stream', 'application/json', 'multipart/form-data'], limit: '25mb' }),
  async (req: any, res: any) => {
    try {
      let fontBuffer: Buffer | null = null;
      let originalFilename = '';

      const headerFilename = req.headers['x-font-filename'] ? decodeURIComponent(String(req.headers['x-font-filename'])) : '';
      const queryFilename = typeof req.query.filename === 'string' ? req.query.filename : '';
      originalFilename = headerFilename || queryFilename || '';

      const contentType = req.headers['content-type'] || '';

      if (Buffer.isBuffer(req.body)) {
        if (contentType.includes('json') || (req.body.length > 0 && req.body[0] === 0x7B)) {
          try {
            const jsonBody = JSON.parse(req.body.toString('utf-8'));
            const b64 = jsonBody.base64 || jsonBody.data || jsonBody.font || jsonBody.file;
            if (jsonBody.filename || jsonBody.name) {
              originalFilename = jsonBody.filename || jsonBody.name;
            }
            if (typeof b64 === 'string') {
              const matches = b64.match(/^data:([^;]+);base64,(.+)$/);
              if (matches) {
                fontBuffer = Buffer.from(matches[2], 'base64');
              } else {
                fontBuffer = Buffer.from(b64, 'base64');
              }
            }
          } catch (e) {
            fontBuffer = req.body;
          }
        } else if (contentType.includes('multipart/form-data')) {
          const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
          if (boundaryMatch) {
            const boundary = boundaryMatch[1] || boundaryMatch[2];
            const rawStr = req.body.toString('binary');
            const parts = rawStr.split(`--${boundary}`);
            for (const part of parts) {
              const fnMatch = part.match(/filename="([^"]+)"/i);
              if (fnMatch) {
                originalFilename = fnMatch[1];
                const headerEnd = part.indexOf('\r\n\r\n');
                if (headerEnd !== -1) {
                  let partData = part.substring(headerEnd + 4);
                  if (partData.endsWith('\r\n')) {
                    partData = partData.substring(0, partData.length - 2);
                  }
                  fontBuffer = Buffer.from(partData, 'binary');
                  break;
                }
              }
            }
          }
          if (!fontBuffer) {
            fontBuffer = req.body;
          }
        } else {
          fontBuffer = req.body;
        }
      } else if (req.body && typeof req.body === 'object') {
        const b64 = req.body.base64 || req.body.data || req.body.font || req.body.file;
        if (req.body.filename || req.body.name) {
          originalFilename = req.body.filename || req.body.name;
        }
        if (typeof b64 === 'string') {
          const matches = b64.match(/^data:([^;]+);base64,(.+)$/);
          if (matches) {
            fontBuffer = Buffer.from(matches[2], 'base64');
          } else {
            fontBuffer = Buffer.from(b64, 'base64');
          }
        }
      }

      if (!fontBuffer || fontBuffer.length === 0) {
        return res.status(400).json({ error: 'No valid font file data provided.' });
      }

      if (fontBuffer.length > 25 * 1024 * 1024) {
        return res.status(400).json({ error: 'Font file exceeds 25MB limit.' });
      }

      const detected = detectFontTypeFromBuffer(fontBuffer);
      let ext = detected?.ext || '';
      let mimeType = detected?.mime || '';

      if (!ext && originalFilename) {
        const fileExt = path.extname(originalFilename).toLowerCase();
        if (['.ttf', '.otf', '.woff', '.woff2'].includes(fileExt)) {
          ext = fileExt;
          mimeType = getFontMimeType(fileExt);
        }
      }

      if (!ext) {
        return res.status(400).json({
          error: 'Unsupported font format. Please upload a valid .ttf, .otf, .woff, or .woff2 font file.'
        });
      }

      if (!originalFilename) {
        originalFilename = `custom_font${ext}`;
      }

      const safeFontId = `font_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
      const targetPath = path.join(fontsDir, safeFontId);

      fs.writeFileSync(targetPath, fontBuffer);

      const saved = await db.select().from(settings).where(eq(settings.key, 'lyrics_appearance_settings')).limit(1);
      const current = saved.length > 0 && saved[0].value ? JSON.parse(saved[0].value) : { ...DEFAULT_LYRICS_SETTINGS };
      const oldFontId = current.customFontId;

      const rawBaseName = path.basename(originalFilename, path.extname(originalFilename));
      const cleanBaseName = rawBaseName.replace(/[^a-zA-Z0-9_-]/g, '_') || 'CustomFont';
      const uniqueFontFamily = `YimlyCustom_${cleanBaseName}_${Date.now()}`;
      const customFontUrl = `/api/karaoke/settings/lyrics/custom-font/${safeFontId}`;

      const updatedSettings = resolveLyricsSettings({
        ...current,
        highlighted: {
          ...current.highlighted,
          font: 'custom'
        },
        unhighlighted: {
          ...current.unhighlighted,
          font: 'custom'
        },
        customFontName: uniqueFontFamily,
        customFontFileName: originalFilename,
        customFontId: safeFontId,
        customFontUrl,
        customFontMime: mimeType,
        customFontUpdatedAt: Date.now()
      });

      const jsonStr = JSON.stringify(updatedSettings);

      if (saved.length === 0) {
        await db.insert(settings).values({ key: 'lyrics_appearance_settings', value: jsonStr });
      } else {
        await db.update(settings).set({ value: jsonStr }).where(eq(settings.key, 'lyrics_appearance_settings'));
      }

      try {
        await db.update(sessions)
          .set({ lyricSettings: jsonStr, updatedAt: new Date() })
          .where(eq(sessions.status, 'active'));
      } catch (e) {}

      broadcastLyricSettingsToAllActiveRooms(updatedSettings);

      if (oldFontId && oldFontId !== safeFontId) {
        try {
          const oldPath = path.join(fontsDir, path.basename(oldFontId));
          if (fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
          }
        } catch (delErr) {
          console.warn('[KaraokeSettings] Failed to delete old custom font file:', delErr);
        }
      }

      return res.json({
        success: true,
        settings: updatedSettings,
        fontId: safeFontId,
        fontUrl: customFontUrl,
        fontName: uniqueFontFamily,
        filename: originalFilename
      });
    } catch (error) {
      console.error('Failed to upload custom font:', error);
      res.status(500).json({ error: 'Failed to upload custom font' });
    }
  }
);

// Delete/remove custom font
router.delete('/settings/lyrics/custom-font', requireAdmin, async (req: any, res: any) => {
  try {
    const saved = await db.select().from(settings).where(eq(settings.key, 'lyrics_appearance_settings')).limit(1);
    const current = saved.length > 0 && saved[0].value ? JSON.parse(saved[0].value) : { ...DEFAULT_LYRICS_SETTINGS };
    const oldFontId = current.customFontId;

    const updatedSettings = resolveLyricsSettings({
      ...current,
      highlighted: {
        ...current.highlighted,
        font: current.highlighted?.font === 'custom' ? 'manrope' : current.highlighted?.font
      },
      unhighlighted: {
        ...current.unhighlighted,
        font: current.unhighlighted?.font === 'custom' ? 'manrope' : current.unhighlighted?.font
      },
      customFontName: null,
      customFontFileName: null,
      customFontId: null,
      customFontUrl: null,
      customFontMime: null,
      customFontUpdatedAt: null
    });

    const jsonStr = JSON.stringify(updatedSettings);

    if (saved.length === 0) {
      await db.insert(settings).values({ key: 'lyrics_appearance_settings', value: jsonStr });
    } else {
      await db.update(settings).set({ value: jsonStr }).where(eq(settings.key, 'lyrics_appearance_settings'));
    }

    try {
      await db.update(sessions)
        .set({ lyricSettings: jsonStr, updatedAt: new Date() })
        .where(eq(sessions.status, 'active'));
    } catch (e) {}

    broadcastLyricSettingsToAllActiveRooms(updatedSettings);

    if (oldFontId) {
      try {
        const oldPath = path.join(fontsDir, path.basename(oldFontId));
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      } catch (delErr) {
        console.warn('[KaraokeSettings] Failed to delete removed custom font file:', delErr);
      }
    }

    return res.json({ success: true, settings: updatedSettings });
  } catch (error) {
    console.error('Failed to remove custom font:', error);
    res.status(500).json({ error: 'Failed to remove custom font' });
  }
});

const saveGlobalLyricsSettings = async (req: any, res: any) => {
  try {
    const raw = req.body?.settings || req.body;
    const resolved = resolveLyricsSettings(raw);
    const jsonStr = JSON.stringify(resolved);

    // Save to settings table
    const existing = await db.select().from(settings).where(eq(settings.key, 'lyrics_appearance_settings')).limit(1);
    if (existing.length === 0) {
      await db.insert(settings).values({ key: 'lyrics_appearance_settings', value: jsonStr });
    } else {
      await db.update(settings).set({ value: jsonStr }).where(eq(settings.key, 'lyrics_appearance_settings'));
    }

    // Also update any active sessions and broadcast to active rooms
    try {
      await db.update(sessions)
        .set({ lyricSettings: jsonStr, updatedAt: new Date() })
        .where(eq(sessions.status, 'active'));
    } catch (e) {
      // ignore
    }

    broadcastLyricSettingsToAllActiveRooms(resolved);

    res.json({ success: true, settings: resolved });
  } catch (error) {
    console.error('Failed to save lyric settings:', error);
    res.status(500).json({ error: 'Failed to save lyric settings' });
  }
};

router.put('/settings/lyrics', requireAdmin, saveGlobalLyricsSettings);
router.post('/settings/lyrics', requireAdmin, saveGlobalLyricsSettings);

// Background Music Settings endpoints
router.get('/settings/background-music', async (req, res) => {
  try {
    const saved = await db.select().from(settings).where(eq(settings.key, 'background_music_settings')).limit(1);
    if (saved.length > 0 && saved[0].value) {
      try {
        const parsed = JSON.parse(saved[0].value);
        const enabled = typeof parsed.enabled === 'boolean' ? parsed.enabled : true;
        const volume = typeof parsed.volume === 'number' && !isNaN(parsed.volume) ? Math.max(0, Math.min(100, Math.round(parsed.volume))) : 25;
        let playlistId: string | null = null;
        if (parsed.playlistId !== undefined && parsed.playlistId !== null) {
          const trimmed = String(parsed.playlistId).trim();
          if (trimmed !== '' && trimmed !== 'null' && trimmed !== 'undefined' && trimmed !== 'all') {
            playlistId = trimmed;
          }
        }
        const audioMode = (parsed.audioMode === 'instrumental' || parsed.audioMode === 'original')
          ? parsed.audioMode
          : 'original';
        return res.json({ settings: { enabled, volume, playlistId, audioMode } });
      } catch (e) {
        // ignore parse error
      }
    }
    res.json({ settings: { enabled: true, volume: 25, playlistId: null, audioMode: 'original' } });
  } catch (error) {
    console.error('Failed to fetch background music settings:', error);
    res.status(500).json({ error: 'Failed to fetch background music settings' });
  }
});

const saveBackgroundMusicSettingsHandler = async (req: any, res: any) => {
  try {
    const raw = req.body?.settings || req.body || {};
    const enabled = typeof raw.enabled === 'boolean' 
      ? raw.enabled 
      : (raw.enabled === 'true' || raw.enabled === 1 || raw.enabled === '1' ? true : raw.enabled === 'false' || raw.enabled === 0 || raw.enabled === '0' ? false : true);
    let volume = 25;
    if (typeof raw.volume === 'number' && !isNaN(raw.volume)) {
      volume = Math.max(0, Math.min(100, Math.round(raw.volume)));
    } else if (typeof raw.volume === 'string' && raw.volume.trim() !== '') {
      const parsed = parseInt(raw.volume, 10);
      if (!isNaN(parsed)) volume = Math.max(0, Math.min(100, parsed));
    }

    let playlistId: string | null = null;
    if (raw.playlistId !== undefined && raw.playlistId !== null) {
      const trimmed = String(raw.playlistId).trim();
      if (trimmed !== '' && trimmed !== 'null' && trimmed !== 'undefined' && trimmed !== 'all') {
        playlistId = trimmed;
      }
    }

    const audioMode = (raw.audioMode === 'instrumental' || raw.audioMode === 'original')
      ? raw.audioMode
      : 'original';

    const resolved = { enabled, volume, playlistId, audioMode };
    const jsonStr = JSON.stringify(resolved);

    const existing = await db.select().from(settings).where(eq(settings.key, 'background_music_settings')).limit(1);
    if (existing.length === 0) {
      await db.insert(settings).values({ key: 'background_music_settings', value: jsonStr });
    } else {
      await db.update(settings).set({ value: jsonStr }).where(eq(settings.key, 'background_music_settings'));
    }

    try {
      broadcastBackgroundMusicSettingsToAllActiveRooms(resolved);
    } catch (wsErr) {
      console.warn('[Karaoke] Failed to broadcast background music settings to rooms:', wsErr);
    }

    res.json({ success: true, settings: resolved });
  } catch (error) {
    console.error('Failed to save background music settings:', error);
    res.status(500).json({ error: 'Failed to save background music settings' });
  }
};

router.put('/settings/background-music', requireAdmin, saveBackgroundMusicSettingsHandler);
router.post('/settings/background-music', requireAdmin, saveBackgroundMusicSettingsHandler);

// Karaoke Startup Defaults endpoints
router.get(['/settings/karaoke-defaults', '/settings/defaults'], async (req, res) => {
  try {
    const saved = await db.select().from(settings).where(eq(settings.key, 'karaoke_startup_defaults')).limit(1);
    if (saved.length > 0 && saved[0].value) {
      try {
        const parsed = JSON.parse(saved[0].value);
        const audioMode = parsed.audioMode === 'original' || parsed.audioMode === 'instrumental' ? parsed.audioMode : 'instrumental';
        const lyricsMode = parsed.lyricsMode === 'lrc' || parsed.lyricsMode === 'elrc' ? parsed.lyricsMode : 'elrc';
        return res.json({ settings: { audioMode, lyricsMode } });
      } catch (e) {
        // ignore parse error
      }
    }
    res.json({ settings: { audioMode: 'instrumental', lyricsMode: 'elrc' } });
  } catch (error) {
    console.error('Failed to fetch karaoke startup defaults:', error);
    res.status(500).json({ error: 'Failed to fetch karaoke startup defaults' });
  }
});

const saveKaraokeDefaultsHandler = async (req: any, res: any) => {
  try {
    const raw = req.body?.settings || req.body || {};
    const audioMode = raw.audioMode === 'original' || raw.audioMode === 'instrumental'
      ? raw.audioMode
      : (raw.audio === 'original' || raw.audio === 'instrumental'
          ? raw.audio
          : (raw.variant === 'original' || raw.variant === 'instrumental'
              ? raw.variant
              : 'instrumental'));

    const lyricsMode = raw.lyricsMode === 'lrc' || raw.lyricsMode === 'elrc'
      ? raw.lyricsMode
      : (raw.lyrics === 'lrc' || raw.lyrics === 'elrc'
          ? raw.lyrics
          : (raw.lyricsFormat === 'lrc' || raw.lyricsFormat === 'elrc'
              ? raw.lyricsFormat
              : 'elrc'));

    const resolved = { audioMode, lyricsMode };
    const jsonStr = JSON.stringify(resolved);

    const existing = await db.select().from(settings).where(eq(settings.key, 'karaoke_startup_defaults')).limit(1);
    if (existing.length === 0) {
      await db.insert(settings).values({ key: 'karaoke_startup_defaults', value: jsonStr });
    } else {
      await db.update(settings).set({ value: jsonStr }).where(eq(settings.key, 'karaoke_startup_defaults'));
    }

    res.json({ success: true, settings: resolved });
  } catch (error) {
    console.error('Failed to save karaoke startup defaults:', error);
    res.status(500).json({ error: 'Failed to save karaoke startup defaults' });
  }
};

router.put(['/settings/karaoke-defaults', '/settings/defaults'], requireAdmin, saveKaraokeDefaultsHandler);
router.post(['/settings/karaoke-defaults', '/settings/defaults'], requireAdmin, saveKaraokeDefaultsHandler);

router.post('/sessions', async (req, res) => {
  try {
    const user = (req as any).user;
    const device = req.headers['user-agent'] || 'Unknown Device';
      
    const sessionId = crypto.randomUUID();
    let roomCode = generateRoomCode();
    
    // Ensure room code uniqueness
    let attempts = 0;
    while (attempts < 5) {
      const existing = await db.select().from(sessions).where(eq(sessions.roomCode, roomCode)).limit(1);
      if (existing.length === 0) break;
      roomCode = generateRoomCode();
      attempts++;
    }

    const hostId = user?.id;
    if (!hostId) {
      return res.status(401).json({ error: 'Authentication required to create a karaoke room' });
    }

    // Determine initial startup defaults (Instrumental & eLRC default)
    let initialAudioMode: 'instrumental' | 'original' = 'instrumental';
    let initialLyricsMode: 'elrc' | 'lrc' = 'elrc';
    try {
      const defaultsSaved = await db.select().from(settings).where(eq(settings.key, 'karaoke_startup_defaults')).limit(1);
      if (defaultsSaved.length > 0 && defaultsSaved[0].value) {
        const parsed = JSON.parse(defaultsSaved[0].value);
        if (parsed.audioMode === 'original' || parsed.audioMode === 'instrumental') {
          initialAudioMode = parsed.audioMode;
        }
        if (parsed.lyricsMode === 'elrc' || parsed.lyricsMode === 'lrc') {
          initialLyricsMode = parsed.lyricsMode;
        }
      }
    } catch (e) {}

    if (req.body?.audioMode === 'original' || req.body?.audioMode === 'instrumental') {
      initialAudioMode = req.body.audioMode;
    }
    if (req.body?.lyricsMode === 'elrc' || req.body?.lyricsMode === 'lrc') {
      initialLyricsMode = req.body.lyricsMode;
    }

    // Determine initial lyric settings
    let initialLyricsSettings = DEFAULT_LYRICS_SETTINGS;
    if (req.body?.lyricSettings) {
      initialLyricsSettings = resolveLyricsSettings(req.body.lyricSettings);
    } else {
      const globalSaved = await db.select().from(settings).where(eq(settings.key, 'lyrics_appearance_settings')).limit(1);
      if (globalSaved.length > 0 && globalSaved[0].value) {
        try {
          initialLyricsSettings = resolveLyricsSettings(JSON.parse(globalSaved[0].value));
        } catch (e) {
          // ignore
        }
      }
    }

    const inserted = await db.insert(sessions).values({
      id: sessionId,
      roomCode: `${roomCode.slice(0,3)} ${roomCode.slice(3)}`,
      hostId: hostId,
      hostDevice: device,
      lyricSettings: JSON.stringify(initialLyricsSettings),
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    res.json({
      ...inserted[0],
      lyricSettings: initialLyricsSettings,
      audioMode: initialAudioMode,
      lyricsMode: initialLyricsMode
    });
  } catch (error) {
    console.error('Failed to create room:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

router.post('/sessions/join', async (req, res) => {
  try {
    const { roomCode, code, session, sessionId, displayName, username, controllerId: clientControllerId } = req.body;
    const rawInput = (roomCode || code || session || sessionId || '').toString().trim();
    if (!rawInput) {
      return res.status(400).json({ error: 'Room code is required' });
    }
    const user = (req as any).user;
    const device = req.headers['user-agent'] || 'Unknown Device';

    const normalizedCode = rawInput.replace(/[\s-]+/g, '');
    const formattedCode = normalizedCode.length >= 6 
      ? `${normalizedCode.slice(0, 3)} ${normalizedCode.slice(3)}` 
      : normalizedCode;

    const matchedSession = await db.select().from(sessions).where(
      and(
        or(
          eq(sessions.roomCode, rawInput),
          eq(sessions.roomCode, formattedCode),
          eq(sessions.roomCode, normalizedCode),
          eq(sessions.id, rawInput),
          eq(sessions.id, normalizedCode)
        ),
        eq(sessions.status, 'active')
      )
    ).limit(1);

    if (matchedSession.length === 0) {
      return res.status(404).json({ error: 'Room not found or inactive' });
    }

    const matchedSessionId = matchedSession[0].id;

    // A Karaoke Guest is NOT a Yimly User and must NEVER create a record in the users table.
    // If the caller is already authenticated as a real Yimly user, associate user.id.
    // Otherwise, associate guestName with this temporary controller only.
    const userId = user?.id || null;
    const guestName = !userId ? ((displayName || username || 'Guest').trim() || 'Guest') : null;

    // Reconnection & Duplicate Join Prevention:
    // 1. If client provided an existing controllerId for this session, reuse it
    if (clientControllerId && typeof clientControllerId === 'string') {
      const existingCtrl = await db.select().from(controllers).where(
        and(eq(controllers.id, clientControllerId), eq(controllers.sessionId, matchedSessionId))
      ).limit(1);

      if (existingCtrl.length > 0) {
        await db.update(controllers).set({
          device,
          connectionState: 'connected',
          lastSeenTime: new Date(),
          guestName: guestName || existingCtrl[0].guestName
        }).where(eq(controllers.id, clientControllerId));

        return res.json({ sessionId: matchedSessionId, controllerId: clientControllerId });
      }
    }

    // 2. If logged in user already has a controller in this session, reuse it
    if (userId) {
      const existingUserCtrl = await db.select().from(controllers).where(
        and(eq(controllers.userId, userId), eq(controllers.sessionId, matchedSessionId))
      ).limit(1);

      if (existingUserCtrl.length > 0) {
        await db.update(controllers).set({
          device,
          connectionState: 'connected',
          lastSeenTime: new Date()
        }).where(eq(controllers.id, existingUserCtrl[0].id));

        return res.json({ sessionId: matchedSessionId, controllerId: existingUserCtrl[0].id });
      }
    }

    // 3. Otherwise create a new controller record
    const controllerId = crypto.randomUUID();
    await db.insert(controllers).values({
      id: controllerId,
      sessionId: matchedSessionId,
      userId: userId,
      guestName: guestName,
      device: device,
      connectionState: 'connected',
      lastSeenTime: new Date(),
    });

    res.json({ sessionId: matchedSessionId, controllerId });
  } catch (error) {
    console.error('Failed to join room:', error);
    res.status(500).json({ error: 'Failed to join room' });
  }
});

router.get('/active-sessions', async (req, res) => {
  try {
    // Only return active sessions
    const active = await db.select().from(sessions).where(eq(sessions.status, 'active'));
    res.json(active);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Explicitly End Session Endpoint
router.post('/sessions/:sessionId/end', async (req: any, res: any) => {
  try {
    const { sessionId } = req.params;
    const sessionRes = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    
    if (sessionRes.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const session = sessionRes[0];
    
    if (req.user?.role !== 'administrator' && session.hostId !== req.user?.id) {
      return res.status(403).json({ error: 'Forbidden. You are not the host of this session.' });
    }
    
    await db.update(sessions).set({ status: 'closed' }).where(eq(sessions.id, sessionId));
    await db.delete(queueItems).where(eq(queueItems.sessionId, sessionId));
    await db.update(controllers).set({ connectionState: 'disconnected' }).where(eq(controllers.sessionId, sessionId));
    closeSessionWS(sessionId);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to end session:', error);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

// Reassign Host Endpoint
router.post('/sessions/:sessionId/reassign-host', async (req: AuthenticatedRequest, res) => {
  try {
    const { sessionId } = req.params;
    const { newHostId } = req.body;

    if (!newHostId || typeof newHostId !== 'number') {
      return res.status(400).json({ error: 'Valid newHostId number is required' });
    }

    const sessionRes = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (sessionRes.length === 0 || sessionRes[0].status !== 'active') {
      return res.status(404).json({ error: 'Active session not found' });
    }

    const session = sessionRes[0];
    const user = req.user;

    if (!user || (user.role !== 'administrator' && session.hostId !== user.id)) {
      return res.status(403).json({ error: 'Forbidden. Only the current host or an administrator can reassign host.' });
    }

    const targetUser = await db.select().from(users).where(eq(users.id, newHostId)).limit(1);
    if (targetUser.length === 0) {
      return res.status(400).json({ error: 'Target host user not found' });
    }

    await db.update(sessions).set({
      hostId: newHostId,
      updatedAt: new Date()
    }).where(eq(sessions.id, sessionId));

    updateRoomHostId(sessionId, newHostId);

    broadcastToRoom(sessionId, {
      type: 'HOST_REASSIGNED',
      payload: {
        newHostId,
        newHostUsername: targetUser[0].username
      }
    });

    res.json({ success: true, sessionId, newHostId, newHostUsername: targetUser[0].username });
  } catch (error) {
    console.error('Failed to reassign host:', error);
    res.status(500).json({ error: 'Failed to reassign host' });
  }
});

// Participant Leave Endpoint
router.post('/sessions/:sessionId/leave', async (req: AuthenticatedRequest, res) => {
  try {
    const { sessionId } = req.params;
    const { controllerId } = req.body || {};
    const user = req.user;

    if (controllerId) {
      await db.update(controllers)
        .set({ connectionState: 'disconnected', lastSeenTime: new Date() })
        .where(and(eq(controllers.id, controllerId), eq(controllers.sessionId, sessionId)));
    } else if (user?.id) {
      await db.update(controllers)
        .set({ connectionState: 'disconnected', lastSeenTime: new Date() })
        .where(and(eq(controllers.userId, user.id), eq(controllers.sessionId, sessionId)));
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to process leave' });
  }
});

// Host Heartbeat Endpoint
router.post('/sessions/:sessionId/heartbeat', async (req: AuthenticatedRequest, res) => {
  try {
    const { sessionId } = req.params;
    const session = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (session.length === 0 || session[0].status !== 'active') {
      return res.status(410).json({ error: 'Session expired or not found', code: 'ROOM_EXPIRED' });
    }
    const user = req.user;
    if (!user || (user.role !== 'administrator' && session[0].hostId !== user.id)) {
      return res.status(403).json({ error: 'Forbidden. Only the room host can send heartbeats.' });
    }
    await handleHostHeartbeat(sessionId);
    res.json({ success: true, timestamp: Date.now() });
  } catch (error) {
    console.error('[HEARTBEAT] Failed:', error);
    res.status(500).json({ error: 'Failed to process heartbeat' });
  }
});

// Skip Track Endpoint
router.post('/sessions/:sessionId/skip', async (req: AuthenticatedRequest, res) => {
  try {
    const { sessionId } = req.params;
    const session = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (session.length === 0 || session[0].status !== 'active') {
      return res.status(410).json({ error: 'Session expired or not found', code: 'ROOM_EXPIRED' });
    }
    const user = req.user;
    if (!user || (user.role !== 'administrator' && session[0].hostId !== user.id)) {
      return res.status(403).json({ error: 'Forbidden. Only the room host can skip tracks.' });
    }
    await advanceQueueBySessionId(sessionId);
    res.json({ success: true });
  } catch (error) {
    console.error('[SKIP] Failed:', error);
    res.status(500).json({ error: 'Failed to advance queue' });
  }
});

// Validate Room & Controller Endpoint
router.get('/sessions/:sessionId/validate', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const role = (req.query.role as string) || 'guest';
    const controllerId = req.query.controllerId as string;

    const session = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (session.length === 0) {
      return res.status(404).json({ valid: false, error: 'Room not found', code: 'ROOM_NOT_FOUND' });
    }

    if (session[0].status !== 'active') {
      return res.status(410).json({ valid: false, error: 'This karaoke session has expired or ended', code: 'ROOM_EXPIRED' });
    }

    let lyricSettings = DEFAULT_LYRICS_SETTINGS;
    if (session[0].lyricSettings) {
      try {
        lyricSettings = resolveLyricsSettings(JSON.parse(session[0].lyricSettings));
      } catch (e) {
        // ignore
      }
    }

    if (role === 'guest') {
      if (!controllerId) {
        return res.status(403).json({ 
          valid: false, 
          error: 'Controller ID required for guest access', 
          code: 'CONTROLLER_REQUIRED' 
        });
      }

      const controller = await db.select().from(controllers).where(
        and(eq(controllers.id, controllerId), eq(controllers.sessionId, sessionId))
      ).limit(1);

      if (controller.length === 0) {
        return res.status(403).json({ 
          valid: false, 
          error: 'Invalid or expired guest controller ID for this room', 
          code: 'INVALID_CONTROLLER' 
        });
      }

      let guestUsername = 'Guest';
      if (controller[0].guestName) {
        guestUsername = controller[0].guestName;
      } else if (controller[0].userId) {
        const u = await db.select().from(users).where(eq(users.id, controller[0].userId)).limit(1);
        if (u.length > 0) {
          guestUsername = u[0].username;
        }
      }

      return res.json({
        valid: true,
        role: 'guest',
        session: session[0],
        controller: controller[0],
        guestUsername,
        lyricSettings
      });
    }

    // Role is host - verify authenticated user owns room or is admin
    const user = (req as any).user;
    if (!user || !user.id) {
      return res.status(401).json({ 
        valid: false, 
        error: 'Authentication required for host access', 
        code: 'AUTH_REQUIRED' 
      });
    }
    if (session[0].hostId !== user.id && user.role !== 'administrator') {
      return res.status(403).json({ 
        valid: false, 
        error: 'Forbidden: You are not the host of this karaoke room', 
        code: 'FORBIDDEN_NOT_HOST' 
      });
    }

    // Register host heartbeat
    await handleHostHeartbeat(sessionId);

    return res.json({
      valid: true,
      role: 'host',
      session: session[0],
      lyricSettings
    });
  } catch (error) {
    console.error('Failed to validate session:', error);
    res.status(500).json({ valid: false, error: 'Failed to validate session' });
  }
});

// Session-specific Lyric Settings GET & PUT
router.get('/sessions/:sessionId/lyrics-settings', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const live = getRoomState(sessionId);
    if (live) {
      return res.json({ sessionId, settings: live.lyricSettings });
    }

    const session = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (session.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    let resolved = DEFAULT_LYRICS_SETTINGS;
    if (session[0].lyricSettings) {
      try {
        resolved = resolveLyricsSettings(JSON.parse(session[0].lyricSettings));
      } catch (e) {
        // ignore
      }
    }

    res.json({ sessionId, settings: resolved });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch session lyric settings' });
  }
});

const updateSessionLyricsSettings = async (req: any, res: any) => {
  try {
    const { sessionId } = req.params;
    const session = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (session.length === 0 || session[0].status !== 'active') {
      return res.status(404).json({ error: 'Active session not found' });
    }

    const user = req.user;
    if (!user || (user.role !== 'administrator' && session[0].hostId !== user.id)) {
      return res.status(403).json({ error: 'Forbidden. Only the room host can update room lyric settings.' });
    }

    const raw = req.body?.settings || req.body;
    const resolved = resolveLyricsSettings(raw);
    const jsonStr = JSON.stringify(resolved);

    await db.update(sessions)
      .set({ lyricSettings: jsonStr, updatedAt: new Date() })
      .where(eq(sessions.id, sessionId));

    broadcastLyricSettingsToSession(sessionId, resolved);

    res.json({ success: true, sessionId, settings: resolved });
  } catch (error) {
    console.error('Failed to update session lyric settings:', error);
    res.status(500).json({ error: 'Failed to update session lyric settings' });
  }
};

router.put('/sessions/:sessionId/lyrics-settings', updateSessionLyricsSettings);
router.post('/sessions/:sessionId/lyrics-settings', updateSessionLyricsSettings);

router.get('/sessions/:sessionId/state', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await db.select().from(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.status, 'active'))).limit(1);
    if (session.length === 0) {
      return res.status(404).json({ error: 'Session not found or inactive' });
    }

    const queue = await db.select({
      id: queueItems.id,
      position: queueItems.position,
      status: queueItems.status,
      songTitle: songs.title,
      artistName: artists.name,
      userId: queueItems.userId,
      userName: users.username,
      guestName: queueItems.guestName,
      songId: songs.id,
      artworkPath: songs.artworkPath,
      tempTitle: queueItems.tempTitle,
      tempArtist: queueItems.tempArtist,
      tempArtworkUrl: queueItems.tempArtworkUrl,
      downloadStatus: queueItems.downloadStatus,
      downloadJobId: queueItems.downloadJobId,
      downloadTrackId: queueItems.downloadTrackId,
    })
    .from(queueItems)
    .leftJoin(songs, eq(queueItems.songId, songs.id))
    .leftJoin(artists, eq(songs.artistId, artists.id))
    .leftJoin(users, eq(queueItems.userId, users.id))
    .where(eq(queueItems.sessionId, sessionId))
    .orderBy(asc(queueItems.position));

    const songIds = queue.map(q => q.songId).filter(Boolean) as number[];
    const artistsMap = await getSongArtistsMap(songIds);

    const formattedQueue = queue.map(q => {
      const title = q.songTitle || q.tempTitle || 'Unknown Title';
      const artist = q.artistName || q.tempArtist || 'Unknown Artist';
      const trackArtists = q.songId ? (artistsMap.get(q.songId) || [{ id: 0, name: artist }]) : [{ id: 0, name: artist }];
      const singerDisplay = q.guestName || q.userName || 'Guest';
      return {
        ...q,
        songTitle: title,
        artistName: formatArtistDisplay(trackArtists),
        userName: singerDisplay,
        artists: trackArtists,
        hasArtwork: !!q.artworkPath || !!q.tempArtworkUrl,
        artworkPath: q.artworkPath || q.tempArtworkUrl,
      };
    });

    const liveState = (await getOrCreateRoom(sessionId)) || getRoomState(sessionId);
    let resolvedLyricSettings = DEFAULT_LYRICS_SETTINGS;
    if (liveState?.lyricSettings) {
      resolvedLyricSettings = liveState.lyricSettings;
    } else if (session[0].lyricSettings) {
      try {
        resolvedLyricSettings = resolveLyricsSettings(JSON.parse(session[0].lyricSettings));
      } catch (e) {
        // ignore
      }
    }

    res.json({
      session: {
        ...session[0],
        lyricSettings: resolvedLyricSettings
      },
      queue: formattedQueue,
      lyricSettings: resolvedLyricSettings,
      playback: liveState ? {
        playing: liveState.playing,
        position: liveState.position,
        currentSongId: liveState.currentSongId,
        currentQueueItemId: liveState.currentQueueItemId,
        variant: liveState.variant,
        lyricsFormat: liveState.lyricsFormat || 'elrc',
        lyricOffset: liveState.lyricOffset,
        lyricSettings: liveState.lyricSettings
      } : null
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch state' });
  }
});

// Add to Queue
router.post('/sessions/:sessionId/queue', async (req: AuthenticatedRequest, res) => {
  try {
    const { sessionId } = req.params;
    const { songId, controllerId } = req.body;
    const user = req.user;

    const session = await db.select().from(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.status, 'active'))).limit(1);
    if (session.length === 0) {
      return res.status(404).json({ error: 'Active session not found' });
    }

    return await withSessionLock(sessionId, async () => {
      let userId: number | null = null;
      let guestName: string | null = null;

      if (user?.id) {
        const isHostOrAdmin = Boolean(user.role === 'administrator' || user.id === session[0].hostId);
        if (!isHostOrAdmin) {
          const userCtrl = await db.select().from(controllers).where(
            and(eq(controllers.userId, user.id), eq(controllers.sessionId, sessionId))
          ).limit(1);
          if (userCtrl.length === 0) {
            const newCtrlId = crypto.randomUUID();
            await db.insert(controllers).values({
              id: newCtrlId,
              sessionId,
              userId: user.id,
              guestName: null,
              device: req.headers['user-agent'] || 'Unknown Device',
              connectionState: 'connected',
              lastSeenTime: new Date()
            });
          }
        }
        userId = user.id;
      } else {
        if (!controllerId) {
          return res.status(403).json({ error: 'Valid controller ID or authentication required to queue songs in this room' });
        }
        const ctrl = await db.select().from(controllers).where(
          and(eq(controllers.id, controllerId), eq(controllers.sessionId, sessionId))
        ).limit(1);
        if (ctrl.length === 0) {
          return res.status(403).json({ error: 'Invalid or expired controller ID for this room' });
        }
        userId = ctrl[0].userId || null;
        guestName = ctrl[0].guestName || (req.body?.guestName ? String(req.body.guestName).trim() : 'Guest');
      }

      let finalSongId: number | null = null;
      let tempTitle: string | null = null;
      let tempArtist: string | null = null;
      let tempArtworkUrl: string | null = null;
      let downloadJobId: string | null = null;
      let downloadTrackId: string | null = null;
      let downloadStatus: string | null = null;

      if (songId) {
        const song = await db.select().from(songs).where(eq(songs.id, Number(songId))).limit(1);
        if (song.length === 0) {
          return res.status(404).json({ error: 'Song not found' });
        }
        finalSongId = Number(songId);
      } else if (req.body.track) {
        const { track } = req.body;

        let existingLocalSong: any = null;
        try {
          const parsedArtistNames = parseArtists(track.artist);
          const artistIds: number[] = [];
          for (const aName of parsedArtistNames) {
            const trimmed = aName.trim();
            if (!trimmed) continue;
            const matchedArtist = await db.select({ id: artists.id })
              .from(artists)
              .where(sql`LOWER(TRIM(${artists.name})) = LOWER(TRIM(${trimmed}))`)
              .limit(1);
            if (matchedArtist.length > 0) {
              artistIds.push(matchedArtist[0].id);
            }
          }

          if (artistIds.length > 0 && artistIds.length === parsedArtistNames.length) {
            const allLibs = await db.select({ id: libraries.id }).from(libraries);
            for (const lib of allLibs) {
              const found = await findExistingSongRecord(lib.id, track.title, artistIds);
              if (found) {
                existingLocalSong = found;
                break;
              }
            }
          }
        } catch (scanErr) {
          console.warn('[QUEUE] Error checking existing local library song:', scanErr);
        }

        if (existingLocalSong) {
          finalSongId = existingLocalSong.id;
          tempTitle = null;
          tempArtist = null;
          tempArtworkUrl = null;
          downloadJobId = null;
          downloadTrackId = null;
          downloadStatus = null;
        } else {
          tempTitle = track.title;
          tempArtist = track.artist;
          tempArtworkUrl = track.artworkUrl || null;
          
          const dup = await db.select().from(queueItems).where(
            and(
              sql`(${queueItems.downloadStatus} = 'downloading' OR ${queueItems.downloadStatus} = 'processing')`,
              eq(queueItems.tempTitle, track.title),
              eq(queueItems.tempArtist, track.artist)
            )
          ).limit(1);

          if (dup.length > 0 && dup[0].downloadJobId && dup[0].downloadTrackId) {
            downloadJobId = dup[0].downloadJobId;
            downloadTrackId = dup[0].downloadTrackId;
            downloadStatus = dup[0].downloadStatus || 'downloading';
          } else {
            let targetLib;
            const allLibs = await db.select().from(libraries).limit(1);
            if (allLibs.length > 0) {
              targetLib = allLibs[0];
            } else {
              return res.status(400).json({ error: 'No media library configured in Yimly. Please configure a library in Settings first.' });
            }

            const allSettings = await db.select().from(settings);
            const settingsMap = new Map(allSettings.map((s) => [s.key, s.value]));
            
            let finalProviders = ['lrclib'];
            if (settingsMap.has('downloader_lyrics_providers')) {
              try {
                const parsed = JSON.parse(settingsMap.get('downloader_lyrics_providers')!);
                if (Array.isArray(parsed) && parsed.length > 0) {
                  finalProviders = parsed;
                }
              } catch (e) {}
            }

            const activeJob = await downloadQueue.addJob({
              playlistName: 'Karaoke Room Queue',
              libraryId: targetLib.id,
              libraryPath: targetLib.path,
              format: (settingsMap.get('downloader_format') || 'mp3') as any,
              quality: settingsMap.get('downloader_quality') || '320k',
              embedMetadata: settingsMap.get('downloader_embed_metadata') !== 'false',
              embedArtwork: settingsMap.get('downloader_embed_artwork') !== 'false',
              downloadLyrics: false,
              lyricsProviders: finalProviders,
              folderStructure: settingsMap.get('downloader_folder_structure') || '{artist}/{artist} - {title}',
              playlistFolder: false,
              tracks: [{
                title: track.title,
                artist: track.artist,
                album: track.album || 'Single',
                duration: track.duration,
                artworkUrl: track.artworkUrl,
                sourceUrl: track.sourceUrl || null,
              }],
            });

            downloadJobId = activeJob.id;
            downloadTrackId = activeJob.tracks[0].id;
            downloadStatus = 'downloading';
          }
        }
      } else {
        return res.status(400).json({ error: 'Either songId or track metadata is required' });
      }

      const existingQueue = await db.select({ position: queueItems.position }).from(queueItems).where(eq(queueItems.sessionId, sessionId));
      const nextPosition = existingQueue.length > 0 ? Math.max(...existingQueue.map(q => q.position)) + 1 : 1;

      const inserted = await db.insert(queueItems).values({
        sessionId,
        songId: finalSongId,
        userId,
        guestName,
        addedAt: new Date(),
        position: nextPosition,
        tempTitle,
        tempArtist,
        tempArtworkUrl,
        downloadJobId,
        downloadTrackId,
        downloadStatus,
      }).returning();

      notifyQueueUpdate(sessionId);
      
      res.json(inserted[0]);
    });
  } catch (error) {
    console.error('[QUEUE] Failed to add to queue:', error);
    res.status(500).json({ error: 'Failed to add to queue' });
  }
});

// Remove item from Queue (Host, Admin, or Requester)
router.delete('/sessions/:sessionId/queue/:queueItemId', async (req: AuthenticatedRequest, res) => {
  try {
    const { sessionId, queueItemId } = req.params;
    const { controllerId } = req.body || {};
    const user = req.user;

    const sessionRes = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (sessionRes.length === 0 || sessionRes[0].status !== 'active') {
      return res.status(404).json({ error: 'Active session not found' });
    }
    const session = sessionRes[0];

    return await withSessionLock(sessionId, async () => {
      const qItem = await db.select().from(queueItems).where(
        and(eq(queueItems.id, Number(queueItemId)), eq(queueItems.sessionId, sessionId))
      ).limit(1);

      if (qItem.length === 0) {
        return res.status(404).json({ error: 'Queue item not found' });
      }

      const isHostOrAdmin = Boolean(user && (user.role === 'administrator' || user.id === session.hostId));
      let isOwner = false;
      if (user?.id && qItem[0].userId === user.id) {
        isOwner = true;
      } else if (controllerId) {
        const ctrl = await db.select().from(controllers).where(
          and(eq(controllers.id, controllerId), eq(controllers.sessionId, sessionId))
        ).limit(1);
        if (ctrl.length > 0 && ctrl[0].guestName && ctrl[0].guestName === qItem[0].guestName) {
          isOwner = true;
        }
      }

      if (!isHostOrAdmin && !isOwner) {
        return res.status(403).json({ error: 'Forbidden. Only the host, administrator, or song requester can remove this song from the queue.' });
      }

      const wasPlaying = qItem[0].status === 'playing';

      await db.delete(queueItems).where(eq(queueItems.id, Number(queueItemId)));

      if (wasPlaying) {
        await advanceQueueBySessionId(sessionId);
      } else {
        notifyQueueUpdate(sessionId);
      }

      res.json({ success: true, deletedQueueItemId: Number(queueItemId) });
    });
  } catch (error) {
    console.error('Failed to delete queue item:', error);
    res.status(500).json({ error: 'Failed to delete queue item' });
  }
});

// Reorder Queue Endpoint (Host Only)
router.post('/sessions/:sessionId/queue/reorder', async (req: AuthenticatedRequest, res) => {
  try {
    const { sessionId } = req.params;
    const { itemIds } = req.body;

    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ error: 'itemIds array is required' });
    }

    const sessionRes = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    if (sessionRes.length === 0 || sessionRes[0].status !== 'active') {
      return res.status(404).json({ error: 'Active session not found' });
    }
    const session = sessionRes[0];
    const user = req.user;

    if (!user || (user.role !== 'administrator' && session.hostId !== user.id)) {
      return res.status(403).json({ error: 'Forbidden. Only the room host can reorder the queue.' });
    }

    return await withSessionLock(sessionId, async () => {
      for (let idx = 0; idx < itemIds.length; idx++) {
        await db.update(queueItems)
          .set({ position: idx + 1 })
          .where(and(eq(queueItems.id, Number(itemIds[idx])), eq(queueItems.sessionId, sessionId)));
      }
      notifyQueueUpdate(sessionId);
      res.json({ success: true });
    });
  } catch (error) {
    console.error('Failed to reorder queue:', error);
    res.status(500).json({ error: 'Failed to reorder queue' });
  }
});

// Guest-scoped songs catalog for karaoke room queueing (minimal metadata, no filesystem paths)
router.get('/songs', async (req, res) => {
  try {
    const playlistIdQuery = req.query.playlistId ? parseInt(req.query.playlistId as string, 10) : null;
    let allSongs;

    const audioModeQuery = (req.query.audioMode as string)?.toLowerCase();

    if (playlistIdQuery && !isNaN(playlistIdQuery)) {
      allSongs = await db.select({
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
        artworkPath: songs.artworkPath,
        albumArtworkPath: albums.artworkPath,
        mainAudioPath: songs.mainAudioPath,
        instrumentalAudioPath: songs.instrumentalAudioPath,
      })
      .from(playlistSongs)
      .innerJoin(songs, eq(playlistSongs.songId, songs.id))
      .leftJoin(artists, eq(songs.artistId, artists.id))
      .leftJoin(albums, eq(songs.albumId, albums.id))
      .where(eq(playlistSongs.playlistId, playlistIdQuery))
      .orderBy(asc(playlistSongs.position));
    } else {
      allSongs = await db.select({
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
        artworkPath: songs.artworkPath,
        albumArtworkPath: albums.artworkPath,
        mainAudioPath: songs.mainAudioPath,
        instrumentalAudioPath: songs.instrumentalAudioPath,
      })
      .from(songs)
      .leftJoin(artists, eq(songs.artistId, artists.id))
      .leftJoin(albums, eq(songs.albumId, albums.id));
    }

    const songIds = allSongs.map(s => s.id);
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

    let formatted = allSongs.map(s => {
      const trackArtists = artistsMap.get(s.id) || (s.artist ? [{ id: s.artistId, name: s.artist }] : []);
      const lyr = lyricsMap.get(s.id) || { hasLrc: false, hasElrc: false };
      const hasOriginal = !!(s.mainAudioPath && s.mainAudioPath.trim().length > 0) || (s.variant === 'original' && !s.instrumentalAudioPath);
      const hasInstrumental = !!(s.instrumentalAudioPath && s.instrumentalAudioPath.trim().length > 0) || s.variant === 'instrumental';
      return {
        id: s.id,
        title: s.title,
        artist: formatArtistDisplay(trackArtists.length > 0 ? trackArtists : s.artist),
        artists: trackArtists,
        album: s.album,
        duration: s.duration,
        variant: s.variant,
        hasArtwork: !!s.artworkPath || !!s.albumArtworkPath,
        hasLrc: lyr.hasLrc,
        hasElrc: lyr.hasElrc,
        hasOriginal,
        hasInstrumental,
      };
    });

    if (audioModeQuery === 'instrumental') {
      formatted = formatted.filter(s => s.hasInstrumental);
    } else if (audioModeQuery === 'original') {
      formatted = formatted.filter(s => s.hasOriginal);
    }

    res.json(formatted);
  } catch (error) {
    console.error('[KARAOKE] Failed to fetch songs:', error);
    res.status(500).json({ error: 'Failed to fetch karaoke songs' });
  }
});

// Guest-scoped songs search for karaoke room queueing
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q as string;
    if (!q) return res.json({ library: [], external: [] });

    const searchStr = `%${q}%`;

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
      duration: songs.duration,
      variant: songs.variant,
    })
    .from(songs)
    .leftJoin(artists, eq(songs.artistId, artists.id))
    .leftJoin(albums, eq(songs.albumId, albums.id))
    .where(
      or(
        like(songs.title, searchStr),
        like(artists.name, searchStr),
        like(albums.title, searchStr),
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
      const lyr = lyricsMap.get(s.id) || { hasLrc: false, hasElrc: false };
      return {
        id: s.id,
        title: s.title,
        artist: formatArtistDisplay(trackArtists.length > 0 ? trackArtists : s.artist),
        artists: trackArtists,
        album: s.album,
        duration: s.duration,
        variant: s.variant,
        hasArtwork: !!s.artworkPath || !!s.albumArtworkPath,
        hasLrc: lyr.hasLrc,
        hasElrc: lyr.hasElrc,
      };
    });

    let externalResults: any[] = [];
    try {
      const resolved = await resolveUrlOrQuery(q);
      if (resolved && Array.isArray(resolved.tracks)) {
        externalResults = resolved.tracks.map((t: any) => ({
          title: t.title || 'Unknown Title',
          artist: t.artist || 'Unknown Artist',
          album: t.album || 'Single',
          trackNumber: t.trackNumber,
          discNumber: t.discNumber,
          releaseYear: t.releaseYear,
          artworkUrl: t.artworkUrl,
          duration: t.duration,
          sourceUrl: t.sourceUrl,
          isDownloadResult: true,
        }));
      }
    } catch (itErr) {
      console.warn('[SEARCH] External resolution failed:', itErr);
    }

    res.json({
      library: formatted,
      external: externalResults
    });
  } catch (error) {
    res.status(500).json({ error: 'Karaoke search failed' });
  }
});

export default router;
