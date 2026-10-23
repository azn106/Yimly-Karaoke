/**
 * YouTube Music Search & Audio Matching Engine (Downtify Architecture)
 * 
 * Searches YouTube Music via WEB_REMIX & InnerTube APIs and matches catalogue tracks
 * using canonical metadata, version intent analysis, artist verification, and duration comparison.
 */

import { detectTrackIntent, cleanString } from './canonical-metadata.js';

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
  hasOfficialAudioBadge?: boolean;
  thumbnailUrl?: string;
}

export interface MatchedResult {
  candidate: YouTubeCandidate;
  score: number;
  durationDiff: number;
  isCloseDuration: boolean; // within 10s
  isLowConfidence?: boolean;
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

export { cleanString };

/**
 * Checks whether an uploader is a legitimate Topic channel for the artist.
 */
function isTopicChannel(uploader: string, queryOrArtist: string): boolean {
  const cleanUploader = cleanString(uploader);
  const cleanTarget = cleanString(queryOrArtist);

  if (!cleanUploader.includes('topic')) return false;

  const topicBase = cleanUploader.replace(/\btopic\b/g, '').trim();
  if (!topicBase) return false;

  // If queryOrArtist was provided, check if the topic base matches
  if (cleanTarget) {
    if (cleanTarget.includes(topicBase) || topicBase.includes(cleanTarget)) {
      return true;
    }
    const tokens = topicBase.split(' ').filter(w => w.length > 2);
    if (tokens.length > 0 && tokens.every(t => cleanTarget.includes(t))) {
      return true;
    }
    return false;
  }

  return true;
}

/**
 * Known official record labels and distributors
 */
const KNOWN_OFFICIAL_LABELS = [
  'vevo',
  'sony music',
  'warner music',
  'universal music',
  'rca records',
  'atlantic records',
  'columbia records',
  'interscope',
  'def jam',
  'republic records',
  'epic records',
  'capitol records',
  'virgin records',
  'island records',
  'elektra',
  'geffen records',
  'motown',
  'fueled by ramen',
  'spinnin records',
  'monstercat',
  'ultra records',
];

/**
 * Checks whether a channel is an official artist channel or reputable record label.
 */
function isOfficialArtistOrLabel(uploader: string, queryOrArtist: string): boolean {
  // Split CamelCase channel names (e.g. ChrisBrownVEVO) before normalizing.
  const cleanUploader = cleanString(uploader.replace(/([a-z])([A-Z])/g, '$1 $2'));
  const cleanTarget = cleanString(queryOrArtist);

  if (!cleanUploader) return false;

  // VEVO is a strong signal only when the channel name matches the requested artist.
  // Do not trust an unrelated channel merely because its name contains "VEVO".
  if (cleanUploader.includes('vevo')) {
    const vevoBase = cleanUploader.replace(/vevo/g, '').trim();
    if (!cleanTarget || !vevoBase) return false;
    const artistTokens = vevoBase.split(' ').filter(w => w.length > 2);
    return cleanTarget.includes(vevoBase) ||
      (artistTokens.length > 0 && artistTokens.every(token => cleanTarget.includes(token)));
  }

  // Major record labels
  for (const label of KNOWN_OFFICIAL_LABELS) {
    if (cleanUploader.includes(label)) return true;
  }

  // Exact or official artist channel matching: e.g. "Chris Brown" or "Chris Brown Official"
  if (cleanTarget) {
    if (cleanTarget.includes(cleanUploader) || cleanUploader.includes(cleanTarget)) {
      return true;
    }
    const uploaderTokens = cleanUploader.split(' ').filter(w => w.length > 2 && w !== 'official');
    if (uploaderTokens.length > 0 && uploaderTokens.every(t => cleanTarget.includes(t))) {
      return true;
    }
  }

  return false;
}

/**
 * Search YouTube Music & YouTube InnerTube for audio candidates
 */
export async function searchYouTubeCandidates(query: string, provider: 'music' | 'youtube' | 'both' = 'both'): Promise<YouTubeCandidate[]> {
  const candidates: YouTubeCandidate[] = [];
  const seenIds = new Set<string>();

  // 1. YouTube Music WEB_REMIX search endpoint (Songs filter: Eg-KAQwIABAAGAEgASgB)
  if (provider !== 'youtube') try {
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

              // Extract artist cleanly from runs with artist navigation or non-metadata text
              const artistRuns = col1Runs.filter((x: any) => {
                const pageType = x.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
                if (pageType === 'MUSIC_PAGE_TYPE_ARTIST') return true;
                return x.text && x.text !== ' • ' && !x.text.includes('plays') && !x.text.includes('views') && x.text !== 'Song' && x.text !== 'Video' && !/^\d+:\d{2}(:\d{2})?$/.test(x.text?.trim() || '');
              });

              if (artistRuns.length > 0) {
                artist = artistRuns.map((a: any) => a.text).join(', ');
              }

              // Extract album if present
              const albumRun = col1Runs.find((x: any) => {
                const pageType = x.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
                return pageType === 'MUSIC_PAGE_TYPE_ALBUM';
              });
              if (albumRun?.text) {
                album = albumRun.text;
              }

              const musicVideoType = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
              const isArtistChannel = col1Runs.some((x: any) => x.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ARTIST');
              const isUserChannel = col1Runs.some((x: any) => x.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_USER_CHANNEL');

              const lowerTitle = title.toLowerCase();
              let isTopic = isTopicChannel(artist, query);
              let isOfficial = false;

              // Do not automatically classify every YouTube Music result as official!
              if (isUserChannel || musicVideoType === 'MUSIC_VIDEO_TYPE_UGC') {
                isTopic = false;
                isOfficial = false;
              } else if (isTopic) {
                isOfficial = true;
              } else if (isArtistChannel || musicVideoType === 'MUSIC_VIDEO_TYPE_OMV' || musicVideoType === 'MUSIC_VIDEO_TYPE_ATV') {
                isOfficial = isOfficialArtistOrLabel(artist, query);
              }

              const thumb = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)[0]?.url || '';

              seenIds.add(videoId);
              candidates.push({
                id: videoId,
                url: `https://www.youtube.com/watch?v=${videoId}`,
                title,
                artist,
                album,
                duration: parseDurationSeconds(durationText),
                durationText,
                isTopic,
                isOfficial,
                hasOfficialAudioBadge: lowerTitle.includes('official audio') || lowerTitle.includes('official video'),
                thumbnailUrl: thumb,
              });
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[YTMusic Matcher] YouTube Music API query notice:', err);
  }

  // 2. Regular YouTube is a separate fallback, never queried during the music-first pass.
  if (provider !== 'music') try {
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
              if (v && v.videoId) {
                const title = v.title?.runs?.[0]?.text || '';
                const uploader = v.ownerText?.runs?.[0]?.text || '';
                const durationText = v.lengthText?.simpleText || '';
                const durSec = parseDurationSeconds(durationText);
                const lowerTitle = title.toLowerCase();

                const isTopic = isTopicChannel(uploader, query);
                const isOfficial = isTopic || isOfficialArtistOrLabel(uploader, query);
                const thumb = v.thumbnail?.thumbnails?.slice(-1)[0]?.url || '';

                if (seenIds.has(v.videoId)) {
                  // If video was previously added (e.g. from YouTube Music) with 0 duration, enrich it!
                  const existing = candidates.find(c => c.id === v.videoId);
                  if (existing) {
                    if (existing.duration === 0 && durSec > 0) {
                      existing.duration = durSec;
                      existing.durationText = durationText;
                    }
                    if (isOfficial) existing.isOfficial = true;
                    if (isTopic) existing.isTopic = true;
                    if (!existing.thumbnailUrl && thumb) existing.thumbnailUrl = thumb;
                  }
                  continue;
                }

                seenIds.add(v.videoId);
                candidates.push({
                  id: v.videoId,
                  url: `https://www.youtube.com/watch?v=${v.videoId}`,
                  title,
                  artist: uploader,
                  duration: durSec,
                  durationText,
                  isTopic,
                  isOfficial,
                  hasOfficialAudioBadge: lowerTitle.includes('official audio') || lowerTitle.includes('official video'),
                  thumbnailUrl: thumb,
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
 * Score and rank a YouTube candidate against the target track metadata.
 * Evaluates title similarity, artist agreement, official release markers,
 * recording version intent (studio vs live/remix), and duration alignment.
 */
export function scoreCandidate(spotifyTrack: SpotifyTrackMeta, candidate: YouTubeCandidate): MatchedResult {
  let score = 0;

  const targetIntent = detectTrackIntent(spotifyTrack.title, spotifyTrack.artist);
  const candIntent = detectTrackIntent(candidate.title, candidate.artist);

  const cleanTargetCoreTitle = cleanString(targetIntent.coreTitle);
  const cleanCandCoreTitle = cleanString(candIntent.coreTitle);
  const cleanTargetArtist = cleanString(targetIntent.mainArtist);
  const cleanCandArtist = cleanString((candidate.artist || '').replace(/([a-z])([A-Z])/g, '$1 $2'));
  const cleanCandTitle = cleanString(candidate.title);

  // -------------------------------------------------------------------------
  // 1. Core Title Similarity Matching
  // -------------------------------------------------------------------------
  if (cleanCandCoreTitle === cleanTargetCoreTitle) {
    score += 100;
  } else if (cleanCandTitle.includes(cleanTargetCoreTitle) || cleanCandCoreTitle.includes(cleanTargetCoreTitle)) {
    score += 80;
  } else {
    // Word-overlap matching
    const targetWords = cleanTargetCoreTitle.split(' ').filter(w => w.length > 2);
    const matchedWords = targetWords.filter(w => cleanCandTitle.includes(w));
    if (targetWords.length > 0) {
      const matchRatio = matchedWords.length / targetWords.length;
      if (matchRatio >= 0.7) {
        score += Math.round(matchRatio * 70);
      } else if (matchRatio >= 0.5) {
        score += Math.round(matchRatio * 50);
      } else {
        score -= 40; // Significant title mismatch
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2. Primary & Additional Artist Agreement
  // -------------------------------------------------------------------------
  let primaryArtistMatched = false;
  if (cleanCandArtist.includes(cleanTargetArtist) || cleanCandTitle.includes(cleanTargetArtist)) {
    score += 50;
    primaryArtistMatched = true;
  } else {
    const artistTokens = cleanTargetArtist.split(' ').filter(w => w.length > 2);
    const matchedTokens = artistTokens.filter(t => cleanCandArtist.includes(t) || cleanCandTitle.includes(t));
    if (artistTokens.length > 0 && (matchedTokens.length / artistTokens.length) >= 0.5) {
      score += 35;
      primaryArtistMatched = true;
    }
  }

  if (!primaryArtistMatched) {
    // Heavy penalty for wrong primary artist
    score -= 110;
  }

  // Featured artist agreement
  if (targetIntent.featuredArtists.length > 0) {
    for (const feat of targetIntent.featuredArtists) {
      const cleanFeat = cleanString(feat);
      if (cleanFeat && (cleanCandTitle.includes(cleanFeat) || cleanCandArtist.includes(cleanFeat))) {
        score += 15;
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. Official Release, Topic Channels, and Signal Bonuses
  // -------------------------------------------------------------------------
  // Authentic artist Topic channels represent direct studio ingestions
  if (candidate.isTopic && primaryArtistMatched) {
    score += 50;
  } else if (candidate.isTopic) {
    score += 20;
  }

  // Official artist channel or recognised label is a strong signal.
  if (candidate.isOfficial) {
    score += 35;
  }

  // Prefer matching VEVO releases over otherwise similar ordinary uploads.
  // VEVO status is inferred from a matching channel name, not from title text alone.
  if (candidate.isOfficial && cleanString(candidate.artist).includes('vevo')) {
    score += 25;
  }

  // "Official Audio" in title is a useful secondary signal, but not definitive proof
  if (candidate.hasOfficialAudioBadge || cleanCandTitle.includes('official audio')) {
    score += 15;
  }

  // -------------------------------------------------------------------------
  // 4. Version Intent Matching & Severe Unwanted Version Penalties
  // -------------------------------------------------------------------------
  // Unwanted Covers, Karaoke, Tributes, Parodies, or In The Style Of
  if (candIntent.isCover || candIntent.isKaraoke || candIntent.isInstrumental) {
    if (!targetIntent.isCover && !targetIntent.isKaraoke && !targetIntent.isInstrumental) {
      score -= 250;
    }
  }

  // Check for phrases like "in the style of", "made famous by", "originally performed by"
  const unwantedPhrases = ['in the style of', 'made famous by', 'originally performed by', 'backing track', 'karaoke version'];
  for (const phrase of unwantedPhrases) {
    if (cleanCandTitle.includes(phrase) && !cleanTargetCoreTitle.includes(phrase)) {
      score -= 250;
    }
  }

  // Live Performance Handling:
  // If user did NOT request live, heavily penalize live recordings so duration matching never lets them win
  if (candIntent.isLive && !targetIntent.isLive) {
    score -= 160;
  } else if (candIntent.isLive && targetIntent.isLive) {
    score += 40;
  }

  // Remix Handling:
  // If user did NOT request a remix, heavily penalize remixes
  if (candIntent.isRemix && !targetIntent.isRemix) {
    score -= 160;
  } else if (candIntent.isRemix && targetIntent.isRemix) {
    score += 40;
  }

  // Acoustic Handling
  if (candIntent.isAcoustic && !targetIntent.isAcoustic) {
    score -= 90;
  }

  // Altered Audio: Slowed, Reverb, Sped Up, Nightcore, 8D Audio
  const alteredTerms = ['slowed', 'reverb', 'sped up', 'speed up', 'nightcore', '8d audio', '8d', 'bass boosted'];
  for (const term of alteredTerms) {
    if (cleanCandTitle.includes(term)) {
      score -= 200;
    }
  }

  // Compilations / Full Albums / 1 Hour loops
  if (cleanCandTitle.includes('1 hour') || cleanCandTitle.includes('playlist') || cleanCandTitle.includes('full album')) {
    score -= 250;
  }

  // -------------------------------------------------------------------------
  // 5. Duration Matching (Calibrated so it cannot override wrong version)
  // -------------------------------------------------------------------------
  let durationDiff = 999;
  let isCloseDuration = false;

  if (spotifyTrack.duration && spotifyTrack.duration > 0 && candidate.duration > 0) {
    durationDiff = Math.abs(candidate.duration - spotifyTrack.duration);

    if (durationDiff <= 2) {
      score += 35;
      isCloseDuration = true;
    } else if (durationDiff <= 6) {
      score += 25;
      isCloseDuration = true;
    } else if (durationDiff <= 12) {
      score += 15;
      isCloseDuration = true;
    } else if (durationDiff <= 25) {
      score += 5;
    } else if (durationDiff <= 30) {
      score -= 20;
    } else {
      // A large duration mismatch often means the same title but a different recording.
      // Keep it far below a valid candidate, even when the channel looks official.
      score -= 180;
    }

    // Album agreement is a useful tie-breaker when catalogue metadata is available.
    if (spotifyTrack.album && candidate.album) {
      const targetAlbum = cleanString(spotifyTrack.album);
      const candidateAlbum = cleanString(candidate.album);
      if (targetAlbum && candidateAlbum && targetAlbum === candidateAlbum) {
        score += 20;
      }
    }
  }

  return {
    candidate,
    score,
    durationDiff,
    isCloseDuration,
  };
}

const MIN_CONFIDENCE_THRESHOLD = 60;
const MIN_ACCEPTABLE_SCORE = 40;

/**
 * Match a catalogue track to the best matching YouTube / YouTube Music URL.
 * 
 * Follows Downtify's robust matching architecture:
 * 1. Queries with primary `${artist} - ${title}`
 * 2. If confidence is low or no candidates, expands searches with alternative queries
 * 3. Evaluates all candidates across version indicators and artist agreement
 * 4. Rejects poor matches clearly instead of silently picking an arbitrary recording.
 */
export async function matchSpotifyTrackToYouTube(
  spotifyTrack: SpotifyTrackMeta,
  options: { minConfidence?: number; allowFallback?: boolean } = {}
): Promise<MatchedResult | null> {
  const minConfidence = options.minConfidence ?? MIN_CONFIDENCE_THRESHOLD;
  const targetIntent = detectTrackIntent(spotifyTrack.title, spotifyTrack.artist);

  const primaryQuery = `${spotifyTrack.artist} - ${spotifyTrack.title}`;
  console.log(`[YTMatcher] Matching: "${primaryQuery}" (Expected duration: ${spotifyTrack.duration || '?'}s)`);

  let allCandidates: YouTubeCandidate[] = [];
  const seenIds = new Set<string>();

  const primaryCandidates = await searchYouTubeCandidates(primaryQuery);
  for (const c of primaryCandidates) {
    if (!seenIds.has(c.id)) {
      seenIds.add(c.id);
      allCandidates.push(c);
    }
  }

  let scored = allCandidates.map(c => scoreCandidate(spotifyTrack, c)).sort((a, b) => b.score - a.score);

  // If primary search yielded no candidates or top score is below confidence threshold,
  // expand searches with alternative queries
  if (scored.length === 0 || scored[0].score < minConfidence) {
    const alternativeQueries: string[] = [];

    // Title + Main Artist
    alternativeQueries.push(`${targetIntent.mainArtist} ${targetIntent.coreTitle}`);
    alternativeQueries.push(`${targetIntent.coreTitle} ${targetIntent.mainArtist}`);
    alternativeQueries.push(`${targetIntent.mainArtist} - ${targetIntent.coreTitle} official audio`);

    // Title + Featured Artist if available
    if (targetIntent.featuredArtists.length > 0) {
      alternativeQueries.push(`${targetIntent.mainArtist} ${targetIntent.featuredArtists[0]} ${targetIntent.coreTitle}`);
    }

    console.log(`[YTMatcher] Confidence low (${scored[0]?.score ?? 'no candidates'}), trying alternative queries...`);

    for (const altQuery of alternativeQueries) {
      if (altQuery === primaryQuery) continue;
      try {
        const altCandidates = await searchYouTubeCandidates(altQuery);
        for (const c of altCandidates) {
          if (!seenIds.has(c.id)) {
            seenIds.add(c.id);
            allCandidates.push(c);
          }
        }
      } catch (e) {
        console.warn(`[YTMatcher] Alternative query "${altQuery}" failed:`, e);
      }

      scored = allCandidates.map(c => scoreCandidate(spotifyTrack, c)).sort((a, b) => b.score - a.score);
      if (scored.length > 0 && scored[0].score >= minConfidence) {
        break; // Found a high confidence match!
      }
    }
  }

  if (scored.length === 0) {
    console.warn(`[YTMatcher] No candidates found for "${primaryQuery}"`);
    return null;
  }

  const best = scored[0];

  // High confidence match
  if (best.score >= minConfidence) {
    console.log(`[YTMatcher] Selected (High confidence): "${best.candidate.title}" by "${best.candidate.artist}" (Score: ${best.score}, Diff: ${best.durationDiff}s, URL: ${best.candidate.url})`);
    return best;
  }

  // Marginal match: score meets minimum acceptable threshold
  if (best.score >= MIN_ACCEPTABLE_SCORE) {
    console.log(`[YTMatcher] Selected (Marginal confidence): "${best.candidate.title}" (Score: ${best.score}, Diff: ${best.durationDiff}s)`);
    return {
      ...best,
      isLowConfidence: true,
    };
  }

  // Reject completely: All candidates are covers, karaoke, wrong artists, or remixes.
  console.warn(`[YTMatcher] Matching rejected: Best candidate "${best.candidate.title}" scored only ${best.score} (below acceptable threshold ${MIN_ACCEPTABLE_SCORE}). Rejecting rather than downloading wrong track.`);
  return null;
}
