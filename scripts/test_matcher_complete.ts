interface SpotifyTrackInput {
  title: string;
  artist: string;
  album?: string;
  duration?: number; // in seconds
}

interface YouTubeCandidate {
  id: string;
  url: string;
  title: string;
  artist: string;
  album?: string;
  duration: number; // in seconds
  durationText?: string;
  isTopic?: boolean;
  isOfficial?: boolean;
}

interface MatchResult {
  candidate: YouTubeCandidate;
  score: number;
  durationDiff: number;
  isCloseDuration: boolean; // within 10s
}

function parseDurationText(text?: string): number {
  if (!text) return 0;
  const parts = text.trim().split(':').map(p => parseInt(p, 10));
  if (parts.some(isNaN)) return 0;
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

function cleanString(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function searchYouTubeMusicCandidates(query: string): Promise<YouTubeCandidate[]> {
  const candidates: YouTubeCandidate[] = [];

  // 1. Query YouTube Music WEB_REMIX API
  try {
    const ytMusicRes = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://music.youtube.com/',
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
        params: 'Eg-KAQwIABAAGAEgASgB', // Songs filter
      }),
    });

    if (ytMusicRes.ok) {
      const data = await ytMusicRes.json();
      const sectionList = data.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents
        || data.contents?.sectionListRenderer?.contents;

      if (Array.isArray(sectionList)) {
        for (const sec of sectionList) {
          const items = sec.itemSectionRenderer?.contents || sec.musicShelfRenderer?.contents || sec.musicCardShelfRenderer?.contents || [];
          for (const item of items) {
            const r = item.musicResponsiveListItemRenderer;
            if (r) {
              const videoId = r.playlistItemData?.videoId
                || r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId
                || r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;

              if (!videoId) continue;

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

              // Extract artist from col1 runs
              const artistRuns = col1Runs.filter((x: any) => x.text && x.text !== ' • ' && !x.text.includes('plays') && !x.text.includes('views') && x.text !== 'Song' && x.text !== 'Video');
              if (artistRuns.length > 0) {
                artist = artistRuns.map((a: any) => a.text).join(', ');
              }

              candidates.push({
                id: videoId,
                url: `https://www.youtube.com/watch?v=${videoId}`,
                title,
                artist,
                album,
                duration: parseDurationText(durationText),
                durationText,
                isTopic: artist.toLowerCase().includes('topic'),
                isOfficial: true,
              });
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('[YTMusic] Search error:', e);
  }

  // 2. Query standard YouTube InnerTube API for additional candidates with duration
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
              if (v && v.videoId && !candidates.some(c => c.id === v.videoId)) {
                const title = v.title?.runs?.[0]?.text || '';
                const uploader = v.ownerText?.runs?.[0]?.text || '';
                const durationText = v.lengthText?.simpleText || '';

                candidates.push({
                  id: v.videoId,
                  url: `https://www.youtube.com/watch?v=${v.videoId}`,
                  title,
                  artist: uploader,
                  duration: parseDurationText(durationText),
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
  } catch (e) {
    console.warn('[YouTube] InnerTube search error:', e);
  }

  return candidates;
}

function scoreCandidate(spotifyTrack: SpotifyTrackInput, candidate: YouTubeCandidate): MatchResult {
  let score = 0;
  const cleanSpotifyTitle = cleanString(spotifyTrack.title);
  const cleanSpotifyArtist = cleanString(spotifyTrack.artist);
  const cleanCandTitle = cleanString(candidate.title);
  const cleanCandArtist = cleanString(candidate.artist);

  // 1. Title matching
  if (cleanCandTitle === cleanSpotifyTitle) {
    score += 100;
  } else if (cleanCandTitle.includes(cleanSpotifyTitle)) {
    score += 80;
  } else {
    // Check word overlap
    const spWords = cleanSpotifyTitle.split(' ').filter(w => w.length > 2);
    const matchedWords = spWords.filter(w => cleanCandTitle.includes(w));
    if (spWords.length > 0) {
      score += Math.round((matchedWords.length / spWords.length) * 60);
    }
  }

  // 2. Artist matching
  const artistParts = spotifyTrack.artist.split(/[,&/]|feat\.?|ft\.?/i).map(a => cleanString(a)).filter(Boolean);
  let artistMatched = false;
  for (const part of artistParts) {
    if (part.length > 1 && (cleanCandArtist.includes(part) || cleanCandTitle.includes(part))) {
      score += 40;
      artistMatched = true;
      break;
    }
  }
  if (!artistMatched && cleanCandArtist.includes(cleanSpotifyArtist)) {
    score += 40;
  }

  // 3. Official & Topic bonus
  if (candidate.isTopic) score += 35;
  if (candidate.isOfficial) score += 20;
  if (candidate.title.toLowerCase().includes('official audio')) score += 30;

  // 4. Penalties for unwanted versions if not requested in Spotify title
  const unwantedTerms = ['cover', 'karaoke', 'instrumental', 'tribute', 'parody', 'reaction', 'slowed', 'reverb', '8d audio', 'nightcore'];
  for (const term of unwantedTerms) {
    if (cleanCandTitle.includes(term) && !cleanSpotifyTitle.includes(term)) {
      score -= 75;
    }
  }

  // Live penalty
  if (cleanCandTitle.includes('live') && !cleanSpotifyTitle.includes('live')) {
    score -= 40;
  }

  // Remix penalty
  if (cleanCandTitle.includes('remix') && !cleanSpotifyTitle.includes('remix')) {
    score -= 30;
  }

  // 5. Duration matching (CRITICAL DOWNTIFY LOGIC)
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

async function matchSpotifyTrack(spotifyTrack: SpotifyTrackInput): Promise<MatchResult | null> {
  const query = `${spotifyTrack.artist} - ${spotifyTrack.title}`;
  console.log(`[Matcher] Searching YouTube Music for "${query}" (Spotify Duration: ${spotifyTrack.duration}s)...`);
  
  const candidates = await searchYouTubeMusicCandidates(query);
  if (candidates.length === 0) {
    console.warn(`[Matcher] No YouTube candidates found for "${query}"`);
    return null;
  }

  const scored = candidates.map(c => scoreCandidate(spotifyTrack, c));
  scored.sort((a, b) => b.score - a.score);

  console.log(`[Matcher] Found ${candidates.length} candidates. Top 3:`);
  scored.slice(0, 3).forEach((s, idx) => {
    console.log(`  #${idx + 1}: [Score: ${s.score}] "${s.candidate.title}" by "${s.candidate.artist}" (${s.candidate.duration}s, Diff: ${s.durationDiff}s, URL: ${s.candidate.url})`);
  });

  const best = scored[0];
  if (best.score <= 0) {
    console.warn(`[Matcher] Best candidate had non-positive score (${best.score}), falling back to closest duration`);
    // Fallback: pick the candidate with the smallest durationDiff if available
    const durationSorted = scored.filter(s => s.candidate.duration > 0).sort((a, b) => a.durationDiff - b.durationDiff);
    if (durationSorted.length > 0) {
      return durationSorted[0];
    }
  }

  return best;
}

// Test sample Spotify tracks
async function runTest() {
  const sampleTracks: SpotifyTrackInput[] = [
    {
      title: 'Never Gonna Give You Up',
      artist: 'Rick Astley',
      duration: 213, // 3:33
    },
    {
      title: 'Blinding Lights',
      artist: 'The Weeknd',
      duration: 200, // 3:20
    },
    {
      title: 'Shape of You',
      artist: 'Ed Sheeran',
      duration: 233, // 3:53
    },
    {
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      duration: 354, // 5:54
    },
    {
      title: 'As It Was',
      artist: 'Harry Styles',
      duration: 167, // 2:47
    }
  ];

  for (const track of sampleTracks) {
    const res = await matchSpotifyTrack(track);
    console.log(`Result for "${track.title}":`, res ? `MATCHED: ${res.candidate.url} (Score: ${res.score}, Diff: ${res.durationDiff}s)` : 'NO MATCH');
    console.log('--------------------------------------------------');
  }
}

runTest().catch(console.error);
