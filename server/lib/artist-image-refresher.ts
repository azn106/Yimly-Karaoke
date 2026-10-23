import fs from 'fs';
import path from 'path';
import { db } from '../db/index.js';
import { artists, songs, libraries, songArtists } from '../db/schema.js';
import { eq, or, and, isNull } from 'drizzle-orm';
import { saveArtworkBuffer, getArtworkDir } from './scanner.js';

const activeArtistRefreshes = new Set<number>();
let activeBulkAbortController: AbortController | null = null;

// MusicBrainz asks clients to keep requests at or below one request per second.
// Share one queue across artist searches, ID validation, and recording lookups.
let musicBrainzQueue: Promise<void> = Promise.resolve();
let musicBrainzNextRequestAt = 0;

async function fetchMusicBrainz(url: string, timeoutMs: number): Promise<Response> {
  const headers = {
    'User-Agent': 'YimlyKaraoke/1.0 (https://github.com/azn106/Yimly-Karaoke)',
    'Accept': 'application/json',
  };
  const retryableStatuses = new Set([429, 500, 502, 503, 504]);
  const maxRetries = 2;

  for (let attempt = 0; ; attempt++) {
    // Keep every attempt, including retries, behind the same global rate limit.
    const slot = musicBrainzQueue.then(async () => {
      const waitMs = Math.max(0, musicBrainzNextRequestAt - Date.now());
      if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
      musicBrainzNextRequestAt = Date.now() + 1100;
    });
    musicBrainzQueue = slot.catch(() => undefined);
    await slot;

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!retryableStatuses.has(response.status) || attempt >= maxRetries) {
      return response;
    }

    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
    const retryDelayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
      ? Math.min(retryAfterSeconds * 1000, 5000)
      : 1200 * (attempt + 1);

    console.warn(`[MusicBrainz] HTTP ${response.status}; retrying in ${retryDelayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
    // Consume/cancel the response before retrying to release the connection.
    await response.body?.cancel().catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
  }
}

export interface MusicBrainzArtistCandidate {
  id: string;
  name: string;
  disambiguation?: string;
  country?: string;
  type?: string;
  score?: number;
}

export interface ArtistRefreshResult {
  artistId: number;
  artistName: string;
  status: 'updated' | 'unchanged' | 'unavailable' | 'ambiguous' | 'failed';
  provider?: 'fanart_tv' | 'none';
  error?: string;
  artworkUrl?: string;
  candidates?: MusicBrainzArtistCandidate[];
}

export interface BulkRefreshSummary {
  total: number;
  updated: number;
  unchanged: number;
  unavailable: number;
  ambiguous: number;
  failed: number;
  details: ArtistRefreshResult[];
  error?: string;
}

/**
 * Returns the configured Fanart.tv API key from environment, or null if unconfigured.
 */
export function getFanartTvApiKey(): string | null {
  const key = process.env.FANART_TV_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

/**
 * Normalizes artist name for robust, diacritics-insensitive, punctuation-insensitive matching.
 */
export function normalizeArtistNameForMatching(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/º|°/g, ' degrees')
    .replace(/98\s*degrees/g, '98 degrees')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/^the\s+/i, '') // strip leading article
    .replace(/[^\p{L}\p{N}\s]/gu, '') // strip punctuation/symbols
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Validates that an image download URL is safe (HTTP/HTTPS, non-internal, permitted provider host).
 */
export function isValidArtistImageUrl(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== 'string') return false;
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();

    // Prevent access to cloud metadata / link-local addresses
    if (host === '169.254.169.254' || host === '0.0.0.0') return false;

    const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.DATA_DIR?.includes('test'));
    if (!isTest) {
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        host.endsWith('.local') ||
        host.endsWith('.internal')
      ) {
        return false;
      }
      // Permitted provider domain: Fanart.tv CDN hosts
      const isAllowedProvider =
        host === 'fanart.tv' ||
        host.endsWith('.fanart.tv');
      if (!isAllowedProvider) return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Validates that binary buffer matches standard image magic bytes (JPEG, PNG, WebP, GIF).
 */
export function validateImageMagicBytes(buf: Buffer): boolean {
  if (!buf || buf.length < 8) return false;

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return true;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return true;
  }

  // GIF: GIF87a or GIF89a
  if (
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return true;
  }

  // WebP: RIFF....WEBP
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return true;
  }

  return false;
}

/**
 * Resolves an authoritative MusicBrainz artist ID by querying MusicBrainz with strict validation.
 */
export async function searchMusicBrainzArtists(
  artistName: string,
  timeoutMs = 8000,
  songTitle?: string,
  allowPartialMatches = false
): Promise<MusicBrainzArtistCandidate[]> {
  const cleanName = artistName.trim();
  if (!cleanName || cleanName.toLowerCase() === 'unknown artist') return [];

  const variations = [...new Set([normalizeArtistNameForMatching(cleanName), cleanName].filter(Boolean))];
  const targetNorm = normalizeArtistNameForMatching(cleanName);
  const matches = new Map<string, MusicBrainzArtistCandidate>();
  let successfulSearchResponse = false;
  let lastSearchFailure = '';

  for (const name of variations) {
    try {
      const searchUrl = `https://musicbrainz.org/ws/2/artist?query=artist:${encodeURIComponent(name)}&fmt=json`;
      const res = await fetchMusicBrainz(searchUrl, timeoutMs);
      if (!res.ok) {
        lastSearchFailure = `HTTP ${res.status}`;
        console.warn(`[MusicBrainz] Artist search returned HTTP ${res.status}`);
        continue;
      }
      const data = await res.json().catch(() => null);
      if (!data || !Array.isArray(data.artists)) {
        lastSearchFailure = 'invalid response';
        continue;
      }
      successfulSearchResponse = true;

      for (const artist of data.artists) {
        if (!artist?.id) continue;
        const names = [artist.name, artist.sortName, ...(Array.isArray(artist.aliases) ? artist.aliases.map((a: any) => a?.name) : [])]
          .filter((value): value is string => typeof value === 'string' && value.length > 0);
        if (!allowPartialMatches && !names.some(value => normalizeArtistNameForMatching(value) === targetNorm)) continue;
        matches.set(artist.id, {
          id: artist.id,
          name: artist.name || cleanName,
          ...(artist.disambiguation ? { disambiguation: artist.disambiguation } : {}),
          ...(artist.country ? { country: artist.country } : {}),
          ...(artist.type ? { type: artist.type } : {}),
          ...(typeof artist.score === 'number' ? { score: artist.score } : {}),
        });
      }
    } catch (err: any) {
      lastSearchFailure = err?.name === 'TimeoutError' || err?.name === 'AbortError'
        ? 'request timed out'
        : 'network request failed';
      // Try the next query variation; report an error only if every search failed.
    }
  }

  if (!successfulSearchResponse) {
    throw new Error(`MusicBrainz search failed (${lastSearchFailure || 'no valid response'}). Please try again shortly.`);
  }

  const candidates = [...matches.values()].sort((a, b) => (b.score || 0) - (a.score || 0));

  // When a library song title is available, use MusicBrainz recording credits as
  // corroborating evidence for ambiguous artist names. If the recording search
  // cannot confidently connect the title to one of these candidates, preserve
  // the original name-based candidate list rather than guessing.
  const cleanSongTitle = songTitle?.trim();
  if (cleanSongTitle && candidates.length > 1) {
    try {
      const recordingQuery = `recording:"${cleanSongTitle.replace(/["\\\\]/g, ' ')}" AND artist:"${cleanName.replace(/["\\\\]/g, ' ')}"`;
      const recordingUrl = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(recordingQuery)}&fmt=json&limit=100`;
      const recordingRes = await fetchMusicBrainz(recordingUrl, timeoutMs);
      if (recordingRes.ok) {
        const recordingData = await recordingRes.json().catch(() => null);
        const matchedArtistIds = new Set<string>();
        const targetTitle = normalizeArtistNameForMatching(cleanSongTitle);
        if (Array.isArray(recordingData?.recordings)) {
          for (const recording of recordingData.recordings) {
            if (normalizeArtistNameForMatching(String(recording?.title || '')) !== targetTitle) continue;
            const credits = Array.isArray(recording?.['artist-credit']) ? recording['artist-credit'] : [];
            for (const credit of credits) {
              const creditedArtist = credit?.artist;
              if (creditedArtist?.id) {
                matchedArtistIds.add(String(creditedArtist.id));
              } else if (typeof creditedArtist?.name === 'string') {
                const creditedName = normalizeArtistNameForMatching(creditedArtist.name);
                for (const candidate of candidates) {
                  if (normalizeArtistNameForMatching(candidate.name) === creditedName) matchedArtistIds.add(candidate.id);
                }
              }
            }
          }
        }
        if (matchedArtistIds.size > 0) {
          return candidates.sort((a, b) =>
            Number(matchedArtistIds.has(b.id)) - Number(matchedArtistIds.has(a.id)) ||
            (b.score || 0) - (a.score || 0)
          );
        }
      }
    } catch {
      // A recording lookup is supplemental; keep name-based candidates on failure.
    }
  }

  return candidates;
}

/**
 * Validates a MusicBrainz artist ID against MusicBrainz API.
 */
export async function validateMusicBrainzArtistId(
  mbid: string,
  timeoutMs = 8000
): Promise<{ valid: boolean; artist?: MusicBrainzArtistCandidate; error?: string }> {
  const cleanMbid = (mbid || '').trim();
  if (!cleanMbid || cleanMbid.length < 8) {
    return { valid: false, error: 'Invalid MusicBrainz ID format' };
  }

  try {
    const url = `https://musicbrainz.org/ws/2/artist/${encodeURIComponent(cleanMbid)}?fmt=json`;
    const res = await fetchMusicBrainz(url, timeoutMs);

    if (res.status === 404) {
      return { valid: false, error: 'Artist not found on MusicBrainz' };
    }
    if (!res.ok) {
      return { valid: false, error: `MusicBrainz returned HTTP ${res.status}` };
    }

    const data = await res.json().catch(() => null);
    if (!data) {
      return { valid: false, error: 'Malformed response from MusicBrainz' };
    }

    return {
      valid: true,
      artist: {
        id: data.id || cleanMbid,
        name: data.name || cleanMbid,
        disambiguation: data.disambiguation,
        country: data.country,
        type: data.type,
      },
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { valid: false, error: 'MusicBrainz request timed out' };
    }
    return { valid: false, error: err?.message || 'Error validating MusicBrainz ID' };
  }
}

