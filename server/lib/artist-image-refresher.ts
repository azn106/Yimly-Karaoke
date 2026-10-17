import fs from 'fs';
import path from 'path';
import { db } from '../db/index.js';
import { artists } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { saveArtworkBuffer } from './scanner.js';

const activeArtistRefreshes = new Set<number>();
let activeBulkAbortController: AbortController | null = null;

export interface ArtistRefreshResult {
  artistId: number;
  artistName: string;
  status: 'updated' | 'unchanged' | 'unavailable' | 'ambiguous' | 'failed';
  provider?: 'fanart_tv' | 'none';
  error?: string;
  artworkUrl?: string;
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
export async function resolveMusicBrainzId(artistName: string, timeoutMs = 8000): Promise<string | null> {
  const cleanName = artistName.trim();
  if (!cleanName || cleanName.toLowerCase() === 'unknown artist') {
    return null;
  }

  const variations = [normalizeArtistNameForMatching(cleanName), cleanName];
  const targetNorm = normalizeArtistNameForMatching(cleanName);

  for (const name of variations) {
    try {
      const searchUrl = `https://musicbrainz.org/ws/2/artist?query=artist:${encodeURIComponent(name)}&fmt=json`;
      const res = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'YimlyKaraoke/1.0 (contact: info@yimly.local)',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) continue;
      const data = await res.json().catch(() => null);
      if (!data || !Array.isArray(data.artists) || data.artists.length === 0) continue;

      const exactMatches = data.artists.filter((a: any) => {
        if (!a.id) return false;
        const nameNorm = normalizeArtistNameForMatching(a.name || '');
        if (nameNorm === targetNorm) return true;
        if (a.sortName && normalizeArtistNameForMatching(a.sortName) === targetNorm) return true;
        if (Array.isArray(a.aliases)) {
          for (const alias of a.aliases) {
            if (normalizeArtistNameForMatching(alias.name || '') === targetNorm) return true;
          }
        }
        return false;
      });

      if (exactMatches.length === 1) {
        return exactMatches[0].id;
      }
    } catch {
      continue;
    }
  }

  return null;
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

  const imgBuf = Buffer.from(await imgRes.arrayBuffer());
  if (imgBuf.length < 1024) {
    return { artistId, artistName, status: 'failed', provider: 'fanart_tv', error: 'Image file too small (<1KB)' };
  }
  const maxSizeBytes = 15 * 1024 * 1024; // 15MB
  if (imgBuf.length > maxSizeBytes) {
    return { artistId, artistName, status: 'failed', provider: 'fanart_tv', error: 'Image exceeds 15MB limit' };
  }

  if (!validateImageMagicBytes(imgBuf)) {
    return { artistId, artistName, status: 'failed', provider: 'fanart_tv', error: 'Invalid image format' };
  }

  const newFilename = await saveArtworkBuffer(imgBuf, contentType);

  // If unchanged, keep existing artwork and avoid redundant disk writes
  if (currentArtworkPath && currentArtworkPath === newFilename) {
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
      artworkPath: newFilename,
      artworkSource: 'fanart_tv',
      artworkSourceUrl: imageUrl,
      artworkVerified: 1,
      musicbrainzId: musicBrainzId || undefined,
    })
    .where(eq(artists.id, artistId));

  return { artistId, artistName, status: 'updated', provider: 'fanart_tv', artworkUrl: imageUrl };
}

/**
 * Refreshes the profile portrait image for an individual artist using Fanart.tv.
 */
export async function refreshArtistProfileImage(artistId: number): Promise<ArtistRefreshResult> {
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

    // 1. Resolve MBID if needed
    if (!knownMbid) {
        knownMbid = await resolveMusicBrainzId(artistName);
        // Persist resolved MBID immediately
        if (knownMbid) {
             await db.update(artists)
            .set({ musicbrainzId: knownMbid })
            .where(eq(artists.id, artistId));
        }
    }

    const fanartApiKey = getFanartTvApiKey();
    if (!fanartApiKey) {
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
             return { 
                artistId, 
                artistName, 
                status: 'failed', 
                provider: 'fanart_tv', 
                error: fanartResult.error || 'Fanart.tv query failed' 
             };
        }
        // If 'unavailable', fall through to return 'unchanged' or 'unavailable'
    }

    // 3. Fallback logic: Preserve existing image if available
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
    return {
      artistId,
      artistName: 'Unknown',
      status: 'failed',
      provider: 'none',
      error: err?.message || 'Unexpected error',
    };
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

  const fanartApiKey = getFanartTvApiKey();
  if (!fanartApiKey) {
    const errorMsg = 'Fanart.tv API key not configured.';
    return {
      total,
      updated: 0,
      unchanged: 0,
      unavailable: 0,
      ambiguous: 0,
      failed: total,
      error: errorMsg,
      details: allArtists.map(a => ({
        artistId: a.id,
        artistName: a.name,
        status: 'failed',
        provider: 'none',
        error: errorMsg,
      })),
    };
  }

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
  return { total, updated, unchanged, unavailable, ambiguous: 0, failed, details };
}

export function cancelBulkRefresh(): void {
  if (activeBulkAbortController) {
    activeBulkAbortController.abort();
    activeBulkAbortController = null;
  }
}
