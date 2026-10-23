/**
 * Canonical Song Metadata Model for Yimly
 * 
 * Provides a single source of truth for song metadata across all entry points:
 * - Direct song search
 * - Spotify playlist & album imports
 * - YouTube link resolution
 * - Audio tagging and library indexing
 */

export interface CanonicalSongMetadata {
  title: string;
  artist: string;
  artists?: string[];
  album?: string;
  artworkUrl?: string;
  duration?: number; // Integer seconds
  trackNumber?: number;
  totalTracks?: number;
  discNumber?: number;
  releaseYear?: number;
  releaseDate?: string;
  spotifyId?: string;
  isrc?: string;
  inputUrl?: string;
  sourceType?: 'search' | 'spotify' | 'youtube' | 'custom';
  audioSourceUrl?: string; // Audio stream/video source URL, decoupled from metadata
  audioVideoId?: string;
  provenance?: string;
  confidence?: number;
}

export interface TrackIntent {
  rawTitle: string;
  coreTitle: string;
  mainArtist: string;
  featuredArtists: string[];
  allArtists: string[];
  isRemix: boolean;
  isLive: boolean;
  isKaraoke: boolean;
  isInstrumental: boolean;
  isAcoustic: boolean;
  isCover: boolean;
}

/**
 * Known generic playlist or default album placeholders that should never be
 * treated as valid track-specific album names.
 */
const PLAYLIST_ALBUM_PLACEHOLDERS = new Set([
  'spotify playlist',
  'youtube playlist',
  'youtube search',
  'playlist',
  'unknown album',
  'single',
  '',
]);

/**
 * Normalizes string for fuzzy/token comparison (lowercased, punctuation removed, single-spaced).
 */
export function cleanString(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[\(\)\[\]\{\}\-_–—]/g, ' ')
    .replace(/[^\w\s]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Analyzes track title and artist to detect recording intent (studio, live, remix, etc.)
 * and separate core title from featured artists and version tags.
 */
export function detectTrackIntent(title: string, artist: string): TrackIntent {
  let effectiveTitle = (title || '').trim();
  let effectiveArtist = (artist || '').trim();

  // Strip surrounding quotes from effective title
  effectiveTitle = effectiveTitle.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();

  // If artist is empty and title contains "Title by Artist", "Artist - Title", or featured artist patterns, extract them
  if (!effectiveArtist) {
    const byMatch = effectiveTitle.match(/^(.*?)\s+(?:by|from)\s+(.*)$/i);
    if (byMatch) {
      effectiveTitle = byMatch[1].trim();
      effectiveArtist = byMatch[2].trim();
    } else {
      const dashMatch = effectiveTitle.match(/^(.*?)\s*[-–—:]\s*(.*)$/);
      if (dashMatch) {
        effectiveArtist = dashMatch[1].trim();
        effectiveTitle = dashMatch[2].trim();
      } else {
        // Pattern: "Artist feat. FeaturedArtist Title" (e.g. "Chris Brown feat. Keri Hilson Superhuman")
        const featInMiddle = effectiveTitle.match(/^(.*?)\s+(?:featuring|feat\.?|ft\.?|with)\s+(.*)$/i);
        if (featInMiddle) {
          const mainA = featInMiddle[1].trim();
          const rest = featInMiddle[2].trim();
          const restWords = rest.split(/\s+/);
          if (restWords.length > 1) {
            effectiveTitle = restWords.slice(-1)[0];
            effectiveArtist = `${mainA} feat. ${restWords.slice(0, -1).join(' ')}`;
          } else {
            effectiveTitle = mainA;
            effectiveArtist = rest;
          }
        } else {
          // Do not guess title/artist boundaries from arbitrary word positions.
          // Queries such as "Ed Sheeran Shape of You" are ambiguous without a
          // separator or a natural-language marker. Keep the full query as the
          // title candidate and leave artist unknown so providers can resolve it.
        }
      }
    }
  }

  // Clean quotes again if extracted from byMatch
  effectiveTitle = effectiveTitle.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();

  const rawTitle = effectiveTitle;
  const rawArtist = effectiveArtist;

  const lowerTitle = rawTitle.toLowerCase();
  const lowerArtist = rawArtist.toLowerCase();

  // Version indicators
  const isRemix = /\b(remix|remixed|club mix|extended mix|vip mix|dub mix|mix)\b/i.test(lowerTitle) &&
    !/\b(original mix)\b/i.test(lowerTitle);
  const isLive = /\b(live|live at|live in|live from|in concert|unplugged)\b/i.test(lowerTitle);
  const isKaraoke = /\b(karaoke|sing-along|sing along|instrumental version)\b/i.test(lowerTitle) ||
    /\b(karaoke)\b/i.test(lowerArtist);
  const isInstrumental = /\b(instrumental|inst|backing track)\b/i.test(lowerTitle) && !isKaraoke;
  const isAcoustic = /\b(acoustic|stripped|unplugged)\b/i.test(lowerTitle);
  const isCover = /\b(cover|tribute|in the style of|originally performed by|made famous by)\b/i.test(lowerTitle) ||
    /\b(tribute|karaoke band|all-stars|orchestra)\b/i.test(lowerArtist);

  // Extract featured artists from title or artist: "(feat. Keri Hilson)", "[ft. Drake]", etc.
  const featuredArtists: string[] = [];
  const featMatch = rawTitle.match(/[\(\[\{]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^\]\)\}]+)[\)\]\}]/i)
    || rawTitle.match(/\s+(?:feat\.?|ft\.?|featuring|with)\s+([^-,()]+)/i)
    || rawArtist.match(/[\(\[\{]?\s*(?:feat\.?|ft\.?|featuring|with)\s+([^\]\)\}]+)[\)\]\}]?/i);

  if (featMatch && featMatch[1]) {
    const rawFeat = featMatch[1].trim();
    const parts = rawFeat.split(/[,&/]|(?:\s+and\s+)/i).map(s => s.trim()).filter(Boolean);
    featuredArtists.push(...parts);
  }

  // Parse artist field into primary and additional artists
  const artistParts = rawArtist
    .split(/[,&/]|(?:\s+(?:feat\.?|ft\.?|featuring|with|and)\s+)/i)
    .map(s => s.trim())
    .filter(Boolean);

  const mainArtist = artistParts[0] || rawArtist || 'Unknown Artist';
  const additionalArtists = artistParts.slice(1);
  for (const a of additionalArtists) {
    if (!featuredArtists.includes(a)) {
      featuredArtists.push(a);
    }
  }

  // Strip feature tags and video noise from core title
  let coreTitle = rawTitle
    .replace(/[\(\[\{]\s*(?:feat\.?|ft\.?|featuring|with)\s+[^\]\)\}]+[\)\]\}]/gi, '')
    .replace(/\s+(?:feat\.?|ft\.?|featuring|with)\s+[^-,()]+/gi, '')
    .replace(/[\(\[\{]\s*(?:official\s+|hd\s+|4k\s+|hq\s+|cdq\s+|remaster(?:ed)?\s+|audio\s+|video\s+|music\s+|lyric(?:s)?\s*)*(?:video|audio|visualizer|lyric(?:s)?(?:\s+video)?|hd|4k|hq|cdq|explicit|clean|remaster(?:ed)?|hq\/cdq|cdq\/hq)\s*[\)\]\}]/gi, '')
    .replace(/\s*-\s*(?:official\s+)?(?:music\s+)?(?:video|audio|lyrics)\s*$/gi, '')
    .trim();

  // If stripping left nothing, fallback to rawTitle
  if (!coreTitle) coreTitle = rawTitle;

  const allArtists = Array.from(new Set([mainArtist, ...featuredArtists])).filter(Boolean);

  return {
    rawTitle,
    coreTitle,
    mainArtist,
    featuredArtists,
    allArtists,
    isRemix,
    isLive,
    isKaraoke,
    isInstrumental,
    isAcoustic,
    isCover,
  };
}

