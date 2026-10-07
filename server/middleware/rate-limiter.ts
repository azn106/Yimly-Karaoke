import { Request, Response, NextFunction } from 'express';

interface RateLimitInfo {
  count: number;
  resetTime: number;
}

const ipCache = new Map<string, RateLimitInfo>();

// Clean up expired entries every minute to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, info] of ipCache.entries()) {
    if (now > info.resetTime) {
      ipCache.delete(ip);
    }
  }
}, 60 * 1000);

export function createRateLimiter(options: { windowMs: number; max: number; message: string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || 'unknown';
    const now = Date.now();
    const info = ipCache.get(ip);

    if (!info) {
      ipCache.set(ip, {
        count: 1,
        resetTime: now + options.windowMs
      });
      return next();
    }

    if (now > info.resetTime) {
      info.count = 1;
      info.resetTime = now + options.windowMs;
      return next();
    }

    info.count++;
    if (info.count > options.max) {
      res.setHeader('Retry-After', Math.ceil((info.resetTime - now) / 1000));
      return res.status(429).json({ error: options.message });
    }

    next();
  };
}
