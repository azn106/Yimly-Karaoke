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
 * Resolve Spotify Track, Album, or Playlist to metadata
 */

/**
 * Best-effort anonymous Spotify text search for canonical track metadata.
 * Spotify's public search page is unofficial and may change; failures return
 * an empty list so Yimly can safely fall back to its existing catalogue search.
 */
const spotifyTextSearchCache = new Map<string, { at: number; tracks: SpotifyResolvedTrack[] }>();
export async function searchSpotifyTracks(query: string, limit = 10): Promise<SpotifyResolvedTrack[]> {
  const key = query.trim().toLowerCase();
  if (!key) return [];
  const cached = spotifyTextSearchCache.get(key);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.tracks.slice(0, limit);
  try {
    const response = await fetch(`https://open.spotify.com/search/${encodeURIComponent(query.trim())}/tracks`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    const html = await response.text();
    const ids = Array.from(new Set([
      ...Array.from(html.matchAll(/spotify:track:([A-Za-z0-9]{22})/g), m => m[1]),
      ...Array.from(html.matchAll(/open\.spotify\.com\/track\/([A-Za-z0-9]{22})/g), m => m[1]),
    ])).slice(0, Math.max(limit, 5));
    const resolved = await Promise.all(ids.map(id => resolveSpotifyTrack(id).catch(() => null)));
    const tracks = resolved
      .map(entity => entity?.tracks?.[0])
      .filter((track): track is SpotifyResolvedTrack => Boolean(track && track.title && track.artist));
    spotifyTextSearchCache.set(key, { at: Date.now(), tracks });
    return tracks.slice(0, limit);
  } catch (error) {
    console.warn('[Spotify Resolver] Text search unavailable; using fallback catalogue:', error);
    return [];
  }
}

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
    title: albumTitle,
    artist: albumArtist,
    artworkUrl,
    totalTracks: tracks.length,
    tracks,
  };
}

/**
 * Extract Spotify Playlist (Supports playlists of all sizes, resolves each track independently)
 */
async function resolveSpotifyPlaylist(id: string): Promise<SpotifyResolvedEntity> {
  const embedUrl = `https://open.spotify.com/embed/playlist/${id}`;
  const res = await fetch(embedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });

  let playlistTitle = 'Spotify Playlist';
  let playlistArtworkUrl = '';
  const rawTracks: SpotifyResolvedTrack[] = [];

  // 1. Fetch oEmbed for playlist title and thumbnail
  try {
    const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/playlist/${id}`)}`);
    if (oembedRes.ok) {
      const oembedData = await oembedRes.json();
      playlistTitle = oembedData.title || playlistTitle;
      playlistArtworkUrl = oembedData.thumbnail_url || playlistArtworkUrl;
    }
  } catch {}

  // 2. Parse Embed HTML JSON state
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
            entity.trackList.forEach((t: any, idx: number) => {
              // Critical: DO NOT assign playlistTitle as track album!
              // DO NOT assign playlistArtworkUrl as track artwork!
              rawTracks.push({
                title: t.title || t.name || `Track ${idx + 1}`,
                artist: t.subtitle || 'Unknown Artist',
                album: '', // Will be resolved per-track, never the playlist name
                trackNumber: idx + 1,
                duration: t.duration ? Math.round(t.duration / 1000) : undefined,
                artworkUrl: undefined, // Will be resolved per-track
                spotifyId: t.uri ? t.uri.replace('spotify:track:', '') : undefined,
              });
            });
          }
        }
      } catch (e) {
        console.warn('[Spotify] Failed to parse playlist embed JSON:', e);
      }
    }
  }

  // 3. Enrich tracks individually so each has its own album and album artwork
  const enrichedTracks: SpotifyResolvedTrack[] = [...rawTracks];
  const concurrency = 5;

  for (let i = 0; i < rawTracks.length; i += concurrency) {
    const batch = rawTracks.slice(i, i + concurrency);
    await Promise.all(batch.map(async (t, batchIdx) => {
      const targetIdx = i + batchIdx;

      // Try Spotify track embed if spotifyId exists
      if (t.spotifyId) {
        try {
          const trackRes = await resolveSpotifyTrack(t.spotifyId);
          if (trackRes?.tracks?.[0]) {
            const tr = trackRes.tracks[0];
            enrichedTracks[targetIdx] = {
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
            enrichedTracks[targetIdx] = {
              ...t,
              album: match.collectionName || t.album || 'Single',
              artworkUrl: match.artworkUrl100 ? match.artworkUrl100.replace('100x100bb', '600x600bb') : t.artworkUrl,
              releaseYear: match.releaseDate ? new Date(match.releaseDate).getFullYear() : t.releaseYear,
              duration: t.duration || Math.round((match.trackTimeMillis || 0) / 1000),
            };
          }
        }
      } catch {}

      // If no album was resolved, fallback to 'Single', never the playlist title
      if (!enrichedTracks[targetIdx].album) {
        enrichedTracks[targetIdx].album = 'Single';
      }
    }));
  }

  console.log(`[Spotify] Playlist resolved: "${playlistTitle}" with ${enrichedTracks.length} individual tracks enriched`);

  return {
    type: 'playlist',
    title: playlistTitle,
    artworkUrl: playlistArtworkUrl,
    totalTracks: enrichedTracks.length,
    tracks: enrichedTracks,
  };
}
