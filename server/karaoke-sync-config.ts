import path from 'path';

export function getAppPythonPath(): string {
  if (process.env.PYTHON_BIN) {
    return process.env.PYTHON_BIN;
  }
  return 'python3';
}

export function getSplitScriptPath(): string {
  return path.join(process.cwd(), 'server', 'lib', 'split.py');
}

export function getModelsDir(): string {
  if (process.env.TORCH_HOME) {
    return process.env.TORCH_HOME;
  }
  return path.join(process.cwd(), 'data', 'models');
}

export function sanitizeLeadInMs(val: any): number {
  const num = typeof val === 'number' ? val : (typeof val === 'string' ? parseInt(val, 10) : NaN);
  if (isNaN(num) || !isFinite(num)) {
    return 500;
  }
  return Math.max(0, Math.min(5000, Math.round(num)));
}

let cachedLeadInMs: number | null = null;

export function setCachedLeadInMs(val: number): void {
  cachedLeadInMs = sanitizeLeadInMs(val);
}

export async function getElrcLineLeadInMsFromDb(): Promise<number> {
  try {
    const { db } = await import('./db/index.js');
    const { settings } = await import('./db/schema.js');
    const { eq } = await import('drizzle-orm');

    const row = await db.select().from(settings).where(eq(settings.key, 'downloader_elrc_line_lead_in_ms')).limit(1);
    if (row && row.length > 0 && row[0].value) {
      const sanitized = sanitizeLeadInMs(row[0].value);
      cachedLeadInMs = sanitized;
      return sanitized;
    }
  } catch (err) {
    // Fall back to cached or default
  }
  return cachedLeadInMs ?? 500;
}

export function getElrcLineLeadInMsSync(): number {
  return cachedLeadInMs ?? 500;
}

export function getSettings() {
  return {
    pythonPath: getAppPythonPath(),
    splitScriptPath: getSplitScriptPath(),
    modelsDir: getModelsDir(),
    ffmpegPath: 'ffmpeg',
    demucs: {
      model: 'htdemucs',
      stems: 'vocals',
      format: 'flac',
      mp3Bitrate: 320,
      shifts: 1,
      overlap: 0.25,
      useGpu: true,
    },
    lyrics: {
      fetchElrc: true,
      fetchLrc: true,
      overwriteExisting: false,
      elrcLineLeadInMs: getElrcLineLeadInMsSync(),
    },
  };
}

