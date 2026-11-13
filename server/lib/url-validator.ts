/**
 * URL Validation and SSRF Protection Utility for Yimly Downloader
 * 
 * Enforces strict validation on all external URLs to prevent:
 * - Server-Side Request Forgery (SSRF)
 * - Localhost / private subnet probing (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16)
 * - IPv6 loopback and link-local address probing (::1, fe80::/10, fc00::/7)
 * - User-info credential tricks (e.g. http://youtube.com@127.0.0.1/)
 * - Non-HTTP schemes (file://, gopher://, ftp://, data:, javascript:)
 * - Hostname spoofing / subdomain deceptive domains (e.g. youtube.com.evil.example)
 * - Command injection or parameter injection into yt-dlp
 */

export interface YouTubeValidationResult {
  valid: boolean;
  canonicalUrl?: string;
  videoId?: string;
  playlistId?: string;
  isPlaylist?: boolean;
  error?: string;
}

export interface ValidateYouTubeOptions {
  allowPlaylist?: boolean;
}

export interface SpotifyValidationResult {
  valid: boolean;
  type?: 'track' | 'album' | 'playlist';
  id?: string;
  canonicalUrl?: string;
  error?: string;
}

const ALLOWED_YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

const ALLOWED_SPOTIFY_HOSTS = new Set([
  'open.spotify.com',
  'spotify.com',
]);

const YOUTUBE_VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
const YOUTUBE_PLAYLIST_ID_REGEX = /^[a-zA-Z0-9_-]{10,64}$/;
const SPOTIFY_ID_REGEX = /^[a-zA-Z0-9]{15,35}$/;

/**
 * Checks whether a host or IP is private, loopback, link-local, or otherwise blocked from external fetch.
 */
export function isPrivateOrBlockedHost(hostOrIp?: string | null): boolean {
  if (!hostOrIp || typeof hostOrIp !== 'string') return true;

  // Strip brackets from IPv6 and trailing dot from FQDN
  const h = hostOrIp.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');

  if (!h) return true;

  // Localhost aliases & local domain suffixes
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === 'local' ||
    h.endsWith('.local') ||
    h === 'internal' ||
    h.endsWith('.internal') ||
    h === 'test' ||
    h.endsWith('.test')
  ) {
    return true;
  }

  // IPv4 dotted-quad checks
  const ipv4Match = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1, 5).map(Number);
    if (octets.some(o => o < 0 || o > 255)) return true;
    const [a, b, c, d] = octets;

    if (a === 127) return true; // 127.0.0.0/8 (Loopback)
    if (a === 10) return true;  // 10.0.0.0/8 (Private network)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 (Private network)
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 (Private network)
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 (Link-local / cloud metadata)
    if (a === 0) return true;   // 0.0.0.0/8 (Current network)
    if (a === 255 && b === 255 && c === 255 && d === 255) return true; // Broadcast
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (Carrier-grade NAT)
  }

  // Integer / Hex / Octal representations of IP (e.g. 2130706433, 0x7f000001, 017700000001)
  if (/^(?:0x[0-9a-fA-F]+|\d+)$/.test(h)) {
    return true;
  }

  // IPv6 representations
  if (
    h === '::1' ||
    h === '::' ||
    h.startsWith('::ffff:') || // IPv4-mapped IPv6
    h.startsWith('fe80:') ||   // Link-local
    h.startsWith('fc00:') ||   // Unique local address
    h.startsWith('fd00:')      // Unique local address
  ) {
    return true;
  }

  return false;
}

/**
 * Validates that an artwork or cover image URL is safe to fetch via HTTP/HTTPS.
 */
export function isValidArtworkUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return false;

  // Whitespace or control character check
  if (/[\r\n\t\0\s]/.test(trimmed)) return false;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    if (parsed.port && parsed.port !== '80' && parsed.port !== '443') return false;

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (!hostname || !hostname.includes('.')) return false;
    if (isPrivateOrBlockedHost(hostname)) return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * Determines whether a user input string is an attempt to pass a URL or URI rather than a text search query.
 */
