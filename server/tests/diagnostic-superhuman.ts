import { cleanString, detectTrackIntent } from '../lib/canonical-metadata.js';
import { searchYouTubeCandidates, scoreCandidate, YouTubeCandidate } from '../lib/youtube-matcher.js';

function cleanTitleOnly(raw: string): string {
  let cleaned = raw
    .replace(/[\(\[\{]\s*(?:feat\.?|ft\.?|featuring|with)\s+[^\]\)\}]+[\)\]\}]/gi, '')
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*/gi, '')
    .trim();
  return cleaned || raw;
}

export async function resolveUrlOrQueryDiagnostic(rawInput: string) {
  const trimmed = rawInput.trim();
  console.log('\n=======================================================');
  console.log(`[Diagnostic] Resolving query: "${trimmed}"`);

  const unquoted = trimmed.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  const queryIntent = detectTrackIntent(unquoted || trimmed, '');
  console.log(`[Diagnostic] Intent detected: Title="${queryIntent.coreTitle}", Artist="${queryIntent.mainArtist}", Featured=${JSON.stringify(queryIntent.featuredArtists)}`);

  const searchQueries: string[] = [];
  if (queryIntent.mainArtist && queryIntent.mainArtist !== 'Unknown Artist') {
    searchQueries.push(`${queryIntent.mainArtist} ${queryIntent.coreTitle}`);
    searchQueries.push(`${queryIntent.coreTitle} ${queryIntent.mainArtist}`);
    if (queryIntent.featuredArtists.length > 0) {
      searchQueries.push(`${queryIntent.mainArtist} ${queryIntent.featuredArtists[0]} ${queryIntent.coreTitle}`);
      searchQueries.push(`${queryIntent.coreTitle} ${queryIntent.featuredArtists[0]}`);
    }
  }
  searchQueries.push(trimmed);
  if (unquoted !== trimmed) searchQueries.push(unquoted);
  if (queryIntent.coreTitle && queryIntent.coreTitle !== trimmed && queryIntent.coreTitle.length > 2) {
    searchQueries.push(queryIntent.coreTitle);
  }

  const uniqueQueries = Array.from(new Set(searchQueries.map(q => q.trim()).filter(Boolean)));
  console.log(`[Diagnostic] Expanded provider queries:`, uniqueQueries);

  const seenTrackKeys = new Set<string>();
  const collectedTracks: any[] = [];
  const cleanCore = cleanString(queryIntent.coreTitle || trimmed);
  const cleanArtist = queryIntent.mainArtist !== 'Unknown Artist' ? cleanString(queryIntent.mainArtist) : '';

  // Stage A: iTunes
  for (const q of uniqueQueries) {
    try {
      const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=15`;
      const res = await fetch(itunesUrl);
      if (res.ok) {
        const data = await res.json();
        for (const item of (data.results || [])) {
          const trackTitle = item.trackName || '';
          const trackArtist = item.artistName || '';
          const cleanTTitle = cleanString(trackTitle);
          const cleanTArtist = cleanString(trackArtist);

          // 1. Exclude unwanted karaoke, covers, tributes
          const unwanted = ['in the style of', 'made famous by', 'originally performed by', 'karaoke version'];
          if (unwanted.some(p => cleanTTitle.includes(p) || cleanTArtist.includes(p))) {
            continue;
          }

          // 2. Verify title relevance against cleanTitleOnly
          const titleBase = cleanString(cleanTitleOnly(trackTitle));
          if (!titleBase) continue;

          const titleMatches = titleBase.includes(cleanCore) || cleanCore.includes(titleBase);
          if (!titleMatches && cleanCore.length > 3) {
            continue;
          }

          // 3. Verify artist relevance if target artist is known
          if (cleanArtist) {
            const artistMatches = cleanTArtist.includes(cleanArtist) || cleanArtist.includes(cleanTArtist) ||
              cleanArtist.split(' ').filter(w => w.length > 2).every(w => cleanTArtist.includes(w) || cleanTTitle.includes(w));
            if (!artistMatches) {
              continue;
            }
          }

          const dedupKey = `${cleanTTitle}|${cleanTArtist}`;
          if (seenTrackKeys.has(dedupKey)) continue;
          seenTrackKeys.add(dedupKey);

          collectedTracks.push({
            title: trackTitle,
            artist: trackArtist,
            album: item.collectionName || 'Single',
            duration: Math.round((item.trackTimeMillis || 0) / 1000),
            artworkUrl: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '600x600bb') : '',
            source: 'itunes',
          });
        }
      }
    } catch {}
  }

  console.log(`[Diagnostic] iTunes valid matches: ${collectedTracks.length}`);

  // Stage B: Fallback to YouTube Music & InnerTube if target artist not found or results sparse
  const hasExactArtistMatch = cleanArtist ? collectedTracks.some(t => cleanString(t.artist).includes(cleanArtist)) : false;

  if (!hasExactArtistMatch || collectedTracks.length < 5) {
    console.log(`[Diagnostic] Fallback triggered: searching YouTube Music & InnerTube...`);
    const candidatePool: YouTubeCandidate[] = [];
    const poolSeenIds = new Set<string>();

    for (const q of uniqueQueries.slice(0, 3)) {
      const ytCandidates = await searchYouTubeCandidates(q);
      for (const c of ytCandidates) {
        if (!poolSeenIds.has(c.id)) {
          poolSeenIds.add(c.id);
          candidatePool.push(c);
        }
      }
      if (candidatePool.length >= 20) break;
    }

    const targetMeta = {
      title: queryIntent.coreTitle || trimmed,
      artist: (queryIntent.mainArtist && queryIntent.mainArtist !== 'Unknown Artist') ? queryIntent.mainArtist : (queryIntent.coreTitle || trimmed),
    };

    const scored = candidatePool
      .filter(c => c.duration <= 1200)
      .map(c => scoreCandidate(targetMeta, c))
      .filter(s => s.score >= 40)
      .sort((a, b) => b.score - a.score);

    console.log(`[Diagnostic] YouTube scored candidates count: ${scored.length}`);
    if (scored.length > 0) {
      console.log(`[Diagnostic] Top YouTube match: "${scored[0].candidate.title}" by "${scored[0].candidate.artist}" (Score: ${scored[0].score}, URL: ${scored[0].candidate.url})`);
    }

    for (const s of scored) {
      const c = s.candidate;
      const cleanCTitle = cleanString(c.title);
      const cleanCArtist = cleanString(c.artist);
      const dedupKey = `${cleanCTitle}|${cleanCArtist}`;
      if (seenTrackKeys.has(dedupKey)) continue;
      seenTrackKeys.add(dedupKey);

      collectedTracks.push({
        title: c.title || 'Unknown Title',
        artist: c.artist || 'Unknown Artist',
        album: c.album || 'YouTube',
        duration: c.duration,
        artworkUrl: c.thumbnailUrl || '',
        sourceUrl: c.url,
        source: 'youtube',
      });
    }
  }

  console.log(`[Diagnostic] Final returned tracks count: ${collectedTracks.length}`);
  return collectedTracks;
}

async function run() {
  const testCases = [
    'Superhuman',
    'Superhuman Chris Brown',
    'Superhuman Chris Brown Keri Hilson',
    'Chris Brown feat. Keri Hilson Superhuman',
  ];

  for (const tc of testCases) {
    const tracks = await resolveUrlOrQueryDiagnostic(tc);
    const cbMatch = tracks.find(t => cleanString(t.artist).includes('chris brown') && cleanString(t.title).includes('superhuman'));
    console.log(`[Result] "${tc}": found Chris Brown Superhuman? ${cbMatch ? 'YES' : 'NO'}`);
    if (cbMatch) {
      console.log(`   -> Found: "${cbMatch.title}" by "${cbMatch.artist}" (dur: ${cbMatch.duration}s, source: ${cbMatch.source})`);
    }
  }
}
run();