export async function resolveMusicBrainzId(artistName: string, timeoutMs = 8000): Promise<string | null> {
  const candidates = await searchMusicBrainzArtists(artistName, timeoutMs);
  return candidates.length === 1 ? candidates[0].id : null;
}

/**
 * Inspects Fanart.tv API response schema to select genuine artist portraits.
 */
export function selectFanartTvArtistImage(data: any): string | null {
  if (!data || typeof data !== 'object') return null;

  // 1. Prefer artistthumb
  if (Array.isArray(data.artistthumb) && data.artistthumb.length > 0) {
    const sorted = [...data.artistthumb].sort((a, b) => Number(b.likes || 0) - Number(a.likes || 0));
    for (const item of sorted) {
      if (item && item.url && typeof item.url === 'string' && item.url.trim().length > 0) {
        return item.url.trim();
      }
    }
  }

  // 2. Fall back to artistbackground
  if (Array.isArray(data.artistbackground) && data.artistbackground.length > 0) {
    const sorted = [...data.artistbackground].sort((a, b) => Number(b.likes || 0) - Number(a.likes || 0));
    for (const item of sorted) {
      if (item && item.url && typeof item.url === 'string' && item.url.trim().length > 0) {
        return item.url.trim();
      }
    }
  }

  return null;
}

