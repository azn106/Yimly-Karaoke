/**
 * Utility functions for resilient, comprehensive song searching in Yimly.
 * Handles:
 * - Case-insensitivity
 * - Accents & Diacritics (e.g. 'Beyoncé' -> 'beyonce')
 * - Straight and curly apostrophes / quotes (' ’ ` ‛ ′) so 'dont' matches "Don't" and "don't" matches "Don’t"
 * - Hyphens, dashes, and punctuation (e.g. 'Jay-Z' <-> 'Jay Z')
 * - Multi-word & cross-field searches (e.g. 'Ariana hate' matches "hate that i made you love me" by "Ariana Grande")
 * - Multiple artists in collaborations
 * - Missing or unusual metadata
 * - Collapsing extra whitespace
 */

export interface SearchableSong {
  id: number;
  title: string;
  artist?: string;
  artists?: Array<{ id?: number; name: string } | string>;
  album?: string;
  duration?: number;
  hasLrc?: boolean;
  hasElrc?: boolean;
  hasInstrumental?: boolean;
}

/**
 * Normalizes text for searching by stripping diacritics, quotes/apostrophes,
 * and converting symbols/punctuation to spaces.
 */
export function normalizeSearchText(text?: string | null): string {
  if (!text) return '';
  return text
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics / accent marks
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035']/g, '') // remove all variants of apostrophes & single quotes
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036"]/g, '') // remove double quotes
    .replace(/[-_./\\()[\]{}:;,!?*+~#@&|–—]/g, ' ') // treat separators, brackets, and punctuation as whitespace
    .replace(/\s+/g, ' ') // collapse multiple spaces
    .trim();
}

/**
 * Checks if a song matches a given search query.
 */
export function matchSong(song: SearchableSong, query: string): boolean {
  if (!query || !query.trim()) return true;

  const normQuery = normalizeSearchText(query);
  if (!normQuery) return true;

  const queryTokens = normQuery.split(' ').filter(Boolean);

  // Extract all artist names from the song
  let extraArtists = '';
  if (Array.isArray(song.artists)) {
    extraArtists = song.artists
      .map(a => (typeof a === 'string' ? a : a?.name || ''))
      .filter(Boolean)
      .join(' ');
  }

  // Combine title, primary artist, secondary/collaborating artists, and album
  const combinedMetadata = `${song.title || ''} ${song.artist || ''} ${extraArtists} ${song.album || ''}`;
  const normTarget = normalizeSearchText(combinedMetadata);

  // Direct whole-phrase substring match
  if (normTarget.includes(normQuery)) {
    return true;
  }

  // Token-based matching: every word in the query must match somewhere in the combined metadata
  return queryTokens.every(token => normTarget.includes(token));
}

/**
 * Filters a list of songs by search query using resilient matching.
 */
export function filterSongs<T extends SearchableSong>(songsList: T[], query: string): T[] {
  if (!query || !query.trim()) return songsList;
  return songsList.filter(song => matchSong(song, query));
}