export function isUrlOrUri(input: string): boolean {
  if (!input || typeof input !== 'string') return false;
  const trimmed = input.trim();
  if (!trimmed) return false;

  // Starts with explicit protocol / scheme: http://, https://, file://, ftp://, gopher://, spotify:, etc.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(trimmed)) return true;
  if (/^spotify:(?:track|album|playlist):/i.test(trimmed)) return true;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:[^ ]/i.test(trimmed) && !trimmed.includes(' ')) return true;

  // Starts with protocol-relative "//"
  if (trimmed.startsWith('//')) return true;

  // Check for common URL domain prefixes without scheme: e.g. youtube.com/..., youtu.be/..., open.spotify.com/...
  if (/^(?:www\.|m\.|music\.)?youtube\.com\//i.test(trimmed)) return true;
  if (/^youtu\.be\//i.test(trimmed)) return true;
  if (/^(?:open\.)?spotify\.com\//i.test(trimmed)) return true;

  // Check if string contains user-info (@) or ip:port with no spaces
  if (!trimmed.includes(' ') && /@/i.test(trimmed) && trimmed.includes('/')) return true;

  // Check if single token can be parsed as URL with known domain extension or IP
  if (!trimmed.includes(' ') && (trimmed.includes('/') || trimmed.includes('?'))) {
    try {
      const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
      if (parsed.hostname.includes('.') || isPrivateOrBlockedHost(parsed.hostname)) {
        return true;
      }
    } catch {}
  }

  return false;
}

/**
 * Validates and canonicalizes a YouTube URL.
 * 
 * Guarantees that:
 * - Only official YouTube domains are accepted (youtube.com, www.youtube.com, m.youtube.com, music.youtube.com, youtu.be).
 * - No user-info (credentials) can be present.
 * - Ports are default (80/443).
 * - Video IDs strictly match 11 alphanumeric characters [a-zA-Z0-9_-]{11}.
 * - Playlist IDs strictly match 10-64 characters [a-zA-Z0-9_-]{10,64}.
 * - Canonical output is strictly https://www.youtube.com/watch?v=<id> (or with &list=<listId>).
 * - Untrusted client parameters, extra query flags, or shell metacharacters are completely stripped.
 */
export function validateAndCanonicalizeYouTubeUrl(
  rawUrl: string,
  options: ValidateYouTubeOptions = {}
): YouTubeValidationResult {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'URL must be a non-empty string' };
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, error: 'URL cannot be empty' };
  }

  // Reject newlines, control characters, tabs, or whitespace within URL
  if (/[\r\n\t\0\s]/.test(trimmed)) {
    return { valid: false, error: 'URL contains invalid whitespace or control characters' };
  }

  // Reject argument-injection flags
  if (trimmed.startsWith('-')) {
    return { valid: false, error: 'URL cannot begin with command-line flags' };
  }

  let parsed: URL;
  try {
    let toParse = trimmed;
    if (toParse.startsWith('//')) {
      toParse = `https:${toParse}`;
    } else if (!toParse.includes('://')) {
      toParse = `https://${toParse}`;
    }
    parsed = new URL(toParse);
  } catch {
    return { valid: false, error: 'Malformed URL structure' };
  }

  // 1. Protocol check
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: `Invalid protocol "${parsed.protocol}". Only HTTP and HTTPS are permitted.`,
    };
  }

  // 2. User-info check (SSRF and authentication bypass prevention)
  if (parsed.username || parsed.password) {
    return {
      valid: false,
      error: 'URLs with embedded user credentials (user-info) are strictly prohibited',
    };
  }

  // 3. Hostname normalization & strict whitelist check
  const rawHostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!ALLOWED_YOUTUBE_HOSTS.has(rawHostname)) {
    return {
      valid: false,
      error: `Disallowed host "${rawHostname}". Only official YouTube domains are permitted.`,
    };
  }

  // 4. Port check: only default HTTP/HTTPS ports permitted
  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
    return {
      valid: false,
      error: `Disallowed port "${parsed.port}". Only default HTTP/HTTPS ports are permitted.`,
    };
  }

  // 5. Path and Parameter Extraction & Validation
  const allowPlaylist = options.allowPlaylist ?? false;

  // Case A: youtu.be/<id>
  if (rawHostname === 'youtu.be') {
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length === 0) {
      return { valid: false, error: 'Missing video ID in youtu.be URL' };
    }

    const candidateId = segments[0];
    if (!YOUTUBE_VIDEO_ID_REGEX.test(candidateId)) {
      return { valid: false, error: 'Invalid YouTube video ID format in youtu.be URL' };
    }

    const candidateList = parsed.searchParams.get('list');
    let playlistId: string | undefined;
    if (candidateList) {
      if (!YOUTUBE_PLAYLIST_ID_REGEX.test(candidateList)) {
        return { valid: false, error: 'Invalid playlist ID format' };
      }
      if (allowPlaylist) {
        playlistId = candidateList;
      }
    }

    const canonicalUrl = playlistId
      ? `https://www.youtube.com/watch?v=${candidateId}&list=${playlistId}`
      : `https://www.youtube.com/watch?v=${candidateId}`;

    return {
      valid: true,
      canonicalUrl,
      videoId: candidateId,
      playlistId,
      isPlaylist: Boolean(playlistId),
    };
  }

  // Case B: youtube.com, www.youtube.com, m.youtube.com, music.youtube.com
  const pathname = parsed.pathname;

  // Subcase B1: /watch
  if (pathname === '/watch' || pathname.startsWith('/watch/')) {
    const candidateId = parsed.searchParams.get('v');
    if (!candidateId || !YOUTUBE_VIDEO_ID_REGEX.test(candidateId)) {
      return { valid: false, error: 'Missing or invalid YouTube video ID ("v" parameter)' };
    }

    const candidateList = parsed.searchParams.get('list');
    let playlistId: string | undefined;
    if (candidateList) {
      if (!YOUTUBE_PLAYLIST_ID_REGEX.test(candidateList)) {
        return { valid: false, error: 'Invalid playlist ID format' };
      }
      if (allowPlaylist) {
        playlistId = candidateList;
      }
    }

    const canonicalUrl = playlistId
      ? `https://www.youtube.com/watch?v=${candidateId}&list=${playlistId}`
      : `https://www.youtube.com/watch?v=${candidateId}`;

    return {
      valid: true,
      canonicalUrl,
      videoId: candidateId,
      playlistId,
      isPlaylist: Boolean(playlistId),
    };
  }

  // Subcase B2: /shorts/<id>, /embed/<id>, /v/<id>
  const segments = pathname.split('/').filter(Boolean);
  const prefix = segments[0]?.toLowerCase();
  if ((prefix === 'shorts' || prefix === 'embed' || prefix === 'v') && segments[1]) {
    const candidateId = segments[1];
    if (!YOUTUBE_VIDEO_ID_REGEX.test(candidateId)) {
      return { valid: false, error: `Invalid YouTube video ID format in /${prefix}/ path` };
    }

    return {
      valid: true,
      canonicalUrl: `https://www.youtube.com/watch?v=${candidateId}`,
      videoId: candidateId,
      isPlaylist: false,
    };
  }

  // Subcase B3: /playlist
  if (pathname === '/playlist' || pathname.startsWith('/playlist/')) {
    if (!allowPlaylist) {
      return { valid: false, error: 'Playlist URLs are not permitted for single-track audio downloads' };
    }

    const candidateList = parsed.searchParams.get('list');
    if (!candidateList || !YOUTUBE_PLAYLIST_ID_REGEX.test(candidateList)) {
      return { valid: false, error: 'Missing or invalid playlist ID in playlist URL' };
    }

    const candidateId = parsed.searchParams.get('v');
    let videoId: string | undefined;
    if (candidateId && YOUTUBE_VIDEO_ID_REGEX.test(candidateId)) {
      videoId = candidateId;
    }

    const canonicalUrl = videoId
      ? `https://www.youtube.com/watch?v=${videoId}&list=${candidateList}`
      : `https://www.youtube.com/playlist?list=${candidateList}`;

    return {
      valid: true,
      canonicalUrl,
      videoId,
      playlistId: candidateList,
      isPlaylist: true,
    };
  }

  return {
    valid: false,
    error: `Unsupported YouTube path "${pathname}". Only /watch, /shorts, /embed, and /playlist are supported.`,
  };
}

