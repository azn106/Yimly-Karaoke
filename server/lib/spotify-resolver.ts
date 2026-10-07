/**
 * Spotify Metadata Resolver for Yimly
 * Extracts track lists, album info, and track metadata from Spotify URLs
 * without depending on yt-dlp (which fails on Spotify due to DRM checks).
 */

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
async function resolveSpotifyTrack(id: string): Promise<SpotifyResolvedEntity> {
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

  // Enrich with iTunes Search API if album or year missing
  if (album === 'Single' || !artworkUrl || !releaseYear) {
    try {
      const itunesRes = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(`${artist} ${title}`)}&entity=song&limit=1`
      );
      if (itunesRes.ok) {
        const itunesData = await itunesRes.json();
        if (itunesData.results?.[0]) {
          const match = itunesData.results[0];
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
          if (Array.isArray(entity.trackList) && entity.trackList.length > 0) {
            entity.trackList.forEach((t: any, idx: number) => {
              tracks.push({
                title: t.title || t.name || `Track ${idx + 1}`,
                artist: t.subtitle || albumArtist,
                album: albumTitle,
                trackNumber: t.trackNumber || idx + 1,
                duration: t.duration ? Math.round(t.duration / 1000) : undefined,
                artworkUrl,
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
              releaseYear: item.releaseDate ? new Date(item.releaseDate).getFullYear() : undefined,
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
 * Extract Spotify Playlist (Supports playlists of all sizes)
 */
async function resolveSpotifyPlaylist(id: string): Promise<SpotifyResolvedEntity> {
  const embedUrl = `https://open.spotify.com/embed/playlist/${id}`;
  const res = await fetch(embedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });

  let playlistTitle = 'Spotify Playlist';
  let artworkUrl = '';
  const tracks: SpotifyResolvedTrack[] = [];

  // 1. Fetch oEmbed for playlist title and thumbnail
  try {
    const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/playlist/${id}`)}`);
    if (oembedRes.ok) {
      const oembedData = await oembedRes.json();
      playlistTitle = oembedData.title || playlistTitle;
      artworkUrl = oembedData.thumbnail_url || artworkUrl;
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
            artworkUrl = entity.coverArt.sources[0].url;
          }

          if (Array.isArray(entity.trackList)) {
            entity.trackList.forEach((t: any, idx: number) => {
              tracks.push({
                title: t.title || t.name || `Track ${idx + 1}`,
                artist: t.subtitle || 'Unknown Artist',
                album: playlistTitle,
                trackNumber: idx + 1,
                duration: t.duration ? Math.round(t.duration / 1000) : undefined,
                artworkUrl,
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

  console.log(`[Spotify] Playlist resolved: "${playlistTitle}" (${tracks.length} tracks)`);

  return {
    type: 'playlist',
    title: playlistTitle,
    artworkUrl,
    totalTracks: tracks.length,
    tracks,
  };
}
