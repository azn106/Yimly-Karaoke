/**
 * YouTube Music Search & Audio Matching Engine (Downtify Architecture)
 * 
 * Searches YouTube Music via WEB_REMIX & InnerTube APIs and matches Spotify tracks
 * using title, artist, and duration comparisons with strict tolerance preferences (<= 10s).
 */

export interface SpotifyTrackMeta {
  title: string;
  artist: string;
  album?: string;
  duration?: number; // duration in seconds
  releaseYear?: number;
}

export interface YouTubeCandidate {
  id: string;
  url: string;
  title: string;
  artist: string;
  album?: string;
  duration: number; // in seconds
  durationText?: string;
  isTopic?: boolean;
  isOfficial?: boolean;
  thumbnailUrl?: string;
}

export interface MatchedResult {
  candidate: YouTubeCandidate;
  score: number;
  durationDiff: number;
  isCloseDuration: boolean; // within 10s
}

/**
 * Parses duration string (e.g. "3:33", "03:33", "1:02:15") into total seconds.
 */
export function parseDurationSeconds(text?: string): number {
  if (!text) return 0;
  const clean = text.trim().replace(/[^\d:]/g, '');
  const parts = clean.split(':').map(p => parseInt(p, 10));
  if (parts.some(isNaN) || parts.length === 0) return 0;
  
  if (parts.length === 1) {
    return parts[0];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

function cleanString(str: string): string {
  return str
    .toLowerCase()
    .replace(/[\(\)\[\]\{\}\-_]/g, ' ')
    .replace(/[^\w\s]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Search YouTube Music & YouTube InnerTube for audio candidates
 */
export async function searchYouTubeCandidates(query: string): Promise<YouTubeCandidate[]> {
  const candidates: YouTubeCandidate[] = [];
  const seenIds = new Set<string>();

  // 1. YouTube Music WEB_REMIX search endpoint (Songs filter: Eg-KAQwIABAAGAEgASgB)
  try {
    const ytMusicRes = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://music.youtube.com/',
        'Origin': 'https://music.youtube.com',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: '1.20240401.01.00',
            hl: 'en',
            gl: 'US',
          },
        },
        query,
        params: 'Eg-KAQwIABAAGAEgASgB',
      }),
    });

    if (ytMusicRes.ok) {
      const data = await ytMusicRes.json();
      const sectionList = data.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents
        || data.contents?.sectionListRenderer?.contents;

      if (Array.isArray(sectionList)) {
        for (const sec of sectionList) {
          const items = sec.itemSectionRenderer?.contents
            || sec.musicShelfRenderer?.contents
            || sec.musicCardShelfRenderer?.contents
            || [];

          for (const item of items) {
            const r = item.musicResponsiveListItemRenderer;
            if (r) {
              const videoId = r.playlistItemData?.videoId
                || r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId
                || r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;

              if (!videoId || seenIds.has(videoId)) continue;

              const title = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || '';
              const col1Runs = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
              const col2Runs = r.flexColumns?.[2]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
              const fixedRuns = r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs || [];

              const allRuns = [...col1Runs, ...col2Runs, ...fixedRuns];
              let durationText = '';
              let artist = '';
              let album = '';

              for (const run of allRuns) {
                const txt = run.text?.trim();
                if (/^\d+:\d{2}(:\d{2})?$/.test(txt)) {
                  durationText = txt;
                }
              }

              const artistRuns = col1Runs.filter((x: any) => 
                x.text && x.text !== ' • ' && !x.text.includes('plays') && !x.text.includes('views') && x.text !== 'Song' && x.text !== 'Video'
              );
              if (artistRuns.length > 0) {
                artist = artistRuns.map((a: any) => a.text).join(', ');
              }

              seenIds.add(videoId);
              candidates.push({
                id: videoId,
                url: `https://www.youtube.com/watch?v=${videoId}`,
                title,
                artist,
                album,
                duration: parseDurationSeconds(durationText),
                durationText,
                isTopic: artist.toLowerCase().includes('topic'),
                isOfficial: true,
              });
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[YTMusic Matcher] YouTube Music API query notice:', err);
  }

  // 2. YouTube Search API (InnerTube WEB client) for audio & duration metadata
  try {
    const ytRes = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        context: {
          client: {
            hl: 'en',
            gl: 'US',
            clientName: 'WEB',
            clientVersion: '2.20240401.00.00',
          },
        },
        query: `${query} audio`,
      }),
    });

    if (ytRes.ok) {
      const data = await ytRes.json();
      const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
      if (Array.isArray(contents)) {
        for (const section of contents) {
          const items = section.itemSectionRenderer?.contents;
          if (Array.isArray(items)) {
            for (const item of items) {
              const v = item.videoRenderer;
              if (v && v.videoId && !seenIds.has(v.videoId)) {
                const title = v.title?.runs?.[0]?.text || '';
                const uploader = v.ownerText?.runs?.[0]?.text || '';
                const durationText = v.lengthText?.simpleText || '';

                seenIds.add(v.videoId);
                candidates.push({
                  id: v.videoId,
                  url: `https://www.youtube.com/watch?v=${v.videoId}`,
                  title,
                  artist: uploader,
                  duration: parseDurationSeconds(durationText),
                  durationText,
                  isTopic: uploader.toLowerCase().includes('- topic'),
                  isOfficial: uploader.toLowerCase().includes('vevo') || title.toLowerCase().includes('official'),
                });
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[YTMusic Matcher] YouTube InnerTube API query notice:', err);
  }

  return candidates;
}

/**
 * Score and rank a YouTube candidate against the Spotify track metadata
 */
export function scoreCandidate(spotifyTrack: SpotifyTrackMeta, candidate: YouTubeCandidate): MatchedResult {
  let score = 0;
  const cleanSpotifyTitle = cleanString(spotifyTrack.title);
  const cleanSpotifyArtist = cleanString(spotifyTrack.artist);
  const cleanCandTitle = cleanString(candidate.title);
  const cleanCandArtist = cleanString(candidate.artist);

  // 1. Title Similarity Matching
  if (cleanCandTitle === cleanSpotifyTitle) {
    score += 100;
  } else if (cleanCandTitle.includes(cleanSpotifyTitle)) {
    score += 80;
  } else {
    const spWords = cleanSpotifyTitle.split(' ').filter(w => w.length > 2);
    const matchedWords = spWords.filter(w => cleanCandTitle.includes(w));
    if (spWords.length > 0) {
      score += Math.round((matchedWords.length / spWords.length) * 60);
    }
  }

  // 2. Artist Matching
  const artistParts = spotifyTrack.artist
    .split(/[,&/]|feat\.?|ft\.?/i)
    .map(a => cleanString(a))
    .filter(a => a.length > 1);

  let artistMatched = false;
  for (const part of artistParts) {
    if (cleanCandArtist.includes(part) || cleanCandTitle.includes(part)) {
      score += 40;
      artistMatched = true;
      break;
    }
  }
  if (!artistMatched && cleanCandArtist.includes(cleanSpotifyArtist)) {
    score += 40;
  }

  // 3. Official Release and Topic Channel Bonuses
  if (candidate.isTopic) score += 35;
  if (candidate.isOfficial) score += 20;
  if (candidate.title.toLowerCase().includes('official audio')) score += 30;

  // 4. Version Penalties (avoid covers, karaoke, live, acoustic, etc. unless in original title)
  const unwantedTerms = [
    'cover', 'karaoke', 'instrumental', 'tribute', 'parody', 
    'reaction', 'slowed', 'reverb', '8d', 'nightcore', 
    'pianoforte', 'acoustic', 'orchestral', 'sped up', 'speed up'
  ];
  for (const term of unwantedTerms) {
    if (cleanCandTitle.includes(term) && !cleanSpotifyTitle.includes(term)) {
      score -= 80;
    }
  }

  // Live penalty
  if (cleanCandTitle.includes('live') && !cleanSpotifyTitle.includes('live')) {
    score -= 40;
  }

  // Remix penalty
  if (cleanCandTitle.includes('remix') && !cleanSpotifyTitle.includes('remix')) {
    score -= 35;
  }

  // 5. Duration Matching (Downtify ~10s preference rule)
  let durationDiff = 999;
  let isCloseDuration = false;

  if (spotifyTrack.duration && spotifyTrack.duration > 0 && candidate.duration > 0) {
    durationDiff = Math.abs(candidate.duration - spotifyTrack.duration);

    if (durationDiff <= 3) {
      score += 100;
      isCloseDuration = true;
    } else if (durationDiff <= 10) {
      score += 75;
      isCloseDuration = true;
    } else if (durationDiff <= 20) {
      score += 35;
    } else if (durationDiff <= 40) {
      score += 10;
    } else if (durationDiff > 60) {
      score -= Math.min(100, Math.round((durationDiff - 60) * 1.5));
    }
  }

  return {
    candidate,
    score,
    durationDiff,
    isCloseDuration,
  };
}

/**
 * Match a Spotify track to the best matching YouTube/YouTube Music URL.
 * Follows Downtify's 3-stage matching pipeline:
 * 1. Queries YouTube Music using track title + artist
 * 2. Compares candidate durations against Spotify duration (preferring within ~10s)
 * 3. Returns the highest-scoring candidate URL with sensible fallback.
 */
export async function matchSpotifyTrackToYouTube(spotifyTrack: SpotifyTrackMeta): Promise<MatchedResult | null> {
  const query = `${spotifyTrack.artist} - ${spotifyTrack.title}`;
  console.log(`[YTMusic Matcher] Matching: "${query}" (Expected duration: ${spotifyTrack.duration || 'unknown'}s)`);

  const candidates = await searchYouTubeCandidates(query);
  if (candidates.length === 0) {
    console.warn(`[YTMusic Matcher] No candidates found for "${query}"`);
    return null;
  }

  const scored = candidates.map(c => scoreCandidate(spotifyTrack, c));
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];

  // If top candidate has a positive score, select it
  if (best.score > 0) {
    console.log(`[YTMusic Matcher] Selected: "${best.candidate.title}" (${best.candidate.duration}s, Diff: ${best.durationDiff}s, URL: ${best.candidate.url})`);
    return best;
  }

  // Fallback: Pick candidate with the closest duration match if available
  const durationCandidates = scored.filter(s => s.candidate.duration > 0).sort((a, b) => a.durationDiff - b.durationDiff);
  if (durationCandidates.length > 0) {
    const fallback = durationCandidates[0];
    console.log(`[YTMusic Matcher] Fallback selection (closest duration): "${fallback.candidate.title}" (Diff: ${fallback.durationDiff}s)`);
    return fallback;
  }

  // Ultimate fallback: return first candidate
  return best;
}
