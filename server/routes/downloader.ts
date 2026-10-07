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
          return {
            title: parsed.title || 'Unknown Title',
            artist: parsed.uploader || parsed.artist || 'Unknown Artist',
            album: 'YouTube Playlist',
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
      const track = {
        title: parsed.track || parsed.title || 'Unknown Title',
        artist: parsed.artist || parsed.uploader || 'Unknown Artist',
        album: parsed.album || 'Single',
        duration: Math.round(parsed.duration || 0),
        artworkUrl: parsed.thumbnail || (parsed.thumbnails?.[0]?.url || ''),
        sourceUrl: trimmed,
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

  // 3. Text Search Query (via iTunes Search API + fallback)
  const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(trimmed)}&entity=song&limit=15`;
  const itunesRes = await fetch(itunesUrl);
  if (itunesRes.ok) {
    const itunesData = await itunesRes.json();
    if (itunesData.results && itunesData.results.length > 0) {
      const tracks = itunesData.results.map((item: any, idx: number) => ({
        title: item.trackName || 'Unknown Title',
        artist: item.artistName || 'Unknown Artist',
        album: item.collectionName || 'Single',
        trackNumber: item.trackNumber || idx + 1,
        discNumber: item.discNumber || 1,
        releaseYear: item.releaseDate ? new Date(item.releaseDate).getFullYear() : undefined,
        artworkUrl: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '600x600bb') : '',
        duration: Math.round((item.trackTimeMillis || 0) / 1000),
      }));

      return {
        type: 'search',
        query: trimmed,
        tracks,
      };
    }
  }

  // Fallback search via yt-dlp search
  const ytDlpPath = await getYtDlpPath();
  const { stdout } = await execFilePromise(ytDlpPath, [
    `ytsearch5:${trimmed}`,
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