/**
 * Queries Fanart.tv API for an artist using their MusicBrainz ID and api-key header.
 */
export async function queryFanartTvArtist(
  mbid: string,
  timeoutMs = 8000
): Promise<{
  imageUrl: string | null;
  status: 'updated' | 'unavailable' | 'failed';
  error?: string;
}> {
  const apiKey = getFanartTvApiKey();
  if (!apiKey) {
    return {
      imageUrl: null,
      status: 'failed',
      error: 'Fanart.tv API key not configured.',
    };
  }

  const cleanMbid = mbid.trim();
  if (!cleanMbid) {
    return { imageUrl: null, status: 'unavailable', error: 'Missing MusicBrainz ID' };
  }

  try {
    const url = `https://webservice.fanart.tv/v3/music/${encodeURIComponent(cleanMbid)}`;
    const res = await fetch(url, {
      headers: {
        'api-key': apiKey,
        'User-Agent': 'YimlyKaraoke/1.0',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status === 404) {
      return { imageUrl: null, status: 'unavailable', error: 'Artist not found on Fanart.tv' };
    }
    if (res.status === 401 || res.status === 403) {
      return { imageUrl: null, status: 'failed', error: 'Invalid Fanart.tv API key' };
    }
    if (res.status === 429) {
      return { imageUrl: null, status: 'failed', error: 'Fanart.tv rate limit exceeded' };
    }
    if (!res.ok) {
      return { imageUrl: null, status: 'failed', error: `Fanart.tv returned HTTP ${res.status}` };
    }

    let data: any = null;
    try {
      data = await res.json();
    } catch {
      return { imageUrl: null, status: 'failed', error: 'Malformed JSON from Fanart.tv' };
    }

    const imageUrl = selectFanartTvArtistImage(data);
    if (!imageUrl) {
      return { imageUrl: null, status: 'unavailable', error: 'No portrait image found on Fanart.tv' };
    }

    return { imageUrl, status: 'updated' };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { imageUrl: null, status: 'failed', error: 'Fanart.tv request timed out' };
    }
    return { imageUrl: null, status: 'failed', error: err?.message || 'Error querying Fanart.tv' };
  }
}

/**
 * Resolves the verified filesystem directory where an artist's music is organized.
 * Strictly checks that candidate directories reside within their configured library path
 * to completely eliminate directory traversal risks and never derives paths from raw artist names.
 */
export async function resolveArtistDirectory(artistId: number): Promise<{ artistDir: string; libraryPath: string } | null> {
  const directSongs = await db.select({
    mainAudioPath: songs.mainAudioPath,
    instrumentalAudioPath: songs.instrumentalAudioPath,
    libraryId: songs.libraryId,
  })
  .from(songs)
  .where(eq(songs.artistId, artistId));

  const candidateSongPaths: Array<{ audioPath: string; libraryId: number }> = [];
  for (const s of directSongs) {
    const p = s.mainAudioPath || s.instrumentalAudioPath;
    if (p && s.libraryId) {
      candidateSongPaths.push({ audioPath: p, libraryId: s.libraryId });
    }
  }

  if (candidateSongPaths.length === 0) {
    const joinedSongs = await db.select({
      mainAudioPath: songs.mainAudioPath,
      instrumentalAudioPath: songs.instrumentalAudioPath,
      libraryId: songs.libraryId,
    })
    .from(songArtists)
    .innerJoin(songs, eq(songArtists.songId, songs.id))
    .where(eq(songArtists.artistId, artistId));

    for (const s of joinedSongs) {
      const p = s.mainAudioPath || s.instrumentalAudioPath;
      if (p && s.libraryId) {
        candidateSongPaths.push({ audioPath: p, libraryId: s.libraryId });
      }
    }
  }

  if (candidateSongPaths.length === 0) return null;

  // Collaborators have no audio stored in their own folder by design. Resolve their
  // artwork folder from the library root and artist name instead of the primary
  // artist's audio directory.
  if (directSongs.length === 0) {
    const [artist] = await db.select().from(artists).where(eq(artists.id, artistId)).limit(1);
    const linkedLibraryId = candidateSongPaths[0]?.libraryId;
    const linkedLibrary = linkedLibraryId
      ? await db.select().from(libraries).where(eq(libraries.id, linkedLibraryId)).limit(1)
      : [];
    const libraryPath = linkedLibrary[0]?.path ? path.resolve(linkedLibrary[0].path) : null;
    if (artist?.name && libraryPath) {
      const safeFolder = artist.name.replace(/[/\\?%*:|"<>]/g, '').trim().replace(/^\.+|\.+$/g, '') || 'Unknown';
      const artistDir = path.resolve(libraryPath, safeFolder);
      if (artistDir.startsWith(libraryPath + path.sep)) {
        return { artistDir, libraryPath };
      }
    }
  }

  const allLibs = await db.select().from(libraries);
  const libMap = new Map<number, string>();
  for (const lib of allLibs) {
    if (lib.path) {
      libMap.set(lib.id, path.resolve(lib.path));
    }
  }

  const dirCounts = new Map<string, { count: number; libraryPath: string }>();

  for (const { audioPath, libraryId } of candidateSongPaths) {
    const libPath = libMap.get(libraryId);
    if (!libPath) continue;

    const resolvedAudio = path.resolve(audioPath);
    if (!resolvedAudio.startsWith(libPath + path.sep)) continue;

    const rel = path.relative(libPath, resolvedAudio);
    const parts = rel.split(path.sep);

    if (parts.length >= 2) {
      const candidateArtistDir = path.resolve(libPath, parts[0]);
      if (candidateArtistDir.startsWith(libPath + path.sep)) {
        try {
          if (fs.existsSync(candidateArtistDir) && fs.statSync(candidateArtistDir).isDirectory()) {
            const current = dirCounts.get(candidateArtistDir) || { count: 0, libraryPath: libPath };
            current.count++;
            dirCounts.set(candidateArtistDir, current);
          }
        } catch {
          // ignore stat check errors
        }
      }
    }
  }

  if (dirCounts.size === 0) return null;

  let bestDir: string | null = null;
  let bestCount = -1;
  let bestLibPath = '';

  for (const [dir, data] of dirCounts.entries()) {
    if (data.count > bestCount) {
      bestCount = data.count;
      bestDir = dir;
      bestLibPath = data.libraryPath;
    }
  }

  if (!bestDir) return null;
  return { artistDir: bestDir, libraryPath: bestLibPath };
}

/**
 * Searches for valid local artist artwork within an artist's folder,
 * following Music Assistant metadata conventions with priority:
 * 1. artist.webp
 * 2. artist.jpg
 * 3. artist.jpeg
 * 4. artist.png
 * 5. artist.gif
 *
 * Matching is case-insensitive (e.g. Artist.WEBP). Validates minimum size
 * (>= 1024 bytes) and magic bytes. File descriptors are always closed safely.
 */
export function findLocalArtistArtwork(artistDir: string): string | null {
  let files: string[];
  try {
    if (!fs.existsSync(artistDir) || !fs.statSync(artistDir).isDirectory()) {
      return null;
    }
    files = fs.readdirSync(artistDir);
  } catch {
    return null;
  }

  const priorityNames = ['artist.webp', 'artist.jpg', 'artist.jpeg', 'artist.png', 'artist.gif'];
  for (const targetName of priorityNames) {
    const matchingFiles = files.filter(f => f.toLowerCase() === targetName);
    matchingFiles.sort((a, b) => (a === targetName ? -1 : b === targetName ? 1 : 0));

    for (const filename of matchingFiles) {
      const fullPath = path.join(artistDir, filename);
      let fd: number | null = null;
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && stat.size >= 1024) {
          fd = fs.openSync(fullPath, 'r');
          const buf = Buffer.alloc(16);
          const bytesRead = fs.readSync(fd, buf, 0, 16, 0);
          if (bytesRead >= 8 && validateImageMagicBytes(buf)) {
            return fullPath;
          }
        }
      } catch {
        // Continue checking other candidates
      } finally {
        if (fd !== null) {
          try {
            fs.closeSync(fd);
          } catch {
            // Ignore close error
          }
        }
      }
    }
  }

  return null;
}

export interface ArtistLocalRefreshResult {
  artistId: number;
  status: 'updated' | 'unchanged' | 'unavailable' | 'failed';
  artworkPath: string | null;
  hasArtwork: boolean;
  version: number | null;
  error?: string;
}

/**
 * Performs a local-only artwork refresh for the selected artist.
 * Inspects only that artist's folder, prioritises artist.webp, invalidates stale cached artwork,
 * updates the database record, and returns the file mtime version for cache-busting.
 * Never calls external APIs (MusicBrainz, Fanart.tv) or triggers library scans.
 */
export async function refreshArtistLocalArtwork(artistId: number): Promise<ArtistLocalRefreshResult> {
  if (typeof artistId !== 'number' || isNaN(artistId) || artistId <= 0) {
    return {
      artistId,
      status: 'failed',
      artworkPath: null,
      hasArtwork: false,
      version: null,
      error: 'Invalid artist ID',
    };
  }

  try {
    const [artist] = await db.select().from(artists).where(eq(artists.id, artistId)).limit(1);
    if (!artist) {
      return {
        artistId,
        status: 'failed',
        artworkPath: null,
        hasArtwork: false,
        version: null,
        error: 'Artist not found',
      };
    }

    const dirInfo = await resolveArtistDirectory(artistId);
    let localArtPath: string | null = null;
    if (dirInfo?.artistDir) {
      localArtPath = findLocalArtistArtwork(dirInfo.artistDir);
    }

    if (localArtPath) {
      // Invalidate/delete previous cached artwork in dataDir/artwork if exists
      if (artist.artworkPath && artist.artworkPath !== localArtPath) {
        try {
          const artworkDir = getArtworkDir();
          const candidateOldCached = path.isAbsolute(artist.artworkPath)
            ? artist.artworkPath
            : path.join(artworkDir, artist.artworkPath);
          const resolvedCached = path.resolve(candidateOldCached);
          const resolvedArtworkDir = path.resolve(artworkDir);
          if (resolvedCached.startsWith(resolvedArtworkDir + path.sep)) {
            if (fs.existsSync(resolvedCached)) {
              fs.unlinkSync(resolvedCached);
            }
          }
        } catch {
          // Ignore cache deletion error
        }
      }

      let version: number | null = null;
      try {
        const stat = fs.statSync(localArtPath);
        version = Math.floor(stat.mtimeMs);
      } catch {
        version = Date.now();
      }

      await db.update(artists)
        .set({
          artworkPath: localArtPath,
          artworkSource: 'local',
          artworkVerified: 1,
        })
        .where(eq(artists.id, artistId));

      return {
        artistId,
        status: 'updated',
        artworkPath: localArtPath,
        hasArtwork: true,
        version,
      };
    }

    // No local artwork found: invalidate previous cached artwork if any and clear record
    if (artist.artworkPath) {
      try {
        const artworkDir = getArtworkDir();
        const candidateOldCached = path.isAbsolute(artist.artworkPath)
          ? artist.artworkPath
          : path.join(artworkDir, artist.artworkPath);
        const resolvedCached = path.resolve(candidateOldCached);
        const resolvedArtworkDir = path.resolve(artworkDir);
        if (resolvedCached.startsWith(resolvedArtworkDir + path.sep)) {
          if (fs.existsSync(resolvedCached)) {
            fs.unlinkSync(resolvedCached);
          }
        }
      } catch {
        // Ignore cache deletion error
      }

      await db.update(artists)
        .set({
          artworkPath: null,
          artworkSource: null,
          artworkVerified: 0,
        })
        .where(eq(artists.id, artistId));
    }

    return {
      artistId,
      status: 'unavailable',
      artworkPath: null,
      hasArtwork: false,
      version: null,
    };
  } catch (err: any) {
    return {
      artistId,
      status: 'failed',
      artworkPath: null,
      hasArtwork: false,
      version: null,
      error: err?.message || 'Failed to refresh local artwork',
    };
  }
}

/**
 * Saves artist portrait to the artist's verified actual folder as artist.jpg if available and writable.
 * If the artist folder cannot be written to or is not found, falls back safely to the cached artwork directory.
 */
export async function saveArtistImage(
  artistId: number,
  imgBuf: Buffer,
  contentType: string
): Promise<{ savedPath: string; isLocalFolder: boolean }> {
  const artistDirInfo = await resolveArtistDirectory(artistId);
  if (artistDirInfo) {
    const { artistDir } = artistDirInfo;
    const imageExtension =
      imgBuf[0] === 0xff && imgBuf[1] === 0xd8 && imgBuf[2] === 0xff ? 'jpg' :
      imgBuf[0] === 0x89 && imgBuf[1] === 0x50 && imgBuf[2] === 0x4e && imgBuf[3] === 0x47 ? 'png' :
      imgBuf.length >= 12 && imgBuf.toString('ascii', 0, 4) === 'RIFF' && imgBuf.toString('ascii', 8, 12) === 'WEBP' ? 'webp' :
      imgBuf.toString('ascii', 0, 3) === 'GIF' ? 'gif' : null;
    if (!imageExtension) {
      throw new Error('Unsupported image format for local artist artwork');
    }
    const targetFile = path.join(artistDir, `artist.${imageExtension}`);
    try {
      await fs.promises.mkdir(artistDir, { recursive: true });
      await fs.promises.writeFile(targetFile, imgBuf);
      if (fs.existsSync(targetFile)) {
        return { savedPath: targetFile, isLocalFolder: true };
      }
    } catch (writeErr) {
      console.warn(`[ArtistImage] Unable to write artist.jpg to ${artistDir}, falling back to cache directory:`, writeErr);
    }
  }

  // Fallback to dataDir/artwork
  const filename = await saveArtworkBuffer(imgBuf, contentType);
  return { savedPath: filename, isLocalFolder: false };
}

/**
 * Downloads, validates, and stores an artist portrait buffer.
 */
async function downloadAndPersistArtistImage(
  artistId: number,
  artistName: string,
  imageUrl: string,
  musicBrainzId: string | null,
  currentArtworkPath: string | null
): Promise<ArtistRefreshResult> {
  if (!isValidArtistImageUrl(imageUrl)) {
    return {
      artistId,
      artistName,
      status: 'failed',
      provider: 'fanart_tv',
      error: `image URL failed security validation`,
    };
  }

  let imgRes: Response;
  try {
    imgRes = await fetch(imageUrl, {
      signal: AbortSignal.timeout(10000),
    });
    if (!imgRes.ok) {
      return {
        artistId,
        artistName,
        status: 'failed',
        provider: 'fanart_tv',
        error: `Failed to download image (HTTP ${imgRes.status})`,
      };
    }
  } catch (netErr: any) {
    return {
      artistId,
      artistName,
      status: 'failed',
      provider: 'fanart_tv',
      error: netErr?.message || `Network error downloading portrait`,
    };
  }

  const contentType = (imgRes.headers.get('content-type') || '').toLowerCase();
  if (contentType && !contentType.startsWith('image/')) {
    return {
      artistId,
      artistName,
      status: 'failed',
      provider: 'fanart_tv',
      error: `Response was not an image (Content-Type: ${contentType})`,
    };
  }

  const maxSizeBytes = 15 * 1024 * 1024; // 15MB
  const declaredLength = Number(imgRes.headers.get('content-length') || 0);
  if (declaredLength > maxSizeBytes) {
    return { artistId, artistName, status: 'failed', provider: 'fanart_tv', error: 'Image exceeds 15MB limit' };
  }

  let imgBuf: Buffer;
  try {
    if (!imgRes.body) throw new Error('Image response has no body');
    const reader = imgRes.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxSizeBytes) {
        await reader.cancel();
        return { artistId, artistName, status: 'failed', provider: 'fanart_tv', error: 'Image exceeds 15MB limit' };
      }
      chunks.push(value);
    }
    imgBuf = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), totalBytes);
  } catch (downloadErr: any) {
    return { artistId, artistName, status: 'failed', provider: 'fanart_tv', error: downloadErr?.message || 'Failed to read image response' };
  }

  if (imgBuf.length < 1024) {
    return { artistId, artistName, status: 'failed', provider: 'fanart_tv', error: 'Image file too small (<1KB)' };
  }

  if (!validateImageMagicBytes(imgBuf)) {
    return { artistId, artistName, status: 'failed', provider: 'fanart_tv', error: 'Invalid image format' };
  }

  const { savedPath } = await saveArtistImage(artistId, imgBuf, contentType);

  // If unchanged, keep existing artwork and avoid redundant disk writes
  if (currentArtworkPath && (currentArtworkPath === savedPath || (path.isAbsolute(currentArtworkPath) && currentArtworkPath === path.resolve(savedPath)))) {
    await db.update(artists)
      .set({
        artworkSource: 'fanart_tv',
        artworkSourceUrl: imageUrl,
        artworkVerified: 1,
        musicbrainzId: musicBrainzId || undefined,
      })
      .where(eq(artists.id, artistId));

    return { artistId, artistName, status: 'unchanged', provider: 'fanart_tv', artworkUrl: imageUrl };
  }

  // Update database with verified provider portrait
  await db.update(artists)
    .set({
      artworkPath: savedPath,
      artworkSource: 'fanart_tv',
      artworkSourceUrl: imageUrl,
      artworkVerified: 1,
      musicbrainzId: musicBrainzId || undefined,
    })
    .where(eq(artists.id, artistId));

  return { artistId, artistName, status: 'updated', provider: 'fanart_tv', artworkUrl: imageUrl };
}

