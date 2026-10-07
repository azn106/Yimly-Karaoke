import { Router } from 'express';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { db } from '../db/index.js';
import { sessions, controllers, queueItems, songs, artists, albums, songArtists, users, settings, lyrics, libraries } from '../db/schema.js';
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
  broadcastLyricSettingsToSession,
  broadcastLyricSettingsToAllActiveRooms
} from '../ws/index.js';
import { formatArtistDisplay, parseArtists } from '../lib/artist-utils.js';
import { getSongArtistsMap } from './songs.js';
import { findExistingSongRecord } from '../lib/scanner.js';
import { DEFAULT_LYRICS_SETTINGS, resolveLyricsSettings, LyricsAppearanceSettings } from '../lib/lyrics-settings.js';

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

router.put('/settings/lyrics', saveGlobalLyricsSettings);
router.post('/settings/lyrics', saveGlobalLyricsSettings);

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
      lyricSettings: initialLyricsSettings
    });
  } catch (error) {
    console.error('Failed to create room:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

router.post('/sessions/join', async (req, res) => {
  try {
    const { roomCode, code, session, sessionId, displayName, username } = req.body;
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

    // A Karaoke Guest is NOT a Yimly User and must NEVER create a record in the users table.
    // If the caller is already authenticated as a real Yimly user, associate user.id.
    // Otherwise, associate guestName with this temporary controller only.
    const userId = user?.id || null;
    const guestName = !userId ? ((displayName || username || 'Guest').trim() || 'Guest') : null;

    const controllerId = crypto.randomUUID();
    await db.insert(controllers).values({
      id: controllerId,
      sessionId: matchedSession[0].id,
      userId: userId,
      guestName: guestName,
      device: device,
      lastSeenTime: new Date(),
    });

    res.json({ sessionId: matchedSession[0].id, controllerId });
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
    closeSessionWS(sessionId);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to end session:', error);
    res.status(500).json({ error: 'Failed to end session' });
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

    const liveState = getRoomState(sessionId);
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

    let userId: number | null = null;
    let guestName: string | null = null;

    if (user?.id) {
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

      // FIX 2: Check the existing Yimly library using the same song identity rules already used by the scanner.
      // If the exact song already exists in the library, do NOT start a download or create a downloader job.
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
        // Normal ready/pending local queue item directly with real songId:
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
        
        // Prevent duplicate active downloads for the same requested track:
        // If there is already an active queue item with downloadStatus === 'downloading' and same title and artist,
        // reuse its downloadJobId and downloadTrackId instead of starting a new download job.
        const dup = await db.select().from(queueItems).where(
          and(
            eq(queueItems.downloadStatus, 'downloading'),
            eq(queueItems.tempTitle, track.title),
            eq(queueItems.tempArtist, track.artist)
          )
        ).limit(1);

        if (dup.length > 0 && dup[0].downloadJobId && dup[0].downloadTrackId) {
          downloadJobId = dup[0].downloadJobId;
          downloadTrackId = dup[0].downloadTrackId;
          downloadStatus = 'downloading';
        } else {
          // 1. Resolve target library
          let targetLib;
          const allLibs = await db.select().from(libraries).limit(1);
          if (allLibs.length > 0) {
            targetLib = allLibs[0];
          } else {
            return res.status(400).json({ error: 'No media library configured in Yimly. Please configure a library in Settings first.' });
          }

          // 2. Read downloader settings from DB
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

          // 3. Queue download (enforce downloadLyrics: false for room downloads)
          const activeJob = await downloadQueue.addJob({
            playlistName: 'Karaoke Room Queue',
            libraryId: targetLib.id,
            libraryPath: targetLib.path,
            format: (settingsMap.get('downloader_format') || 'mp3') as any,
            quality: settingsMap.get('downloader_quality') || '320k',
            embedMetadata: settingsMap.get('downloader_embed_metadata') !== 'false',
            embedArtwork: settingsMap.get('downloader_embed_artwork') !== 'false',
            downloadLyrics: false, // enforce lyrics disabled for room downloads
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

    const existingQueue = await db.select().from(queueItems).where(eq(queueItems.sessionId, sessionId));
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
  } catch (error) {
    console.error('[QUEUE] Failed to add to queue:', error);
    res.status(500).json({ error: 'Failed to add to queue' });
  }
});

// Guest-scoped songs catalog for karaoke room queueing (minimal metadata, no filesystem paths)
router.get('/songs', async (req, res) => {
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
      artworkPath: songs.artworkPath,
      albumArtworkPath: albums.artworkPath,
    })
    .from(songs)
    .leftJoin(artists, eq(songs.artistId, artists.id))
    .leftJoin(albums, eq(songs.albumId, albums.id));

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

    const formatted = allSongs.map(s => {
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

    res.json(formatted);
  } catch (error) {
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
