/**
 * Lyrics providers used to enrich downloaded audio files.
 * Ported directly from the official Downtify reference implementation:
 * https://github.com/henriquesebastiao/downtify (downtify/lyrics.py)
 * 
 * Supports lrclib (https://lrclib.net) with plain and time-synced (.lrc) lyrics.
 * Legacy identifiers (genius, musixmatch, azlyrics) are accepted for compatibility.
 */

import fs from 'fs';
import path from 'path';

export const LRCLIB_BASE = 'https://lrclib.net/api';
export const USER_AGENT = 'Downtify (https://github.com/henriquesebastiao/downtify)';
export const SUPPORTED_PROVIDERS = new Set(['lrclib']);
export const ALL_LYRICS_PROVIDERS = ['lrclib', 'genius', 'musixmatch', 'azlyrics'] as const;

export interface Lyrics {
  plain: string | null;
  synced: string | null;
}

export interface SongLyricsQuery {
  title: string;
  artists?: string[] | string;
  artist?: string;
  album?: string;
  duration?: number;
}

export function hasAnyLyrics(lyrics?: Lyrics | null): boolean {
  return Boolean(lyrics && (lyrics.plain || lyrics.synced));
}

/**
 * Filter lyrics providers based on the download_lyrics toggle and provider list.
 * Matches Downtify's _effective_lyrics_providers logic.
 */
export function computeEffectiveLyricsProviders(
  downloadLyrics: boolean,
  lyricsProviders: string[] = ['lrclib']
): string[] {
  if (!downloadLyrics) {
    return [];
  }
  return lyricsProviders.filter((p) => typeof p === 'string' && p.trim().length > 0);
}

/**
 * Checks if a string contains valid parseable lyrics or timestamps.
 * Returns true if the content has at least one valid timestamp line or parseable lyric lines.
 */
export function isLrcContentValid(content: string): boolean {
  if (!content || typeof content !== 'string') return false;
  const trimmed = content.trim();
  if (trimmed.length === 0) return false;

  const lines = trimmed.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    // Skip file metadata tags like [by:xyz], [offset:0], [re:xyz], [ti:xyz], [ar:xyz], [al:xyz], [au:xyz], [length:xyz]
    if (/^\[(by|re|ti|ar|al|au|length|offset|tool|ve|kana):/i.test(line)) {
      continue;
    }
    // Check for timestamp tag [mm:ss.xx] or word timestamp <mm:ss.xx>
    if (/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/.test(line) || /<\d{1,2}:\d{2}(?:\.\d{1,3})?>/.test(line)) {
      return true;
    }
  }

  // Fallback: Check if there's any non-tag text line
  const nonTagLines = lines.filter(l => {
    const t = l.trim();
    return t.length > 0 && !t.startsWith('[') && !t.startsWith('#');
  });
  return nonTagLines.length > 0;
}

/**
 * Removes timestamp tags from synced LRC lyrics to produce clean plain lyrics text.
 * Matches Downtify's _strip_lrc_timestamps logic.
 */
export function stripLrcTimestamps(synced: string): string {
  if (!synced) return '';
  const cleaned = synced.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, '');
  return cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Fetch lyrics from LRCLIB using exact match (/get) with optional search fallback.
 */
