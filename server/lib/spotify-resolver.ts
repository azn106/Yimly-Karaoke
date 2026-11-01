/**
 * Spotify Metadata Resolver for Yimly
 * Extracts track lists, album info, and track metadata from Spotify URLs
 * without depending on yt-dlp (which fails on Spotify due to DRM checks).
 * 
 * Enforces canonical metadata principles:
 * - Playlist title is NEVER assigned as the album title of tracks.
 * - Playlist thumbnail is NEVER assigned as track-specific album artwork.
 * - Each track resolves its own album, artwork, artists, and duration.
 */

import crypto from 'crypto';
import { cleanString, normalizeCanonicalMetadata } from './canonical-metadata.js';

export interface SpotifyResolvedTrack {
  title: string;
  artist: string;
  album: string;
  trackNumber?: number;
  discNumber?: number;
  releaseYear?: number;
  duration?: number; // duration in seconds
  artworkUrl?: string;
  spotifyId?: string;
  sourceUrl?: string; // Will be resolved to YouTube URL
}

export interface SpotifyResolvedEntity {
  type: 'track' | 'album' | 'playlist';
  id?: string;
  spotifyId?: string;
  title: string;
  artist?: string;
  artworkUrl?: string;
  totalTracks: number;
  tracks: SpotifyResolvedTrack[];
}

function parseSpotifyUrl(input: string): { type: 'track' | 'album' | 'playlist' | null; id: string | null } {
  const clean = input.trim();
  
  // Format: spotify:type:id
  const uriMatch = clean.match(/^spotify:(track|album|playlist):([a-zA-Z0-9]+)/);
  if (uriMatch) {
    return { type: uriMatch[1] as any, id: uriMatch[2] };
  }

  // Format: https://open.spotify.com/type/id or https://open.spotify.com/intl-xx/type/id
  const urlMatch = clean.match(/spotify\.com\/(?:[a-zA-Z-]+\/)?(track|album|playlist)\/([a-zA-Z0-9]+)/);
  if (urlMatch) {
    return { type: urlMatch[1] as any, id: urlMatch[2] };
  }

  return { type: null, id: null };
}

/**
 * Cache for individual track resolutions to accelerate playlist imports
 */
const trackResolutionCache = new Map<string, SpotifyResolvedTrack>();

/**
 * Token manager for Spotify Web Player GraphQL API
 */
interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedWebPlayerToken: CachedToken | null = null;

const SPOTIFY_TOTP_SECRETS = [
  { secret: ",7/*F(\"rLJ2oxaKL^f+E1xvP@N", version: 61 },
  { secret: "OmE{ZA.J^\":0FG\\Uz?[@WW", version: 60 },
  { secret: "{iOFn;4}<1PFYKPV?5{%u14]M>/V0hDH", version: 59 }
];

function generateSpotifyTOTP(secretStr: string, timestamp = Date.now(), period = 30, digits = 6): string {
  const chars = secretStr.split('').map((ch, idx) => ch.charCodeAt(0) ^ (idx % 33 + 9));
  const secretBuf = Buffer.from(chars.join(''), 'utf8');
  const counter = Math.floor(timestamp / 1000 / period);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) |
                 ((hmac[offset + 1] & 0xff) << 16) |
                 ((hmac[offset + 2] & 0xff) << 8) |
                 (hmac[offset + 3] & 0xff);
  const otp = binary % (10 ** digits);
  return otp.toString().padStart(digits, '0');
}

