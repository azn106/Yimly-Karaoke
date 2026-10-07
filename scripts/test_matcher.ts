interface TrackQuery {
  title: string;
  artist: string;
  album?: string;
  duration?: number; // seconds
}

interface YouTubeSearchResult {
  id: string;
  title: string;
  uploader?: string;
  duration?: number;
  url: string;
  score: number;
}

// InnerTube YouTube Music & YouTube search
async function searchYouTubeMusic(track: TrackQuery): Promise<YouTubeSearchResult | null> {
  const query = `${track.artist} - ${track.title}`;
  console.log(`[YouTube Search] Searching for: "${query}" (duration: ${track.duration}s)`);

  // Clean title for comparison
  const cleanTitle = track.title.toLowerCase().replace(/[\(\[\{].*?[\)\]\}]/g, '').trim();
  const cleanArtist = track.artist.toLowerCase().split(/[&,;/]|feat/i)[0].trim();

  // 1. Try YouTube Music InnerTube Search
  try {
    const res = await fetch('https://music.youtube.com/youtubei/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'X-YouTube-Client-Name': '67',
        'X-YouTube-Client-Version': '1.20240401.01.00',
        'Origin': 'https://music.youtube.com',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: '1.20240401.01.00',
            hl: 'en',
            gl: 'US',
          }
        },
        query: `${query} official audio`,
      })
    });

    if (res.ok) {
      const data = await res.json();
      const sectionList = data.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents;
      const candidates: YouTubeSearchResult[] = [];

      if (sectionList) {
        for (const sec of sectionList) {
          const shelf = sec.musicShelfRenderer || sec.musicCardShelfRenderer;
          if (shelf?.contents) {
            for (const item of shelf.contents) {
              const flex = item.musicResponsiveListItemRenderer;
              if (flex) {
                const videoId = flex.playlistItemData?.videoId || flex.doubleTapCommand?.watchEndpoint?.videoId;
                const vTitle = flex.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || '';
                const artistRuns = flex.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
                const uploader = artistRuns?.map((r: any) => r.text).join('') || '';

                if (videoId) {
                  // Calculate score
                  let score = 0;
                  const lowerVTitle = vTitle.toLowerCase();
                  const lowerUploader = uploader.toLowerCase();

                  if (lowerVTitle.includes(cleanTitle)) score += 50;
                  if (lowerVTitle.includes(cleanArtist) || lowerUploader.includes(cleanArtist)) score += 40;
                  if (lowerVTitle.includes('official audio') || lowerVTitle.includes('topic') || lowerUploader.includes('topic')) score += 20;
                  if (lowerVTitle.includes('official music video') || lowerVTitle.includes('official video')) score += 15;

                  // Penalties for unwanted types unless explicitly in track title
                  const unwantedTerms = ['cover', 'karaoke', 'live', 'remix', 'instrumental', 'slowed', 'sped up', 'tribute'];
                  for (const term of unwantedTerms) {
                    if (lowerVTitle.includes(term) && !track.title.toLowerCase().includes(term)) {
                      score -= 50;
                    }
                  }

                  candidates.push({
                    id: videoId,
                    title: vTitle,
                    uploader,
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                    score,
                  });
                }
              }
            }
          }
        }
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        console.log(`[YouTube Search] InnerTube found best match: "${candidates[0].title}" (score: ${candidates[0].score}) -> ${candidates[0].url}`);
        return candidates[0];
      }
    }
  } catch (e: any) {
    console.warn('[YouTube Search] InnerTube search error:', e.message);
  }

  return null;
}

async function testMatch() {
  const sampleTracks: TrackQuery[] = [
    { title: 'Never Gonna Give You Up', artist: 'Rick Astley', duration: 213 },
    { title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 },
    { title: 'Flowers', artist: 'Miley Cyrus', duration: 200 },
    { title: 'Anti-Hero', artist: 'Taylor Swift', duration: 200 },
    { title: 'Shape of You', artist: 'Ed Sheeran', duration: 233 },
  ];

  for (let i = 0; i < sampleTracks.length; i++) {
    const t = sampleTracks[i];
    console.log(`\n[Resolve] ${i + 1}/${sampleTracks.length}`);
    console.log(`Artist: ${t.artist}`);
    console.log(`Title: ${t.title}`);
    console.log(`Query: ${t.artist} - ${t.title}`);
    const res = await searchYouTubeMusic(t);
    if (res) {
      console.log(`[Resolve] YouTube result:\n${res.url}`);
      console.log(`[Resolve] SUCCESS`);
    } else {
      console.log(`[Resolve] FAILED`);
    }
  }
}

testMatch().catch(console.error);