/**
 * Validates and canonicalizes a Spotify URL or URI.
 */
export function validateSpotifyUrl(input: string): SpotifyValidationResult {
  if (!input || typeof input !== 'string') {
    return { valid: false, error: 'Input must be a non-empty string' };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return { valid: false, error: 'Input cannot be empty' };
  }

  if (/[\r\n\t\0\s]/.test(trimmed)) {
    return { valid: false, error: 'Spotify URL contains invalid whitespace or control characters' };
  }

  // Format: spotify:(track|album|playlist):<id>
  const uriMatch = trimmed.match(/^spotify:(track|album|playlist):([a-zA-Z0-9]{15,35})$/i);
  if (uriMatch) {
    const type = uriMatch[1].toLowerCase() as 'track' | 'album' | 'playlist';
    const id = uriMatch[2];
    return {
      valid: true,
      type,
      id,
      canonicalUrl: `https://open.spotify.com/${type}/${id}`,
    };
  }

  let parsed: URL;
  try {
    const toParse = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
    parsed = new URL(toParse);
  } catch {
    return { valid: false, error: 'Malformed Spotify URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: 'Only HTTP and HTTPS protocols are permitted for Spotify URLs' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, error: 'URLs with embedded user credentials are not permitted' };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!ALLOWED_SPOTIFY_HOSTS.has(hostname)) {
    return { valid: false, error: `Disallowed Spotify host "${hostname}"` };
  }

  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
    return { valid: false, error: `Disallowed port "${parsed.port}"` };
  }

  // Match /track/<id>, /album/<id>, /playlist/<id>, or /intl-<lang>/<type>/<id>
  const match = parsed.pathname.match(/^(?:\/[a-zA-Z0-9_-]+)?\/(track|album|playlist)\/([a-zA-Z0-9]{15,35})/i);
  if (!match) {
    return { valid: false, error: 'URL does not point to a valid Spotify track, album, or playlist' };
  }

  const type = match[1].toLowerCase() as 'track' | 'album' | 'playlist';
  const id = match[2];

  return {
    valid: true,
    type,
    id,
    canonicalUrl: `https://open.spotify.com/${type}/${id}`,
  };
}
