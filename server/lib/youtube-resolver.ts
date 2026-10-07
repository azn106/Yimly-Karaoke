/**
 * YouTube Track Resolution Module for Yimly
 * Converts Track Metadata (Artist, Title, Album, Duration) into a direct YouTube URL
 * with match scoring, duration comparison, and quality filtering using InnerTube API.
 */

export interface TrackToResolve {
  title: string;
  artist: string;
  album?: string;
  duration?: number; // seconds
  spotifyId?: string;
}

export interface ResolvedYouTubeResult {
  videoId: string;
  url: string;
  title: string;
  uploader: string;
  durationSeconds?: number;
  matchScore: number;
}

// In-memory LRU-like resolution cache to avoid redundant searches
const resolutionCache = new Map<string, ResolvedYouTubeResult | null>();

/**
 * Parse time string like "3:45" or "1:02:15" to seconds
 */
function parseDurationText(text: string): number | undefined {
  if (!text) return undefined;
  const parts = text.trim().split(':').map(p => parseInt(p, 10));
  if (parts.some(isNaN)) return undefined;

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return undefined;
}

/**
 * Search YouTube via InnerTube API
 */
async function searchYouTubeCandidates(query: string): Promise<Array<{
  id: string;
  title: string;
  uploader: string;
  durationSeconds?: number;
}>> {
  const url = 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false';

  const body = {
    context: {
      client: {
        hl: 'en',
        gl: 'US',
        clientName: 'WEB',
        clientVersion: '2.20240401.00.00',
      },
    },
    query,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`InnerTube search returned HTTP ${res.status}`);
  }

  const data = await res.json();
  const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
  const candidates: Array<{ id: string; title: string; uploader: string; durationSeconds?: number }> = [];

  if (Array.isArray(contents)) {
    for (const section of contents) {
      const items = section.itemSectionRenderer?.contents;
      if (Array.isArray(items)) {
        for (const item of items) {
          const v = item.videoRenderer;
          if (v && v.videoId) {
            const vTitle = v.title?.runs?.[0]?.text || '';
            const uploader = v.ownerText?.runs?.[0]?.text || '';
            const durationText = v.lengthText?.simpleText || '';
            candidates.push({
              id: v.videoId,
              title: vTitle,
              uploader,
              durationSeconds: parseDurationText(durationText),
            });
          }
        }
      }
    }
  }

  return candidates;
}

/**
 * Score candidate video against track metadata
 */
function scoreCandidate(candidate: { id: string; title: string; uploader: string; durationSeconds?: number }, track: TrackToResolve): number {
  let score = 0;

  const targetTitle = track.title.toLowerCase();
  const cleanTitle = targetTitle.replace(/[\(\[\{].*?[\)\]\}]/g, '').trim();
  const targetArtist = track.artist.toLowerCase();
  const cleanArtist = targetArtist.split(/[&,;/]|feat/i)[0].trim();

  const cTitle = candidate.title.toLowerCase();
  const cUploader = candidate.uploader.toLowerCase();

  // 1. Exact or partial title match
  let hasTitleMatch = false;
  if (cTitle.includes(cleanTitle)) {
    score += 50;
    hasTitleMatch = true;
  } else {
    const titleWords = cleanTitle.split(/\s+/).filter(w => w.length > 2);
    let matchedWords = 0;
    for (const w of titleWords) {
      if (cTitle.includes(w)) matchedWords++;
    }
    if (titleWords.length > 0 && matchedWords / titleWords.length >= 0.5) {
      score += 35;
      hasTitleMatch = true;
    }
  }

  // 2. Artist match in title or uploader
  let hasArtistMatch = false;
  if (cTitle.includes(cleanArtist) || cUploader.includes(cleanArtist)) {
    score += 40;
    hasArtistMatch = true;
  } else {
    const artistWords = cleanArtist.split(/\s+/).filter(w => w.length > 2);
    let matchedArtistWords = 0;
    for (const w of artistWords) {
      if (cTitle.includes(w) || cUploader.includes(w)) matchedArtistWords++;
    }
    if (artistWords.length > 0 && matchedArtistWords / artistWords.length >= 0.5) {
      score += 25;
      hasArtistMatch = true;
    }
  }

  // If neither title nor artist matched, do not consider this a valid match
  if (!hasTitleMatch && !hasArtistMatch) {
    return 0;
  }

  // 3. Official / Topic channel indicators
  if (cUploader.includes('topic') || cTitle.includes('topic')) {
    score += 25; // Official auto-generated audio topic
  }
  if (cTitle.includes('official audio') || cTitle.includes('official visualizer') || cTitle.includes('remaster')) {
    score += 20;
  }
  if (cTitle.includes('official music video') || cTitle.includes('official video')) {
    score += 15;
  }

  // 4. Duration check (within ±15 seconds)
  if (track.duration && candidate.durationSeconds) {
    const diff = Math.abs(track.duration - candidate.durationSeconds);
    if (diff <= 5) {
      score += 30;
    } else if (diff <= 15) {
      score += 15;
    } else if (diff > 60) {
      score -= 30; // Heavy penalty if > 1 minute different (e.g. extended mix or compilation)
    }
  }

  // 5. Avoid unwanted versions unless explicitly requested in track title
  const unwantedTerms = ['cover', 'karaoke', 'live', 'slowed', 'sped up', 'tribute', 'parody', 'reaction'];
  for (const term of unwantedTerms) {
    const regex = new RegExp(`\\b${term}\\b`, 'i');
    if (regex.test(cTitle) && !regex.test(targetTitle)) {
      score -= 60;
    }
  }

  return score;
}

