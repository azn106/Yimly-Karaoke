import fs from 'fs';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db } from '../db/index.js';
import { artists } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { saveArtworkBuffer } from './scanner.js';

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');
const artworkDir = path.join(dataDir, 'artwork');

const activeArtistRefreshes = new Set<number>();
let activeBulkAbortController: AbortController | null = null;

export interface ArtistRefreshResult {
  artistId: number;
  artistName: string;
  status: 'updated' | 'unchanged' | 'unavailable' | 'failed';
  error?: string;
}

export interface BulkRefreshSummary {
  total: number;
  updated: number;
  unchanged: number;
  unavailable: number;
  failed: number;
  details: ArtistRefreshResult[];
}

/**
 * Attempts to fetch a genuine artist profile image URL from Spotify or iTunes artist endpoints.
 * Returns null if no genuine artist image is available (never falls back to album covers).
 */
async function fetchProviderArtistImageUrl(artistName: string): Promise<string | null> {
  const cleanName = artistName.trim();
  if (!cleanName || cleanName.toLowerCase() === 'unknown artist') {
    return null;
  }

  // Query Spotify embed or search for artist profile image
  try {
    const searchUrl = `https://open.spotify.com/embed/search/${encodeURIComponent(cleanName)}`;
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const html = await res.text();
      const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
      if (nextDataMatch) {
        const data = JSON.parse(nextDataMatch[1]);
        const items = data.props?.pageProps?.state?.data?.artists?.items || [];
        for (const artistItem of items) {
          if (artistItem?.name?.toLowerCase() === cleanName.toLowerCase() || artistItem?.name?.toLowerCase().includes(cleanName.toLowerCase())) {
            const imgUrl = artistItem?.images?.[0]?.url || artistItem?.visualIdentity?.image?.[0]?.url;
            if (imgUrl && typeof imgUrl === 'string') {
              return imgUrl;
            }
          }
        }
      }
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Provider request timed out');
    }
  }

  return null;
}

/**
 * Refreshes the profile image for an individual artist.
 */
export async function refreshArtistProfileImage(artistId: number): Promise<ArtistRefreshResult> {
  if (activeArtistRefreshes.has(artistId)) {
    return { artistId, artistName: 'Unknown', status: 'failed', error: 'Refresh already in progress for this artist' };
  }

  activeArtistRefreshes.add(artistId);
  try {
    const artistRec = await db.select().from(artists).where(eq(artists.id, artistId)).limit(1);
    if (artistRec.length === 0) {
      return { artistId, artistName: 'Unknown', status: 'failed', error: 'Artist not found' };
    }

    const artist = artistRec[0];
    const artistName = artist.name;

    let freshImageUrl: string | null = null;
    try {
      freshImageUrl = await fetchProviderArtistImageUrl(artistName);
    } catch (providerErr: any) {
      return {
        artistId,
        artistName,
        status: 'failed',
        error: providerErr?.message || 'Provider error or timeout',
      };
    }

    if (!freshImageUrl) {
      return {
        artistId,
        artistName,
        status: 'unavailable',
      };
    }

    // Download fresh image buffer
    let imgRes: Response;
    try {
      imgRes = await fetch(freshImageUrl, { signal: AbortSignal.timeout(8000) });
      if (!imgRes.ok) {
        return { artistId, artistName, status: 'failed', error: `Failed to download image (HTTP ${imgRes.status})` };
      }
    } catch (netErr: any) {
      return { artistId, artistName, status: 'failed', error: netErr?.message || 'Network error downloading image' };
    }

    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
    if (imgBuf.length <= 1024) {
      return { artistId, artistName, status: 'unavailable', error: 'Downloaded image file too small' };
    }

    const fmt = imgRes.headers.get('content-type') || 'image/jpeg';
    const newFilename = await saveArtworkBuffer(imgBuf, fmt);

    // Compare with existing artwork hash
    if (artist.artworkPath && artist.artworkPath === newFilename) {
      return { artistId, artistName, status: 'unchanged' };
    }

    // Update database with new artwork path
    await db.update(artists)
      .set({ artworkPath: newFilename })
      .where(eq(artists.id, artistId));

    return { artistId, artistName, status: 'updated' };
  } catch (err: any) {
    return { artistId, artistName: 'Unknown', status: 'failed', error: err?.message || 'Unexpected error during refresh' };
  } finally {
    activeArtistRefreshes.delete(artistId);
  }
}

/**
 * Refreshes profile images across all artists in the library with controlled concurrency and delay.
 */
export async function refreshAllArtists(
  onProgress?: (progress: { completed: number; total: number; currentArtist: string; updated: number; unchanged: number; unavailable: number; failed: number }) => void,
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
  let failed = 0;
  const details: ArtistRefreshResult[] = [];

  const concurrency = 2;
  const delayMs = 300;
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
  return { total, updated, unchanged, unavailable, failed, details };
}

export function cancelBulkRefresh(): void {
  if (activeBulkAbortController) {
    activeBulkAbortController.abort();
    activeBulkAbortController = null;
  }
}