/**
 * Refreshes the profile portrait image for an individual artist using Fanart.tv and local artist folder artwork.
 */
export async function refreshArtistProfileImage(
  artistId: number,
  selectedMusicBrainzId?: string,
  forceArtistChoice = false
): Promise<ArtistRefreshResult> {
  if (activeArtistRefreshes.has(artistId)) {
    return { artistId, artistName: 'Unknown', status: 'failed', error: 'Refresh already in progress' };
  }

  activeArtistRefreshes.add(artistId);
  try {
    const artistRec = await db.select().from(artists).where(eq(artists.id, artistId)).limit(1);
    if (artistRec.length === 0) {
      return { artistId, artistName: 'Unknown', status: 'failed', error: 'Artist not found' };
    }

    const artist = artistRec[0];
    const artistName = artist.name;
    let knownMbid: string | null = artist.musicbrainzId || null;
    const firstSong = await db.select({ title: songs.title })
      .from(songs)
      .where(eq(songs.artistId, artistId))
      .orderBy(songs.id)
      .limit(1);
    const firstSongTitle = firstSong[0]?.title?.trim() || undefined;

    // 1. MusicBrainz Resolution / Validation
    if (selectedMusicBrainzId) {
      const validation = await validateMusicBrainzArtistId(selectedMusicBrainzId);
      if (validation.valid && validation.artist) {
        knownMbid = validation.artist.id;
        await db.update(artists).set({ musicbrainzId: knownMbid }).where(eq(artists.id, artistId));
      } else {
        const candidates = await searchMusicBrainzArtists(artistName, 8000, firstSongTitle);
        const selected = candidates.find(candidate => candidate.id === selectedMusicBrainzId);
        if (selected) {
          knownMbid = selected.id;
          await db.update(artists).set({ musicbrainzId: knownMbid }).where(eq(artists.id, artistId));
        } else {
          return {
            artistId,
            artistName,
            status: 'failed',
            provider: 'none',
            error: validation.error || 'The selected MusicBrainz artist could not be verified for this name. Please search again.',
          };
        }
      }
    } else if (!knownMbid || forceArtistChoice) {
      const candidates = await searchMusicBrainzArtists(artistName, 8000, firstSongTitle);
      if (candidates.length > 1) {
        return {
          artistId,
          artistName,
          status: 'ambiguous',
          provider: 'none',
          error: 'Multiple artists match this name. Choose the correct artist to continue.',
          candidates,
        };
      }
      if (candidates.length === 0 && forceArtistChoice) {
        return {
          artistId,
          artistName,
          status: 'unavailable',
          provider: 'none',
          error: 'No MusicBrainz matches were found for the new search. The previously saved match was not used.',
          candidates: [],
        };
      }
      if (candidates.length === 1) knownMbid = candidates[0].id;
      if (knownMbid) {
        await db.update(artists).set({ musicbrainzId: knownMbid }).where(eq(artists.id, artistId));
      }
    }
    // If knownMbid is already present and !forceArtistChoice, it is reused directly without querying MusicBrainz!

    // Check for valid local portrait in the artist's library folder
    const artistDirInfo = await resolveArtistDirectory(artistId);
    let localArtPath: string | null = null;
    if (artistDirInfo) {
      localArtPath = findLocalArtistArtwork(artistDirInfo.artistDir);
    }

    // Music Assistant's source priority: an explicit local artist portrait wins.
    // Never replace it with a remote image, and avoid needless provider requests.
    if (localArtPath) {
      const alreadySelected = artist.artworkPath === localArtPath;
      if (!alreadySelected || artist.artworkSource !== 'local') {
        await db.update(artists)
          .set({
            artworkPath: localArtPath,
            artworkSource: 'local',
            artworkVerified: 1,
            musicbrainzId: knownMbid || undefined,
          })
          .where(eq(artists.id, artistId));
      }
      return {
        artistId,
        artistName,
        status: alreadySelected ? 'unchanged' : 'updated',
        provider: 'none',
        artworkUrl: localArtPath,
      };
    }

    const fanartApiKey = getFanartTvApiKey();
    if (!fanartApiKey) {
      if (localArtPath && artist.artworkPath !== localArtPath) {
        await db.update(artists)
          .set({ artworkPath: localArtPath, artworkSource: 'local', artworkVerified: 1, musicbrainzId: knownMbid || undefined })
          .where(eq(artists.id, artistId));
        return { artistId, artistName, status: 'updated', provider: 'none', artworkUrl: localArtPath };
      }
      if (artist.artworkPath) {
        return {
          artistId,
          artistName,
          status: 'unchanged',
          provider: 'none',
          error: 'Fanart.tv API key not configured; preserved existing portrait',
        };
      }
      return {
        artistId,
        artistName,
        status: 'failed',
        provider: 'none',
        error: 'Fanart.tv API key not configured.',
      };
    }

    // 2. Query Fanart.tv if we have an MBID
    if (knownMbid) {
      const fanartResult = await queryFanartTvArtist(knownMbid);

      if (fanartResult.status === 'updated' && fanartResult.imageUrl) {
        const downloadResult = await downloadAndPersistArtistImage(
          artistId,
          artistName,
          fanartResult.imageUrl.trim(),
          knownMbid,
          artist.artworkPath
        );
        return downloadResult;
      }

      // Handle explicit provider failures
      if (fanartResult.status === 'failed') {
        if (localArtPath && (!artist.artworkPath || artist.artworkPath !== localArtPath)) {
          await db.update(artists)
            .set({ artworkPath: localArtPath, artworkSource: 'local', artworkVerified: 1, musicbrainzId: knownMbid })
            .where(eq(artists.id, artistId));
          return { artistId, artistName, status: 'updated', provider: 'none', artworkUrl: localArtPath };
        }
        if (artist.artworkPath) {
          return {
            artistId,
            artistName,
            status: 'unchanged',
            provider: 'fanart_tv',
            error: fanartResult.error || 'Fanart.tv query failed; preserved existing portrait',
          };
        }
        return {
          artistId,
          artistName,
          status: 'failed',
          provider: 'fanart_tv',
          error: fanartResult.error || 'Fanart.tv query failed',
        };
      }
    }

    // 3. Fallback logic: check local portrait first, then preserve existing image
    if (localArtPath && (!artist.artworkPath || artist.artworkPath !== localArtPath)) {
      await db.update(artists)
        .set({ artworkPath: localArtPath, artworkSource: 'local', artworkVerified: 1, musicbrainzId: knownMbid || undefined })
        .where(eq(artists.id, artistId));
      return { artistId, artistName, status: 'updated', provider: 'none', artworkUrl: localArtPath };
    }

    if (artist.artworkPath) {
      return {
        artistId,
        artistName,
        status: 'unchanged',
        provider: 'none',
        error: 'No new image from provider; preserved existing portrait',
      };
    }

    return {
      artistId,
      artistName,
      status: 'unavailable',
      provider: 'none',
      error: 'No suitable portrait available',
    };
  } catch (err: any) {
    // A metadata-provider outage must never make a valid saved portrait disappear
    // or report the artist as failed when the current artwork is still usable.
    try {
      const [existing] = await db.select({
        name: artists.name,
        artworkPath: artists.artworkPath,
      }).from(artists).where(eq(artists.id, artistId)).limit(1);
      if (existing?.artworkPath) {
        return {
          artistId,
          artistName: existing.name,
          status: 'unchanged',
          provider: 'none',
          error: `Metadata lookup failed; preserved existing portrait: ${err?.message || 'Unexpected error'}`,
        };
      }
      return {
        artistId,
        artistName: existing?.name || 'Unknown',
        status: 'failed',
        provider: 'none',
        error: err?.message || 'Unexpected error',
      };
    } catch {
      return {
        artistId,
        artistName: 'Unknown',
        status: 'failed',
        provider: 'none',
        error: err?.message || 'Unexpected error',
      };
    }
  } finally {
    activeArtistRefreshes.delete(artistId);
  }
}