/**
 * Normalizes and validates canonical metadata to prevent dirty values,
 * inconsistent duration units, or accidental loss of fields.
 */
export function normalizeCanonicalMetadata(raw: Partial<CanonicalSongMetadata>): CanonicalSongMetadata {
  const title = (raw.title || '').trim() || 'Unknown Title';
  const artist = (raw.artist || '').trim() || 'Unknown Artist';

  const intent = detectTrackIntent(title, artist);

  // Normalize duration: must be integer seconds
  let duration: number | undefined = undefined;
  if (typeof raw.duration === 'number' && !isNaN(raw.duration) && raw.duration > 0) {
    // If > 10000, likely milliseconds passed accidentally
    if (raw.duration > 10000) {
      duration = Math.round(raw.duration / 1000);
    } else {
      duration = Math.round(raw.duration);
    }
  }

  // Validate album: discard generic playlist names
  let album: string | undefined = undefined;
  if (raw.album && typeof raw.album === 'string') {
    const trimmedAlbum = raw.album.trim();
    if (trimmedAlbum && !PLAYLIST_ALBUM_PLACEHOLDERS.has(trimmedAlbum.toLowerCase())) {
      album = trimmedAlbum;
    }
  }

  // Validate artwork URL: only http/https URLs allowed
  let artworkUrl: string | undefined = undefined;
  if (raw.artworkUrl && typeof raw.artworkUrl === 'string') {
    const trimmedArt = raw.artworkUrl.trim();
    if (trimmedArt.startsWith('http://') || trimmedArt.startsWith('https://')) {
      artworkUrl = trimmedArt;
    }
  }

  const trackNumber = (typeof raw.trackNumber === 'number' && raw.trackNumber > 0)
    ? Math.floor(raw.trackNumber)
    : undefined;

  const discNumber = (typeof raw.discNumber === 'number' && raw.discNumber > 0)
    ? Math.floor(raw.discNumber)
    : undefined;

  const releaseYear = (typeof raw.releaseYear === 'number' && raw.releaseYear > 1900 && raw.releaseYear < 2100)
    ? Math.floor(raw.releaseYear)
    : undefined;

  return {
    title,
    artist,
    artists: intent.allArtists,
    album,
    artworkUrl,
    duration,
    trackNumber,
    totalTracks: raw.totalTracks,
    discNumber,
    releaseYear,
    releaseDate: raw.releaseDate,
    spotifyId: raw.spotifyId,
    isrc: raw.isrc,
    inputUrl: raw.inputUrl,
    sourceType: raw.sourceType || 'search',
    audioSourceUrl: raw.audioSourceUrl,
    audioVideoId: raw.audioVideoId,
    provenance: raw.provenance,
    confidence: raw.confidence,
  };
}
