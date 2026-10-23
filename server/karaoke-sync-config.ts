import { db } from './db/index.js';
import { settings } from './db/schema.js';
import { eq } from 'drizzle-orm';

let cachedLeadInMs = 500;

export function sanitizeLeadInMs(val: any): number {
  const parsed = Number(val);
  if (isNaN(parsed)) return 500;
  return Math.min(5000, Math.max(0, parsed));
}

export function setCachedLeadInMs(ms: number) {
  cachedLeadInMs = sanitizeLeadInMs(ms);
}

export async function getElrcLineLeadInMsFromDb(): Promise<number> {
  try {
    const [rec] = await db.select().from(settings).where(eq(settings.key, 'downloader_elrc_line_lead_in_ms')).limit(1);
    if (rec?.value !== undefined) {
      cachedLeadInMs = sanitizeLeadInMs(rec.value);
    }
  } catch {}
  return cachedLeadInMs;
}

export function getSettings() {
  return {
    pythonPath: process.env.PYTHON_PATH || 'python3',
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
    elrcLineLeadInMs: cachedLeadInMs,
    modelsDir: process.env.MODELS_DIR || './models',
    lyrics: {
      provider: 'lrclib',
      elrcLineLeadInMs: cachedLeadInMs,
    },
  };
}