/**
 * Refreshes profile images across all artists in the library.
 */
export async function refreshAllArtists(
  onProgress?: (progress: {
    completed: number;
    total: number;
    currentArtist: string;
    updated: number;
    unchanged: number;
    unavailable: number;
    failed: number;
  }) => void,
  externalSignal?: AbortSignal
): Promise<BulkRefreshSummary> {
  if (activeBulkAbortController) {
    activeBulkAbortController.abort();
  }
  activeBulkAbortController = new AbortController();
  const signal = externalSignal || activeBulkAbortController.signal;

  const allArtists = await db.select().from(artists);
  const total = allArtists.length;

  let updated = 0;
  let unchanged = 0;
  let unavailable = 0;
  let ambiguous = 0;
  let failed = 0;
  const details: ArtistRefreshResult[] = [];

  const concurrency = 1;
  const delayMs = 250;
  let completed = 0;

  let index = 0;
  const worker = async () => {
    while (index < allArtists.length) {
      if (signal.aborted) break;
      const current = allArtists[index++];
      if (!current) break;

      if (onProgress) {
        onProgress({ completed, total, currentArtist: current.name, updated, unchanged, unavailable, failed });
      }

      const res = await refreshArtistProfileImage(current.id);
      details.push(res);

      if (res.status === 'updated') updated++;
      else if (res.status === 'unchanged') unchanged++;
      else if (res.status === 'unavailable') unavailable++;
      else if (res.status === 'ambiguous') ambiguous++;
      else if (res.status === 'failed') failed++;

      completed++;

      if (onProgress) {
        onProgress({ completed, total, currentArtist: current.name, updated, unchanged, unavailable, failed });
      }

      if (delayMs > 0 && index < allArtists.length && !signal.aborted) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
  await Promise.all(workers);

  activeBulkAbortController = null;
  return { total, updated, unchanged, unavailable, ambiguous, failed, details };
}

export function cancelBulkRefresh(): void {
  if (activeBulkAbortController) {
    activeBulkAbortController.abort();
    activeBulkAbortController = null;
  }
}
