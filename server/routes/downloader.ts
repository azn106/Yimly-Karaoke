import { Router } from 'express';
import { db } from '../db/index.js';
import { settings, libraries } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  downloadQueue,
  getYtDlpPath,
  sanitizeFilename,
  ActiveDownloadJob,
  TrackMetadata,
} from '../lib/download-queue.js';
import { resolveSpotifyEntity } from '../lib/spotify-resolver.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { sanitizeLeadInMs, setCachedLeadInMs } from '../karaoke-sync-config.js';

const execFilePromise = promisify(execFile);

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

// -------------------------------------------------------------------
// SETTINGS ENDPOINTS
// -------------------------------------------------------------------

router.get('/settings', async (req, res) => {
  try {
    const allSettings = await db.select().from(settings);
    const settingsMap = new Map(allSettings.map((s) => [s.key, s.value]));

    // Find default library ID
    const allLibs = await db.select().from(libraries).limit(1);
    const defaultLibId = allLibs.length > 0 ? String(allLibs[0].id) : '1';

    const rawDownloadLyrics = settingsMap.get('downloader_download_lyrics');
    const rawLyricsProviders = settingsMap.get('downloader_lyrics_providers');

    let parsedProviders = ['lrclib'];
    if (rawLyricsProviders) {
      try {
        const parsed = JSON.parse(rawLyricsProviders);
        if (Array.isArray(parsed) && parsed.length > 0) {
          parsedProviders = parsed;
        }
      } catch (e) {
        parsedProviders = [rawLyricsProviders];
      }
    }

    const downloadLyrics = rawDownloadLyrics !== 'false';
    const concurrencyVal = parseInt(settingsMap.get('downloader_concurrency') || '4', 10) || 4;
    const rawLeadInMs = settingsMap.get('downloader_elrc_line_lead_in_ms');
    const elrcLineLeadInMs = sanitizeLeadInMs(rawLeadInMs !== undefined ? rawLeadInMs : 500);
    setCachedLeadInMs(elrcLineLeadInMs);

    res.json({
      libraryId: settingsMap.get('downloader_library_id') || defaultLibId,
      format: settingsMap.get('downloader_format') || 'mp3',
      quality: settingsMap.get('downloader_quality') || '320k',
      embedMetadata: settingsMap.get('downloader_embed_metadata') !== 'false',
      embedArtwork: settingsMap.get('downloader_embed_artwork') !== 'false',
      downloadLyrics,
      lyricsProviders: parsedProviders,
      // Compatibility keys matching Downtify naming
      download_lyrics: downloadLyrics,
      lyrics_providers: parsedProviders,
      folderStructure: settingsMap.get('downloader_folder_structure') || '{artist}/{artist} - {title}',
      playlistFolder: settingsMap.get('downloader_playlist_folder') !== 'false',
      concurrency: concurrencyVal,
      elrcLineLeadInMs,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch downloader settings' });
  }
});

router.post('/settings', async (req, res) => {
  try {
    const {
      libraryId,
      format,
      quality,
      embedMetadata,
      embedArtwork,
      folderStructure,
      playlistFolder,
      downloadLyrics,
      download_lyrics,
      lyricsProviders,
      lyrics_providers,
      concurrency,
    } = req.body;

    const finalDownloadLyrics = downloadLyrics ?? download_lyrics ?? true;
    const finalLyricsProviders = lyricsProviders ?? lyrics_providers ?? ['lrclib'];
    const providersArray = Array.isArray(finalLyricsProviders) ? finalLyricsProviders : [finalLyricsProviders];

    const pairs: [string, string][] = [
      ['downloader_library_id', String(libraryId ?? '')],
      ['downloader_format', String(format ?? 'mp3')],
      ['downloader_quality', String(quality ?? '320k')],
      ['downloader_embed_metadata', String(embedMetadata ?? true)],
      ['downloader_embed_artwork', String(embedArtwork ?? true)],
      ['downloader_folder_structure', String(folderStructure ?? '{artist}/{artist} - {title}')],
      ['downloader_playlist_folder', String(playlistFolder ?? true)],
      ['downloader_download_lyrics', String(finalDownloadLyrics)],
      ['downloader_lyrics_providers', JSON.stringify(providersArray)],
    ];

    if (concurrency !== undefined) {
      const parsedConcurrency = Math.min(16, Math.max(1, parseInt(concurrency, 10) || 4));
      pairs.push(['downloader_concurrency', String(parsedConcurrency)]);
      downloadQueue.setConcurrency(parsedConcurrency);
    }

    const { elrcLineLeadInMs, elrc_line_lead_in_ms } = req.body;
    const incomingLeadIn = elrcLineLeadInMs ?? elrc_line_lead_in_ms;
    if (incomingLeadIn !== undefined) {
      const sanitized = sanitizeLeadInMs(incomingLeadIn);
      pairs.push(['downloader_elrc_line_lead_in_ms', String(sanitized)]);
      setCachedLeadInMs(sanitized);
    }

    for (const [key, value] of pairs) {
      await db
        .insert(settings)
        .values({ key, value })
        .onConflictDoUpdate({ target: settings.key, set: { value } });
    }

    res.json({ message: 'Settings saved successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save downloader settings' });
  }
});

import { searchYouTubeCandidates, scoreCandidate, YouTubeCandidate } from '../lib/youtube-matcher.js';
import { cleanString, detectTrackIntent, normalizeCanonicalMetadata } from '../lib/canonical-metadata.js';

// -------------------------------------------------------------------
// RESOLVE & METADATA ENDPOINT (Supports full playlist extraction)
// -------------------------------------------------------------------

export async function resolveUrlOrQuery(urlOrQuery: string): Promise<any> {
  const trimmed = urlOrQuery.trim();

  // 1. Check if Spotify URL
  if (trimmed.includes('spotify.com/')) {
    const spotifyEntity = await resolveSpotifyEntity(trimmed);
    return spotifyEntity;
  }

  // 2. Check if YouTube / YouTube Music URL
  if (trimmed.includes('youtube.com/') || trimmed.includes('youtu.be/')) {
    const ytDlpPath = await getYtDlpPath();
    const isPlaylist = trimmed.includes('list=');

    if (isPlaylist) {
      const { stdout } = await execFilePromise(ytDlpPath, [
        '--flat-playlist',
        '--dump-json',
        '--js-runtimes',
        'node',
        trimmed,
      ]);

      const lines = stdout.trim().split('\n').filter(Boolean);
      const tracks = lines.map((line, idx) => {
        try {
          const parsed = JSON.parse(line);
          const rawTitle = parsed.title || 'Unknown Title';
          const rawArtist = parsed.uploader || parsed.artist || 'Unknown Artist';
          const intent = detectTrackIntent(rawTitle, rawArtist);

          return {
            title: intent.coreTitle,
            artist: intent.mainArtist,
            album: 'Single',
            trackNumber: idx + 1,
            sourceUrl: parsed.url || (parsed.id ? `https://www.youtube.com/watch?v=${parsed.id}` : undefined),
            artworkUrl: parsed.thumbnails?.[0]?.url || '',
            duration: Math.round(parsed.duration || 0),
          };
        } catch (e) {
          return null;
        }
      }).filter(Boolean);

      return {
        type: 'playlist',
        title: 'YouTube Playlist',
        tracks,
      };
    } else {
      const { stdout } = await execFilePromise(ytDlpPath, [
        '--dump-json',
        '--js-runtimes',
        'node',
        trimmed,
      ]);

      const parsed = JSON.parse(stdout);
      const rawTitle = parsed.track || parsed.title || 'Unknown Title';
      const rawArtist = parsed.artist || parsed.uploader || 'Unknown Artist';
      const intent = detectTrackIntent(rawTitle, rawArtist);

      let canonicalTitle = intent.coreTitle;
      let canonicalArtist = intent.mainArtist;
      let canonicalAlbum = parsed.album || 'Single';
      let canonicalArtwork = parsed.thumbnail || (parsed.thumbnails?.[0]?.url || '');
      let duration = Math.round(parsed.duration || 0);
      let releaseYear: number | undefined = undefined;

      // Attempt catalogue enrichment to find square album artwork and canonical album name
      // without changing the audio source URL (which remains the user's supplied YouTube URL)
      try {
        const queryTerm = `${canonicalArtist} ${canonicalTitle}`;
        const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(queryTerm)}&entity=song&limit=5`);
        if (itunesRes.ok) {
          const itunesData = await itunesRes.json();
          const cleanTargetTitle = cleanString(canonicalTitle);
          const cleanTargetArtist = cleanString(canonicalArtist);

          const match = itunesData.results?.find((r: any) => {
            const rTitle = cleanString(r.trackName);
            const rArtist = cleanString(r.artistName);
            const titleMatches = rTitle.includes(cleanTargetTitle) || cleanTargetTitle.includes(rTitle);
            const artistMatches = rArtist.includes(cleanTargetArtist) || cleanTargetArtist.includes(rArtist);
            const itunesDur = Math.round((r.trackTimeMillis || 0) / 1000);
            const durationMatches = duration > 0 ? Math.abs(itunesDur - duration) <= 25 : true;
            return titleMatches && artistMatches && durationMatches;
          });

          if (match) {
            canonicalTitle = match.trackName || canonicalTitle;
            canonicalArtist = match.artistName || canonicalArtist;
            canonicalAlbum = match.collectionName || canonicalAlbum;
            if (match.artworkUrl100) {
              canonicalArtwork = match.artworkUrl100.replace('100x100bb', '600x600bb');
            }
            if (match.releaseDate) {
              releaseYear = new Date(match.releaseDate).getFullYear();
            }
            if (!duration && match.trackTimeMillis) {
              duration = Math.round(match.trackTimeMillis / 1000);
            }
          }
        }
      } catch (err) {
        console.warn('[Downloader] YouTube catalogue resolution notice:', err);
      }

      const track = {
        title: canonicalTitle,
        artist: canonicalArtist,
        album: canonicalAlbum,
        duration,
        artworkUrl: canonicalArtwork,
        releaseYear,
        sourceUrl: trimmed, // Preserve user's supplied YouTube URL as audio source!
      };

      return {
        type: 'track',
        title: track.title,
        artist: track.artist,
        album: track.album,
        artworkUrl: track.artworkUrl,
        tracks: [track],
      };
    }
  }

  // 3. Multi-Query Text Search with intelligent expansion & provider fallbacks
  const searchQueries: string[] = [trimmed];

  const unquoted = trimmed.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  if (unquoted && unquoted !== trimmed) {
    searchQueries.push(unquoted);
  }

  const queryIntent = detectTrackIntent(unquoted || trimmed, '');

  // Try title + main artist: "Superhuman Chris Brown", "Chris Brown Superhuman"
  if (queryIntent.coreTitle && queryIntent.mainArtist && queryIntent.mainArtist !== 'Unknown Artist') {
    searchQueries.push(`${queryIntent.coreTitle} ${queryIntent.mainArtist}`);
    searchQueries.push(`${queryIntent.mainArtist} ${queryIntent.coreTitle}`);
    if (queryIntent.featuredArtists.length > 0) {
      searchQueries.push(`${queryIntent.coreTitle} ${queryIntent.mainArtist} ${queryIntent.featuredArtists[0]}`);
      searchQueries.push(`${queryIntent.mainArtist} ${queryIntent.coreTitle} ${queryIntent.featuredArtists[0]}`);
      searchQueries.push(`${queryIntent.coreTitle} ${queryIntent.featuredArtists[0]}`);
    }
  }

  // Check for pattern: "{Artist} (featuring|feat|ft) {Featured} {Title}"
  const featInMiddleMatch = (unquoted || trimmed).match(/^(.*?)\s+(?:featuring|feat\.?|ft\.?)\s+(.*?)\s+([A-Za-z0-9' ]+)$/i);
  if (featInMiddleMatch) {
    const pArtist = featInMiddleMatch[1].trim();
    const pFeat = featInMiddleMatch[2].trim();
    const pTitle = featInMiddleMatch[3].trim();
    searchQueries.push(`${pTitle} ${pArtist}`);
    searchQueries.push(`${pArtist} ${pTitle}`);
    searchQueries.push(`${pTitle} ${pFeat}`);
    searchQueries.push(`${pArtist} ${pFeat} ${pTitle}`);
  }

  // Try cleaned core title if different
  if (queryIntent.coreTitle && queryIntent.coreTitle !== trimmed && queryIntent.coreTitle.length > 2) {
    searchQueries.push(queryIntent.coreTitle);
  }

  const uniqueQueries = Array.from(new Set(searchQueries.map(q => q.trim()).filter(Boolean)));
  const seenTrackKeys = new Set<string>();
  const collectedTracks: any[] = [];

  // Stage A: Apple iTunes Search with query expansion & strict artist/version relevance validation
  for (const q of uniqueQueries) {
    try {
      const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=15`;
      const itunesRes = await fetch(itunesUrl);
      if (itunesRes.ok) {
        const itunesData = await itunesRes.json();
        if (Array.isArray(itunesData.results) && itunesData.results.length > 0) {
          const cleanCore = cleanString(queryIntent.coreTitle || trimmed);
          const cleanArtist = queryIntent.mainArtist !== 'Unknown Artist' ? cleanString(queryIntent.mainArtist) : '';

          for (const item of itunesData.results) {
            const trackTitle = item.trackName || '';
            const trackArtist = item.artistName || '';
            const cleanTTitle = cleanString(trackTitle);
            const cleanTArtist = cleanString(trackArtist);

            // 1. Exclude unwanted karaoke, covers, tributes, in the style of unless user requested it
            const itemIntent = detectTrackIntent(trackTitle, trackArtist);
            if (!queryIntent.isKaraoke && !queryIntent.isCover && !queryIntent.isInstrumental) {
              if (itemIntent.isKaraoke || itemIntent.isCover || itemIntent.isInstrumental) {
                continue;
              }
              const unwantedPhrases = ['in the style of', 'made famous by', 'originally performed by', 'karaoke version'];
              if (unwantedPhrases.some(phrase => cleanTTitle.includes(phrase) || cleanTArtist.includes(phrase))) {
                continue;
              }
            }

            // 2. Verify title relevance
            const titleMatches = cleanTTitle.includes(cleanCore) || cleanCore.includes(cleanTTitle) ||
              cleanCore.split(' ').filter(w => w.length > 2).some(w => cleanTTitle.includes(w));

            if (!titleMatches && cleanCore.length > 3) {
              continue;
            }

            // 3. Verify artist relevance if target artist is known
            if (cleanArtist) {
              const artistMatches = cleanTArtist.includes(cleanArtist) || cleanArtist.includes(cleanTArtist) ||
                cleanArtist.split(' ').filter(w => w.length > 2).every(w => cleanTArtist.includes(w) || cleanTTitle.includes(w));
              if (!artistMatches) {
                continue; // Reject tracks by different artists
              }
            }

            const dedupKey = `${cleanTTitle}|${cleanTArtist}`;
            if (seenTrackKeys.has(dedupKey)) continue;
            seenTrackKeys.add(dedupKey);

            collectedTracks.push({
              title: trackTitle || 'Unknown Title',
              artist: trackArtist || 'Unknown Artist',
              album: item.collectionName || 'Single',
              trackNumber: item.trackNumber || collectedTracks.length + 1,
              discNumber: item.discNumber || 1,
              releaseYear: item.releaseDate ? new Date(item.releaseDate).getFullYear() : undefined,
              artworkUrl: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '600x600bb') : '',
              duration: Math.round((item.trackTimeMillis || 0) / 1000),
            });
          }

          if (collectedTracks.length >= 3) {
            break;
          }
        }
      }
    } catch (e) {
      console.warn(`[Downloader] iTunes query "${q}" notice:`, e);
    }
  }

  // If iTunes yielded relevant matches, return them!
  if (collectedTracks.length > 0) {
    return {
      type: 'search',
      query: trimmed,
      tracks: collectedTracks.slice(0, 20),
    };
  }

  // Stage B: Fallback to YouTube Music & InnerTube search (e.g. for songs missing in iTunes)
  try {
    const candidatePool: YouTubeCandidate[] = [];
    const poolSeenIds = new Set<string>();

    for (const q of uniqueQueries.slice(0, 4)) {
      const ytCandidates = await searchYouTubeCandidates(q);
      for (const c of ytCandidates) {
        if (!poolSeenIds.has(c.id)) {
          poolSeenIds.add(c.id);
          candidatePool.push(c);
        }
      }
      if (candidatePool.length >= 10) break;
    }

    // Score and rank candidates against the target query intent
    const targetMeta = {
      title: queryIntent.coreTitle || trimmed,
      artist: queryIntent.mainArtist !== 'Unknown Artist' ? queryIntent.mainArtist : trimmed,
    };

    const scoredCandidates = candidatePool
      .filter(c => c.duration <= 1200) // Disqualify long compilations
      .map(c => scoreCandidate(targetMeta, c))
      .filter(s => s.score >= 40) // Exclude negative and very poor matches (covers, karaoke)
      .sort((a, b) => b.score - a.score);

    for (const s of scoredCandidates) {
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
        trackNumber: collectedTracks.length + 1,
        sourceUrl: c.url,
        artworkUrl: c.thumbnailUrl || '',
        duration: c.duration,
      });
    }

    if (collectedTracks.length > 0) {
      return {
        type: 'search',
        query: trimmed,
        tracks: collectedTracks.slice(0, 20),
      };
    }
  } catch (ytErr) {
    console.warn('[Downloader] YouTube search fallback notice:', ytErr);
  }

  // Stage C: Final fallback to yt-dlp search
  const ytDlpPath = await getYtDlpPath();
  const { stdout } = await execFilePromise(ytDlpPath, [
    `ytsearch10:${trimmed}`,
    '--dump-json',
    '--flat-playlist',
    '--js-runtimes',
    'node',
  ]);

  const lines = stdout.trim().split('\n').filter(Boolean);
  const tracks = lines.map((line, idx) => {
    try {
      const parsed = JSON.parse(line);
      return {
        title: parsed.title || 'Unknown Title',
        artist: parsed.uploader || 'Unknown Artist',
        album: 'YouTube Search',
        trackNumber: idx + 1,
        sourceUrl: parsed.url || (parsed.id ? `https://www.youtube.com/watch?v=${parsed.id}` : undefined),
        artworkUrl: parsed.thumbnails?.[0]?.url || '',
        duration: Math.round(parsed.duration || 0),
      };
    } catch (e) {
      return null;
    }
  }).filter(Boolean);

  return {
    type: 'search',
    query: trimmed,
    tracks,
  };
}