export async function getSpotifyWebPlayerToken(forceRefresh = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && cachedWebPlayerToken && cachedWebPlayerToken.expiresAt > now + 30000) {
    return cachedWebPlayerToken.accessToken;
  }

  // 1. Check for official Spotify Client Credentials if provided
  if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
    try {
      const basicAuth = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
      const credRes = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
      });
      if (credRes.ok) {
        const credData = await credRes.json();
        if (credData.access_token) {
          cachedWebPlayerToken = {
            accessToken: credData.access_token,
            expiresAt: now + (credData.expires_in || 3600) * 1000
          };
          return credData.access_token;
        }
      }
    } catch (e) {
      console.warn('[Spotify] Client credentials grant failed, trying web player token:', e);
    }
  }

  // 2. Fetch using Spotify Web Player TOTP algorithm
  for (const s of SPOTIFY_TOTP_SECRETS) {
    try {
      const totp = generateSpotifyTOTP(s.secret, now);
      const params = new URLSearchParams({
        reason: 'transport',
        productType: 'web_player',
        totp,
        totpServer: 'unavailable',
        totpVer: String(s.version)
      });

      const res = await fetch(`https://open.spotify.com/api/token?${params.toString()}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://open.spotify.com/',
          'Origin': 'https://open.spotify.com'
        }
      });

      if (res.ok) {
        const data = await res.json();
        if (data.accessToken) {
          const expiresAt = typeof data.accessTokenExpirationTimestampMs === 'number'
            ? data.accessTokenExpirationTimestampMs
            : now + 3600000;
          cachedWebPlayerToken = {
            accessToken: data.accessToken,
            expiresAt
          };
          return data.accessToken;
        }
      }
    } catch (err) {
      console.warn(`[Spotify] Token attempt failed for version ${s.version}:`, err);
    }
  }

  throw new Error('Failed to obtain Spotify access token');
}

/**
 * Resolve Spotify Track, Album, or Playlist to metadata
 */
export async function resolveSpotifyEntity(urlOrUri: string): Promise<SpotifyResolvedEntity> {
  const { type, id } = parseSpotifyUrl(urlOrUri);
  if (!type || !id) {
    throw new Error('Invalid Spotify URL or URI');
  }

  console.log(`[Spotify] Resolving ${type} ID: ${id}`);

  if (type === 'track') {
    return await resolveSpotifyTrack(id);
  } else if (type === 'album') {
    return await resolveSpotifyAlbum(id);
  } else if (type === 'playlist') {
    return await resolveSpotifyPlaylist(id);
  }

  throw new Error(`Unsupported Spotify entity type: ${type}`);
}

/**
 * Extract Spotify Track
 */
export async function resolveSpotifyTrack(id: string): Promise<SpotifyResolvedEntity> {
  if (trackResolutionCache.has(id)) {
    const cached = trackResolutionCache.get(id)!;
    return {
      type: 'track',
      id,
      spotifyId: id,
      title: cached.title,
      artist: cached.artist,
      artworkUrl: cached.artworkUrl,
      totalTracks: 1,
      tracks: [{ ...cached }],
    };
  }

  const embedUrl = `https://open.spotify.com/embed/track/${id}`;
  const res = await fetch(embedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });

  let title = 'Unknown Title';
  let artist = 'Unknown Artist';
  let album = 'Single';
  let duration = 0;
  let artworkUrl = '';
  let releaseYear: number | undefined;

  if (res.ok) {
    const html = await res.text();
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
    if (nextDataMatch) {
      try {
        const data = JSON.parse(nextDataMatch[1]);
        const entity = data.props?.pageProps?.state?.data?.entity;
        if (entity) {
          title = entity.name || entity.title || title;
          artist = entity.artists?.map((a: any) => a.name).join(', ') || entity.subtitle || artist;
          album = entity.album?.name || entity.albumTitle || album;
          if (entity.duration) {
            duration = Math.round(entity.duration / 1000);
          }
          if (entity.visualIdentity?.image?.[0]?.url) {
            artworkUrl = entity.visualIdentity.image[0].url;
          } else if (entity.coverArt?.sources?.[0]?.url) {
            artworkUrl = entity.coverArt.sources[0].url;
          }
          if (entity.releaseDate) {
            releaseYear = new Date(entity.releaseDate).getFullYear();
          }
        }
      } catch (e) {
        console.warn('[Spotify] Failed to parse track embed __NEXT_DATA__:', e);
      }
    }
  }

  // Enrich with iTunes Search API if album or artwork missing
  if (album === 'Single' || !artworkUrl || !releaseYear) {
    try {
      const itunesRes = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(`${artist} ${title}`)}&entity=song&limit=3`
      );
      if (itunesRes.ok) {
        const itunesData = await itunesRes.json();
        const cleanTitle = cleanString(title);
        const match = itunesData.results?.find((r: any) => {
          const rTitle = cleanString(r.trackName);
          return rTitle.includes(cleanTitle) || cleanTitle.includes(rTitle);
        }) || itunesData.results?.[0];

        if (match) {
          title = title === 'Unknown Title' ? match.trackName : title;
          artist = artist === 'Unknown Artist' ? match.artistName : artist;
          album = album === 'Single' && match.collectionName ? match.collectionName : album;
          if (!artworkUrl && match.artworkUrl100) {
            artworkUrl = match.artworkUrl100.replace('100x100bb', '600x600bb');
          }
          if (!releaseYear && match.releaseDate) {
            releaseYear = new Date(match.releaseDate).getFullYear();
          }
          if (!duration && match.trackTimeMillis) {
            duration = Math.round(match.trackTimeMillis / 1000);
          }
        }
      }
    } catch {}
  }

  const track: SpotifyResolvedTrack = {
    title,
    artist,
    album,
    duration,
    artworkUrl,
    releaseYear,
    trackNumber: 1,
    discNumber: 1,
    spotifyId: id,
  };

  trackResolutionCache.set(id, track);

  return {
    type: 'track',
    id,
    spotifyId: id,
    title,
    artist,
    artworkUrl,
    totalTracks: 1,
    tracks: [track],
  };
}

/**
 * Extract Spotify Album
 */
async function resolveSpotifyAlbum(id: string): Promise<SpotifyResolvedEntity> {
  const embedUrl = `https://open.spotify.com/embed/album/${id}`;
  const res = await fetch(embedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });

  let albumTitle = 'Spotify Album';
  let albumArtist = 'Unknown Artist';
  let artworkUrl = '';
  let releaseYear: number | undefined;
  const tracks: SpotifyResolvedTrack[] = [];

  // 1. Fetch oEmbed for title & artwork
  try {
    const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/album/${id}`)}`);
    if (oembedRes.ok) {
      const oembedData = await oembedRes.json();
      albumTitle = oembedData.title || albumTitle;
      artworkUrl = oembedData.thumbnail_url || artworkUrl;
    }
  } catch {}

  // 2. Parse Embed HTML if available
  if (res.ok) {
    const html = await res.text();
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
    if (nextDataMatch) {
      try {
        const data = JSON.parse(nextDataMatch[1]);
        const entity = data.props?.pageProps?.state?.data?.entity;
        if (entity) {
          albumTitle = entity.name || entity.title || albumTitle;
          albumArtist = entity.artists?.map((a: any) => a.name).join(', ') || entity.subtitle || albumArtist;
          if (entity.coverArt?.sources?.[0]?.url) {
            artworkUrl = entity.coverArt.sources[0].url;
          }
          if (entity.releaseDate) {
            releaseYear = new Date(entity.releaseDate).getFullYear();
          }
          if (Array.isArray(entity.trackList) && entity.trackList.length > 0) {
            entity.trackList.forEach((t: any, idx: number) => {
              tracks.push({
                title: t.title || t.name || `Track ${idx + 1}`,
                artist: t.subtitle || albumArtist,
                album: albumTitle,
                trackNumber: t.trackNumber || idx + 1,
                duration: t.duration ? Math.round(t.duration / 1000) : undefined,
                artworkUrl,
                releaseYear,
                spotifyId: t.uri ? t.uri.replace('spotify:track:', '') : undefined,
              });
            });
          }
        }
      } catch (e) {
        console.warn('[Spotify] Error parsing album embed state:', e);
      }
    }
  }

  // 3. If trackList empty from embed, search iTunes for album tracks
  if (tracks.length === 0) {
    try {
      const itunesRes = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(albumTitle)}&entity=song&limit=100`
      );
      if (itunesRes.ok) {
        const itunesData = await itunesRes.json();
        if (itunesData.results && itunesData.results.length > 0) {
          albumArtist = itunesData.results[0].artistName || albumArtist;
          if (!artworkUrl && itunesData.results[0].artworkUrl100) {
            artworkUrl = itunesData.results[0].artworkUrl100.replace('100x100bb', '600x600bb');
          }
          itunesData.results.forEach((item: any, idx: number) => {
            tracks.push({
              title: item.trackName || `Track ${idx + 1}`,
              artist: item.artistName || albumArtist,
              album: item.collectionName || albumTitle,
              trackNumber: item.trackNumber || idx + 1,
              discNumber: item.discNumber || 1,
              releaseYear: item.releaseDate ? new Date(item.releaseDate).getFullYear() : releaseYear,
              duration: Math.round((item.trackTimeMillis || 0) / 1000),
              artworkUrl: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '600x600bb') : artworkUrl,
            });
          });
        }
      }
    } catch (itunesErr) {
      console.warn('[Spotify] iTunes album fallback failed:', itunesErr);
    }
  }

  console.log(`[Spotify] Album resolved: "${albumTitle}" by "${albumArtist}" with ${tracks.length} tracks`);

  return {
    type: 'album',
    id,
    spotifyId: id,
    title: albumTitle,
    artist: albumArtist,
    artworkUrl,
    totalTracks: tracks.length,
    tracks,
  };
}

/**
 * NOTE ON SPOTIFY INTEGRATION:
 * This resolver uses Spotify Web Player's internal Pathfinder GraphQL API and TOTP token flow.
 * This is NOT an officially supported or stable public Spotify API, and may be subject to
 * changes by Spotify. If SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are configured in the
 * environment, the official Spotify Client Credentials flow is utilized instead.
 */

/**
 * Extract tracks from Spotify GraphQL items array.
 * Preserves legitimate duplicate songs occurring at different playlist positions,
 * while preventing duplicate entries caused by overlapping pagination responses.
 */
function parsePathfinderItems(
  items: any[],
  offset: number,
  allTracks: SpotifyResolvedTrack[],
  seenSlots: Set<number>,
  seenUids?: Set<string>
): SpotifyResolvedTrack[] {
  const result: SpotifyResolvedTrack[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const slotIndex = offset + i;

    // Guard 1: Slot already processed in an earlier page (offset overlap)
    if (seenSlots.has(slotIndex)) {
      continue;
    }
    seenSlots.add(slotIndex);

    // Guard 2: Playlist item UID already processed in an earlier page (overlapping API response)
    const itemUid = item?.uid;
    if (itemUid && seenUids) {
      if (seenUids.has(itemUid)) {
        continue;
      }
      seenUids.add(itemUid);
    }

    const t = item?.itemV2?.data;
    // Gracefully ignore null, deleted, podcast, or non-track items
    if (!t || t.__typename !== 'Track') {
      continue;
    }

    const spotifyId = t.uri ? t.uri.replace('spotify:track:', '') : undefined;

    const title = t.name || 'Unknown Title';
    const artist = t.artists?.items?.map((a: any) => a.profile?.name).filter(Boolean).join(', ') || 'Unknown Artist';
    
    // CRITICAL: NEVER assign playlist name as track album!
    const album = t.albumOfTrack?.name || 'Single';

    // CRITICAL: NEVER assign playlist artwork as track artwork!
    // Extract highest resolution album artwork for track
    const artworkUrl = t.albumOfTrack?.coverArt?.sources?.[0]?.url;

    let releaseYear: number | undefined;
    if (t.albumOfTrack?.date?.isoString) {
      releaseYear = new Date(t.albumOfTrack.date.isoString).getFullYear();
    }

    let duration: number | undefined;
    if (t.trackDuration?.totalMilliseconds) {
      duration = Math.round(t.trackDuration.totalMilliseconds / 1000);
    }

    result.push({
      title,
      artist,
      album,
      duration,
      artworkUrl,
      releaseYear,
      trackNumber: allTracks.length + result.length + 1,
      discNumber: t.discNumber || 1,
      spotifyId,
    });
  }

  return result;
}

/**
 * Extract Spotify Playlist (Supports playlists of all sizes with reliable pagination,
 * resolves each track independently with canonical album metadata and artwork).
 */
export async function resolveSpotifyPlaylist(id: string): Promise<SpotifyResolvedEntity> {
  let playlistTitle = 'Spotify Playlist';
  let playlistArtworkUrl = '';
  const seenSlots = new Set<number>();
  const seenUids = new Set<string>();
  const allTracks: SpotifyResolvedTrack[] = [];
  let expectedTotal = 0;

  // 1. Fetch oEmbed for playlist title and thumbnail as baseline
  try {
    const oembedRes = await fetch(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/playlist/${id}`)}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (oembedRes.ok) {
      const oembedData = await oembedRes.json();
      playlistTitle = oembedData.title || playlistTitle;
      playlistArtworkUrl = oembedData.thumbnail_url || playlistArtworkUrl;
    }
  } catch {}

  // 2. Fetch full playlist via Spotify GraphQL Pathfinder with pagination
  let graphQLSucceeded = false;
  try {
    let token = await getSpotifyWebPlayerToken();
    let offset = 0;
    let page = 0;
    const limit = 100;
    const sha256Hash = '21ea11a6ac75a5f3e01fd365d29c18e0a4a8b7dc09f89bbb5d73910190c6acaf';

    while (true) {
      const operationName = offset === 0 ? 'fetchPlaylist' : 'fetchPlaylistContents';
      const queryParams = new URLSearchParams({
        operationName,
        variables: JSON.stringify({
          uri: `spotify:playlist:${id}`,
          offset,
          limit,
          enableWatchFeedEntrypoint: false,
          includeEpisodeContentRatingsV2: false
        }),
        extensions: JSON.stringify({
          persistedQuery: {
            version: 1,
            sha256Hash
          }
        })
      });

      const makeRequest = async (authToken: string) => {
        return await fetch(`https://api-partner.spotify.com/pathfinder/v1/query?${queryParams.toString()}`, {
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Origin': 'https://open.spotify.com',
            'Referer': 'https://open.spotify.com/'
          },
          signal: AbortSignal.timeout(15000),
        });
      };

      let res = await makeRequest(token);

      // Handle token expiration (401)
      if (res.status === 401) {
        console.log('[Spotify] Token expired during playlist pagination, refreshing...');
        token = await getSpotifyWebPlayerToken(true);
        res = await makeRequest(token);
      }

      // Handle rate limiting (429)
      if (res.status === 429) {
        const retryHeader = res.headers.get('retry-after');
        const waitSec = retryHeader ? Math.min(10, Math.max(1, parseInt(retryHeader, 10) || 1)) : 1;
        console.warn(`[Spotify] Rate limited (429). Retrying after ${waitSec}s...`);
        await new Promise((r) => setTimeout(r, waitSec * 1000));
        res = await makeRequest(token);
      }

      // Handle transient server errors (500/502/503) with one retry
      if (res.status >= 500) {
        console.warn(`[Spotify] Pathfinder server error (status ${res.status}). Retrying once...`);
        await new Promise((r) => setTimeout(r, 600));
        res = await makeRequest(token);
      }

      if (!res.ok) {
        throw new Error(`Spotify Pathfinder query failed with HTTP status ${res.status}`);
      }

      const json = await res.json();
      if (json.errors && json.errors.length > 0) {
        throw new Error(`Spotify Pathfinder error: ${json.errors[0]?.message || 'GraphQL error'}`);
      }

      const pl = json?.data?.playlistV2;
      if (!pl) {
        throw new Error('No playlist data in Spotify GraphQL response');
      }

      if (offset === 0) {
        playlistTitle = pl.name || playlistTitle;
        expectedTotal = pl.content?.totalCount || 0;
        const coverSource = pl.images?.items?.[0]?.sources?.[0]?.url;
        if (coverSource) {
          playlistArtworkUrl = coverSource;
        }
      }

      const rawItems = pl.content?.items || [];
      if (rawItems.length === 0) {
        // If we haven't reached expectedTotal, this is an unexpected premature termination
        if (expectedTotal > 0 && offset < expectedTotal) {
          throw new Error(`Spotify playlist pagination ended prematurely at offset ${offset} of ${expectedTotal} total items`);
        }
        break;
      }

      const prevTrackCount = allTracks.length;
      const parsedPageTracks = parsePathfinderItems(rawItems, offset, allTracks, seenSlots, seenUids);
      allTracks.push(...parsedPageTracks);

      offset += rawItems.length;
      page++;

      console.log(`[Spotify] Fetched playlist page ${page}: ${allTracks.length}/${expectedTotal} tracks (offset: ${offset})`);

      // Exit when all items have been retrieved or no more tracks available
      if (offset >= expectedTotal || rawItems.length < limit) {
        break;
      }

      // Safeguard against infinite loop if page returned no new valid tracks and made no progress
      if (allTracks.length === prevTrackCount && parsedPageTracks.length === 0 && rawItems.length === 0) {
        break;
      }
    }

    // Verify pagination did not silently truncate
    if (expectedTotal > 0 && allTracks.length === 0) {
      throw new Error(`Spotify playlist had ${expectedTotal} items but 0 playable tracks were parsed`);
    }

    graphQLSucceeded = true;
  } catch (err: any) {
    console.warn('[Spotify] GraphQL Pathfinder retrieval notice:', err.message || err);
    // If we already collected some pages or total was expected, DO NOT silently report partial playlist!
    if (allTracks.length > 0 || (expectedTotal && expectedTotal > 0)) {
      throw new Error(`Failed to complete playlist pagination: ${err.message || err}`);
    }
  }

  // 3. Fallback: Parse Embed HTML if GraphQL was completely unreachable (e.g. mock test environment)
  if (!graphQLSucceeded && allTracks.length === 0) {
    console.log('[Spotify] Falling back to embed HTML parsing...');
    const embedUrl = `https://open.spotify.com/embed/playlist/${id}`;
    const res = await fetch(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });

    if (res.ok) {
      const html = await res.text();
      const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
      if (nextDataMatch) {
        try {
          const data = JSON.parse(nextDataMatch[1]);
          const entity = data.props?.pageProps?.state?.data?.entity;
          if (entity) {
            playlistTitle = entity.name || entity.title || playlistTitle;
            if (entity.coverArt?.sources?.[0]?.url) {
              playlistArtworkUrl = entity.coverArt.sources[0].url;
            }

            if (Array.isArray(entity.trackList)) {
              for (const [idx, t] of entity.trackList.entries()) {
                const spotifyId = t.uri ? t.uri.replace('spotify:track:', '') : undefined;

                allTracks.push({
                  title: t.title || t.name || `Track ${idx + 1}`,
                  artist: t.subtitle || 'Unknown Artist',
                  album: 'Single',
                  trackNumber: idx + 1,
                  duration: t.duration ? Math.round(t.duration / 1000) : undefined,
                  artworkUrl: undefined,
                  spotifyId,
                });
              }
            }
          }
        } catch (e) {
          console.warn('[Spotify] Failed to parse playlist embed JSON:', e);
        }
      }
    }
  }

  // 4. Enrich tracks missing album or artwork (e.g. tracks from embed fallback)
  const concurrency = 5;
  for (let i = 0; i < allTracks.length; i += concurrency) {
    const batch = allTracks.slice(i, i + concurrency);
    await Promise.all(batch.map(async (t, batchIdx) => {
      const targetIdx = i + batchIdx;
      if (t.album && t.album !== 'Single' && t.artworkUrl) {
        return; // Already fully enriched
      }

      // Try Spotify track embed if spotifyId exists
      if (t.spotifyId) {
        try {
          const trackRes = await resolveSpotifyTrack(t.spotifyId);
          if (trackRes?.tracks?.[0]) {
            const tr = trackRes.tracks[0];
            allTracks[targetIdx] = {
              ...t,
              title: tr.title || t.title,
              artist: tr.artist || t.artist,
              album: (tr.album && tr.album !== 'Single') ? tr.album : (t.album || 'Single'),
              artworkUrl: tr.artworkUrl || t.artworkUrl,
              releaseYear: tr.releaseYear || t.releaseYear,
              duration: tr.duration || t.duration,
            };
            return;
          }
        } catch {}
      }

      // Fallback: iTunes search enrichment
      try {
        const itunesRes = await fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(`${t.artist} ${t.title}`)}&entity=song&limit=3`
        );
        if (itunesRes.ok) {
          const itunesData = await itunesRes.json();
          const cleanTTitle = cleanString(t.title);
          const cleanTArtist = cleanString(t.artist);
          const match = itunesData.results?.find((r: any) => {
            const matchTitle = cleanString(r.trackName);
            const matchArtist = cleanString(r.artistName);
            return (matchTitle.includes(cleanTTitle) || cleanTTitle.includes(matchTitle)) &&
                   (matchArtist.includes(cleanTArtist) || cleanTArtist.includes(matchArtist));
          });

          if (match) {
            allTracks[targetIdx] = {
              ...t,
              album: match.collectionName || t.album || 'Single',
              artworkUrl: match.artworkUrl100 ? match.artworkUrl100.replace('100x100bb', '600x600bb') : t.artworkUrl,
              releaseYear: match.releaseDate ? new Date(match.releaseDate).getFullYear() : t.releaseYear,
              duration: t.duration || Math.round((match.trackTimeMillis || 0) / 1000),
            };
          }
        }
      } catch {}

      if (!allTracks[targetIdx].album) {
        allTracks[targetIdx].album = 'Single';
      }
    }));
  }

  console.log(`[Spotify] Playlist resolved: "${playlistTitle}" with ${allTracks.length} tracks (artwork: ${Boolean(playlistArtworkUrl)})`);

  return {
    type: 'playlist',
    id,
    spotifyId: id,
    title: playlistTitle,
    artworkUrl: playlistArtworkUrl,
    totalTracks: allTracks.length,
    tracks: allTracks,
  };
}

