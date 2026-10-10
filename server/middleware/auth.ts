import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    username: string;
    role: string;
  };
}

export const isPublicRoute = (req: Request): boolean => {
  const url = (req.originalUrl || req.url || '').split('?')[0];
  const method = req.method.toUpperCase();

  // Public Setup endpoints
  if (url === '/api/setup/status' || (method === 'POST' && url === '/api/setup')) {
    return true;
  }

  // Public Auth endpoints
  if (method === 'POST' && (url === '/api/auth/login' || url === '/api/auth/logout')) {
    return true;
  }

  // Public Karaoke session joining
  if (method === 'POST' && url === '/api/karaoke/sessions/join') {
    return true;
  }

  // Active sessions query
  if (method === 'GET' && url === '/api/karaoke/active-sessions') {
    return true;
  }

  // Public Karaoke session validation, state query, leave, heartbeat, lyrics-settings for room participants
  if (/^\/api\/karaoke\/sessions\/[^\/]+\/(validate|state|leave|heartbeat|lyrics-settings)$/.test(url)) {
    return true;
  }

  // Global lyrics appearance, background music, and karaoke default settings for hosts & rooms (and custom font file serving)
  if (method === 'GET' && (/^\/api\/karaoke\/settings\/(lyrics|background-music|karaoke-defaults|defaults)(\/custom-font(\/[^\/]+)?)?$/.test(url) || /^\/api\/lyrics\/custom-font(\/[^\/]+)?$/.test(url))) {
    return true;
  }

  // Guest song catalog & search for karaoke rooms (minimal scoped data for queueing)
  if (method === 'GET' && (url === '/api/karaoke/songs' || url === '/api/karaoke/search')) {
    return true;
  }

  // Direct artwork serving
  if (method === 'GET' && /^\/api\/artwork\/[^\/]+$/.test(url)) {
    return true;
  }

  // Active song playback, stream, lyrics, artwork & lyric offset (needed for TV/room player & connected displays)
  if ((method === 'GET' || method === 'HEAD') && (/^\/api\/songs\/\d+(\/(artwork|audio|stream|lyrics(\/offset)?))?$/.test(url) || /^\/api\/stream\/\d+(\/audio)?$/.test(url))) {
    return true;
  }

  if ((method === 'PUT' || method === 'POST' || method === 'PATCH') && /^\/api\/songs\/\d+\/lyrics\/offset$/.test(url)) {
    return true;
  }

  if (method === 'GET' && /^\/api\/(artists|albums)\/\d+\/artwork$/.test(url)) {
    return true;
  }

  return false;
};

export const requireAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const isExempt = isPublicRoute(req);
  console.log(`[AUTH] request to ${req.originalUrl} (public exempt: ${isExempt})`);
  const token = req.cookies?.yimly_token || req.headers.authorization?.split(' ')[1];

  if (!token) {
    if (isExempt) {
      console.log(`[AUTH] public exempt route ${req.method} ${req.originalUrl} allowed without token`);
      return next();
    }
    console.log(`[AUTH] authenticated-user failure: No token found. Cookies present: ${Object.keys(req.cookies || {})}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const userResult = await db.select({
      id: users.id,
      username: users.username,
      role: users.role
    }).from(users).where(eq(users.id, decoded.id)).limit(1);

    if (userResult.length === 0) {
      if (isExempt) {
        return next();
      }
      console.log(`[AUTH] authenticated-user failure: User not found in DB`);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log(`[AUTH] authenticated-user success: user ${userResult[0].username} authenticated`);
    req.user = userResult[0];
    next();
  } catch (error) {
    if (isExempt) {
      return next();
    }
    console.log(`[AUTH] authenticated-user failure: JWT verify failed - ${(error as Error).message}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

export const requireAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'administrator') {
    return res.status(403).json({ error: 'Forbidden. Administrator access required.' });
  }
  next();
};