router.post('/resolve', async (req, res) => {
  try {
    const { urlOrQuery } = req.body;
    if (!urlOrQuery || typeof urlOrQuery !== 'string') {
      return res.status(400).json({ error: 'Search query or URL is required' });
    }

    const result = await resolveUrlOrQuery(urlOrQuery);
    return res.json(result);
  } catch (error: any) {
    console.error('Error resolving URL/query:', error);
    res.status(500).json({ error: error.message || 'Failed to resolve search or music URL' });
  }
});

// -------------------------------------------------------------------
// DOWNLOAD EXECUTION ENDPOINTS
// -------------------------------------------------------------------

router.post('/start', async (req, res) => {
  try {
    const {
      libraryId,
      format = 'mp3',
      quality = '320k',
      embedMetadata = true,
      embedArtwork = true,
      folderStructure = '{artist}/{artist} - {title}',
      playlistFolder = true,
      playlistName,
      downloadLyrics,
      download_lyrics,
      lyricsProviders,
      lyrics_providers,
      tracks = [],
    } = req.body;

    if (!Array.isArray(tracks) || tracks.length === 0) {
      return res.status(400).json({ error: 'No tracks specified for download' });
    }

    // Resolve target library path
    let targetLib;
    if (libraryId) {
      const libs = await db.select().from(libraries).where(eq(libraries.id, Number(libraryId))).limit(1);
      if (libs.length > 0) targetLib = libs[0];
    }

    if (!targetLib) {
      const allLibs = await db.select().from(libraries).limit(1);
      if (allLibs.length > 0) {
        targetLib = allLibs[0];
      } else {
        return res.status(400).json({ error: 'No media library configured in Yimly. Please add a library in Settings first.' });
      }
    }

    const allSettings = await db.select().from(settings);
    const settingsMap = new Map(allSettings.map((s) => [s.key, s.value]));

    const reqDlLyrics = downloadLyrics ?? download_lyrics;
    const finalDownloadLyrics = reqDlLyrics !== undefined
      ? Boolean(reqDlLyrics)
      : settingsMap.get('downloader_download_lyrics') !== 'false';

    const reqProviders = lyricsProviders ?? lyrics_providers;
    let finalProviders: string[] = ['lrclib'];
    if (reqProviders) {
      finalProviders = Array.isArray(reqProviders) ? reqProviders : [reqProviders];
    } else if (settingsMap.has('downloader_lyrics_providers')) {
      try {
        const parsed = JSON.parse(settingsMap.get('downloader_lyrics_providers')!);
        if (Array.isArray(parsed) && parsed.length > 0) {
          finalProviders = parsed;
        }
      } catch (e) {
        finalProviders = ['lrclib'];
      }
    }

    const trackMetadataList: TrackMetadata[] = tracks.map((t: any) => ({
      title: t.title || 'Unknown Title',
      artist: t.artist || 'Unknown Artist',
      album: t.album || 'Unknown Album',
      trackNumber: t.trackNumber,
      discNumber: t.discNumber,
      releaseYear: t.releaseYear,
      duration: t.duration,
      artworkUrl: t.artworkUrl,
      sourceUrl: t.sourceUrl,
    }));

    // Add to persistent queue
    const activeJob = await downloadQueue.addJob({
      playlistName,
      libraryId: targetLib.id,
      libraryPath: targetLib.path,
      format,
      quality,
      embedMetadata,
      embedArtwork,
      downloadLyrics: finalDownloadLyrics,
      lyricsProviders: finalProviders,
      folderStructure,
      playlistFolder,
      tracks: trackMetadataList,
    });

    res.json({
      jobId: activeJob.id,
      message: 'Download job started',
      totalTracks: activeJob.totalCount,
      libraryName: targetLib.name,
      libraryPath: targetLib.path,
    });
  } catch (error: any) {
    console.error('Failed to start download job:', error);
    res.status(500).json({ error: error.message || 'Failed to start download' });
  }
});

router.get('/jobs/:jobId', async (req, res) => {
  try {
    const job = await downloadQueue.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Download job not found' });
    }
    res.json(job);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to get job' });
  }
});

router.post('/cancel/:jobId', async (req, res) => {
  try {
    const success = await downloadQueue.cancelJob(req.params.jobId);
    if (!success) {
      return res.status(404).json({ error: 'Download job not found' });
    }
    res.json({ message: 'Job cancelled' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to cancel job' });
  }
});

router.post('/jobs/:jobId/retry-failed', async (req, res) => {
  try {
    const success = await downloadQueue.retryFailedTracks(req.params.jobId);
    if (!success) {
      return res.status(404).json({ error: 'Download job not found' });
    }
    res.json({ message: 'Retrying failed tracks' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retry tracks' });
  }
});

export default router;