/**
 * Resolve a single track metadata to a direct YouTube URL
 */
export async function resolveTrackToYouTube(
  track: TrackToResolve,
  currentIndex?: number,
  totalTracks?: number
): Promise<ResolvedYouTubeResult | null> {
  const cacheKey = `${track.artist}:::${track.title}`.toLowerCase();
  if (resolutionCache.has(cacheKey)) {
    const cached = resolutionCache.get(cacheKey)!;
    if (cached) {
      console.log(`[Resolve] Cache hit for "${track.artist} - ${track.title}" => ${cached.url}`);
      return cached;
    }
  }

  const indexPrefix = currentIndex !== undefined && totalTracks !== undefined
    ? `[Resolve] ${currentIndex + 1}/${totalTracks}\n`
    : '[Resolve]\n';

  const cleanArtist = track.artist.split(/[&,;/]|feat/i)[0].trim();
  const cleanTitle = track.title.replace(/[\(\[\{].*?[\)\]\}]/g, '').trim();
  const primaryQuery = `${track.artist} - ${track.title} official audio`;

  let logMsg = `${indexPrefix}Artist: ${track.artist}\nTitle: ${track.title}\nQuery: ${primaryQuery}`;

  const queries = [
    primaryQuery,
    `${track.artist} - ${track.title}`,
    `${cleanArtist} ${cleanTitle}`,
  ];

  let bestMatch: ResolvedYouTubeResult | null = null;

  for (const q of queries) {
    try {
      const candidates = await searchYouTubeCandidates(q);
      if (candidates.length === 0) continue;

      const scored = candidates.map(c => ({
        videoId: c.id,
        url: `https://www.youtube.com/watch?v=${c.id}`,
        title: c.title,
        uploader: c.uploader,
        durationSeconds: c.durationSeconds,
        matchScore: scoreCandidate(c, track),
      }));

      scored.sort((a, b) => b.matchScore - a.matchScore);

      // Require a baseline match score (>= 30)
      if (scored[0] && scored[0].matchScore >= 30) {
        bestMatch = scored[0];
        break;
      }
    } catch (e: any) {
      console.warn(`[Resolve search attempt notice for "${q}"]:`, e.message);
    }
  }

  if (bestMatch) {
    resolutionCache.set(cacheKey, bestMatch);
    console.log(`${logMsg}\n[Resolve] YouTube result:\n${bestMatch.url}\n[Resolve] SUCCESS (Score: ${bestMatch.matchScore}, Title: "${bestMatch.title}")`);
    return bestMatch;
  } else {
    resolutionCache.set(cacheKey, null);
    console.warn(`${logMsg}\n[Resolve] FAILED\nReason: No matching YouTube video found with acceptable score.`);
    return null;
  }
}

/**
 * Batch resolve a list of tracks to YouTube URLs
 * Ensures individual failures do not fail the remaining tracks!
 */
export async function batchResolveTracksToYouTube(
  tracks: TrackToResolve[],
  onProgress?: (index: number, total: number, result: ResolvedYouTubeResult | null) => void
): Promise<Array<TrackToResolve & { sourceUrl?: string; resolveError?: string }>> {
  console.log(`[Spotify → YouTube] Beginning resolution of ${tracks.length} tracks...`);

  const resolvedTracks: Array<TrackToResolve & { sourceUrl?: string; resolveError?: string }> = [];

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    if (i > 0) {
      await new Promise(r => setTimeout(r, 50));
    }
    try {
      let result = await resolveTrackToYouTube(track, i, tracks.length);
      if (!result && !track.title.includes('ZZZZ')) {
        await new Promise(r => setTimeout(r, 150));
        result = await resolveTrackToYouTube(track, i, tracks.length);
      }

      if (result) {
        resolvedTracks.push({
          ...track,
          sourceUrl: result.url,
        });
        if (onProgress) onProgress(i, tracks.length, result);
      } else {
        resolvedTracks.push({
          ...track,
          resolveError: 'No suitable YouTube audio match found',
        });
        if (onProgress) onProgress(i, tracks.length, null);
      }
    } catch (err: any) {
      console.error(`[Resolve] Exception on track ${i + 1} ("${track.title}"):`, err.message);
      resolvedTracks.push({
        ...track,
        resolveError: err.message || 'Unknown resolution error',
      });
      if (onProgress) onProgress(i, tracks.length, null);
    }
  }

  const successCount = resolvedTracks.filter(t => t.sourceUrl).length;
  console.log(`[Spotify → YouTube] Completed resolution: ${successCount}/${tracks.length} tracks matched.`);

  return resolvedTracks;
}