async function fetchLrclib(song: SongLyricsQuery): Promise<Lyrics | null> {
  let primaryArtist = '';
  if (Array.isArray(song.artists) && song.artists.length > 0) {
    primaryArtist = song.artists[0];
  } else if (typeof song.artists === 'string' && song.artists) {
    primaryArtist = song.artists.split(/[,/;&]|feat\.|ft\./i)[0].trim();
  } else if (song.artist) {
    primaryArtist = song.artist.split(/[,/;&]|feat\.|ft\./i)[0].trim();
  }

  const title = (song.title || '').trim();
  if (!title || !primaryArtist) {
    return null;
  }

  const cleanTitle = title.replace(/\s*\((?:official\s*(?:video|audio|music video)|audio|lyrics|lyric video|hd|4k|remastered)\)\s*/gi, '').trim() || title;

  // 1. First attempt: exact /get with track_name, artist_name, album, duration
  try {
    const params = new URLSearchParams();
    params.set('track_name', cleanTitle);
    params.set('artist_name', primaryArtist);
    
    if (song.album && song.album.trim() && !song.album.toLowerCase().includes('unknown') && !song.album.toLowerCase().includes('single')) {
      params.set('album_name', song.album.trim());
    }
    if (song.duration && Number(song.duration) > 0) {
      params.set('duration', String(Math.round(Number(song.duration))));
    }

    const url = `${LRCLIB_BASE}/get?${params.toString()}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10000),
    });

    if (response.status === 200) {
      const data = await response.json();
      const plain = (data.plainLyrics || '').trim() || null;
      const synced = (data.syncedLyrics || '').trim() || null;
      if (plain || synced) {
        return { plain, synced };
      }
    }
  } catch (err: any) {
    console.warn(`[LRCLIB] Exact query failed for "${title}" by "${primaryArtist}":`, err?.message || err);
  }

  // 2. Second attempt: /get without album/duration in case metadata fields mismatched
  try {
    const params = new URLSearchParams();
    params.set('track_name', cleanTitle);
    params.set('artist_name', primaryArtist);

    const url = `${LRCLIB_BASE}/get?${params.toString()}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });

    if (response.status === 200) {
      const data = await response.json();
      const plain = (data.plainLyrics || '').trim() || null;
      const synced = (data.syncedLyrics || '').trim() || null;
      if (plain || synced) {
        return { plain, synced };
      }
    }
  } catch (err: any) {
    console.warn(`[LRCLIB] Relaxed /get failed:`, err?.message || err);
  }

  // 3. Fallback: /search endpoint if exact match wasn't found
  try {
    const searchParams = new URLSearchParams();
    searchParams.set('track_name', cleanTitle);
    searchParams.set('artist_name', primaryArtist);

    const searchUrl = `${LRCLIB_BASE}/search?${searchParams.toString()}`;
    const searchRes = await fetch(searchUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });

    if (searchRes.status === 200) {
      const results = await searchRes.json();
      if (Array.isArray(results) && results.length > 0) {
        // Pick best matching result that has synced or plain lyrics
        const best = results.find((r: any) => Boolean(r.syncedLyrics || r.plainLyrics)) || results[0];
        const plain = (best.plainLyrics || '').trim() || null;
        const synced = (best.syncedLyrics || '').trim() || null;
        if (plain || synced) {
          return { plain, synced };
        }
      }
    }
  } catch (searchErr: any) {
    console.warn(`[LRCLIB] Search query fallback failed:`, searchErr?.message || searchErr);
  }

  return null;
}

const PROVIDER_FNS: Record<string, (song: SongLyricsQuery) => Promise<Lyrics | null>> = {
  lrclib: fetchLrclib,
};

/**
 * Main fetch function matching Downtify's `lyrics.fetch(song, providers)`:
 * Tries each configured provider in order and returns the first successful match.
 */
export async function fetchLyrics(
  song: SongLyricsQuery,
  providers: string[] = ['lrclib']
): Promise<Lyrics | null> {
  for (const name of providers) {
    if (!SUPPORTED_PROVIDERS.has(name)) {
      // Legacy UI stubs (genius, musixmatch, azlyrics) are skipped
      continue;
    }
    try {
      const providerFn = PROVIDER_FNS[name];
      if (providerFn) {
        const result = await providerFn(song);
        if (result && hasAnyLyrics(result)) {
          return result;
        }
      }
    } catch (err) {
      console.warn(`Lyrics provider "${name}" failed:`, err);
      continue;
    }
  }
  return null;
}

/**
 * Embeds lyrics and writes .lrc sidecar file next to the audio file.
 * Matches Downtify's `embed_lyrics` in downtify/downloader.py.
 */
export function saveLrcSidecar(audioFilePath: string, syncedLyrics: string): boolean {
  if (!syncedLyrics || !syncedLyrics.trim()) {
    return false;
  }

  try {
    const ext = path.extname(audioFilePath);
    const sidecarPath = ext ? audioFilePath.slice(0, -ext.length) + '.lrc' : `${audioFilePath}.lrc`;
    const targetDir = path.dirname(sidecarPath);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    fs.writeFileSync(sidecarPath, syncedLyrics.trim() + '\n', 'utf-8');
    console.log(`[Lyrics] Successfully wrote .lrc sidecar file: ${sidecarPath}`);
    return true;
  } catch (err) {
    console.warn(`[Lyrics] Could not write LRC sidecar next to ${audioFilePath}:`, err);
    return false;
  }
}
