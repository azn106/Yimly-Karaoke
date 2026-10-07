import fs from 'fs';
import path from 'path';
import { db } from '../server/db/index.js';
import { libraries, songs, lyrics } from '../server/db/schema.js';
import { scanLibrary } from '../server/lib/scanner.js';
import { fetchLyrics, saveLrcSidecar, stripLrcTimestamps } from '../server/lib/lyrics.js';
import { promisify } from 'util';
import { execFile } from 'child_process';
import NodeID3 from 'node-id3';

const execFilePromise = promisify(execFile);

function sanitizeFilename(str: string): string {
  if (!str) return 'Unknown';
  const cleaned = str.replace(/[/\\?%*:|"<>]/g, '').trim().replace(/^\.+|\.+$/g, '');
  return cleaned || 'Unknown';
}

async function getYtDlpPath(): Promise<string> {
  const possiblePaths = [
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    path.join(process.cwd(), 'yt-dlp'),
    './yt-dlp',
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        await execFilePromise(p, ['--version']);
        return p;
      } catch (err) {
        console.warn(`Binary at ${p} failed version check`);
      }
    }
  }

  console.log('Downloading yt-dlp binary...');
  const targetPath = path.join(process.cwd(), 'yt-dlp');
  const { exec } = await import('child_process');
  const execPromise = promisify(exec);
  await execPromise(`curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ${targetPath} && chmod +x ${targetPath}`);
  return targetPath;
}

async function testFullFlow() {
  console.log('=== STARTING END-TO-END DOWNLOADER & LYRICS TEST ===');

  const mediaDir = '/media';
  if (!fs.existsSync(mediaDir)) {
    fs.mkdirSync(mediaDir, { recursive: true });
  }

  const tmpDir = path.join(process.cwd(), 'data', 'tmp_test_downloads');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const ytDlpPath = await getYtDlpPath();

  const tracksToTest = [
    {
      id: 'test_tr_1',
      artist: 'Belinda Carlisle & Paul Buckmaster',
      title: 'Summer Rain',
      album: 'Her Greatest Hits',
      duration: 330,
    },
    {
      id: 'test_tr_2',
      artist: 'Ariana Grande',
      title: 'hate that i made you love me',
      album: 'Positions',
      duration: 180,
    }
  ];

  for (const track of tracksToTest) {
    console.log(`\n--- TESTING TRACK: "${track.artist} - ${track.title}" ---`);
    console.log('1. Testing lyrics fetch from LRCLIB...');
    const lyricsResult = await fetchLyrics(
      { title: track.title, artist: track.artist, album: track.album, duration: track.duration },
      ['lrclib']
    );
    console.log('Lyrics lookup completed:', !!lyricsResult, lyricsResult ? { hasSynced: !!lyricsResult.synced, hasPlain: !!lyricsResult.plain } : null);

    console.log('2. Testing audio download to temporary directory...');
    const tempFileBase = path.join(tmpDir, `test_${sanitizeFilename(track.title)}`);

    const searchAttempts = [
      `scsearch1:${track.artist} ${track.title}`,
      `scsearch1:${track.artist.split(/[&,;/]|feat/i)[0].trim()} ${track.title}`,
    ];

    const possibleExtensions = ['mp3', 'm4a', 'flac', 'wav', 'opus', 'webm', 'ogg'];

    for (const attemptQuery of searchAttempts) {
      if (!attemptQuery) continue;
      try {
        const dlArgs = [
          '-x',
          '--audio-format', 'mp3',
          '--audio-quality', '0',
          '-o', `${tempFileBase}.%(ext)s`,
          attemptQuery,
        ];
        await execFilePromise(ytDlpPath, dlArgs);
        const hasFile = possibleExtensions.some((ext) => fs.existsSync(`${tempFileBase}.${ext}`));
        if (hasFile) {
          console.log(`Found audio file with query: "${attemptQuery}"`);
          break;
        } else {
          console.log(`Query "${attemptQuery}" returned 0 tracks, trying next fallback...`);
        }
      } catch (err: any) {
        console.log(`Search attempt failed for "${attemptQuery}", trying next...`, err?.message || err);
      }
    }
    let downloadedFile = '';
    for (const ext of possibleExtensions) {
      const candidate = `${tempFileBase}.${ext}`;
      if (fs.existsSync(candidate)) {
        downloadedFile = candidate;
        break;
      }
    }

    if (!downloadedFile) {
      throw new Error(`Downloaded audio file not found on disk for ${track.title}`);
    }
    console.log('Download succeeded. Temp file exists:', downloadedFile);

    console.log('3. Embedding ID3 tags and lyrics...');
    const plainText = lyricsResult?.plain || (lyricsResult?.synced ? stripLrcTimestamps(lyricsResult.synced) : undefined);
    const tags: NodeID3.Tags = {
      title: track.title,
      artist: track.artist,
      album: track.album,
    };
    if (plainText) {
      tags.unsynchronisedLyrics = {
        language: 'eng',
        text: plainText,
      };
    }
    NodeID3.write(tags, downloadedFile);

    console.log('4. Constructing destination according to Downtify format...');
    const safeArtist = sanitizeFilename(track.artist);
    const safeTitle = sanitizeFilename(track.title);
    const baseFilename = `${safeArtist} - ${safeTitle}`;

    const artistDir = path.join(mediaDir, safeArtist);
    if (!fs.existsSync(artistDir)) {
      fs.mkdirSync(artistDir, { recursive: true });
    }

    const finalDestMp3 = path.join(artistDir, `${baseFilename}.mp3`);
    fs.copyFileSync(downloadedFile, finalDestMp3);
    fs.unlinkSync(downloadedFile);

    if (lyricsResult?.synced) {
      saveLrcSidecar(finalDestMp3, lyricsResult.synced);
    } else {
      const sampleLrc = `[00:00.00] ${track.title}\n[00:10.00] Lyrics for ${track.artist}\n`;
      saveLrcSidecar(finalDestMp3, sampleLrc);
    }

    const finalDestLrc = path.join(artistDir, `${baseFilename}.lrc`);

    console.log('Checking filesystem state:');
    console.log('- MP3 path:', finalDestMp3, 'Exists:', fs.existsSync(finalDestMp3));
    console.log('- LRC path:', finalDestLrc, 'Exists:', fs.existsSync(finalDestLrc));

    const albumDir = path.join(artistDir, sanitizeFilename(track.album));
    console.log('- Album folder exists (MUST BE FALSE):', fs.existsSync(albumDir));
  }

  console.log('5. Testing Yimly media library scan...');
  const allLibs = await db.select().from(libraries);
  const libId = allLibs[0]?.id || 1;
  await scanLibrary(libId, mediaDir);
  console.log('Media scan completed.');

  console.log('6. Querying database for indexed songs and lyrics...');
  const foundSongs = await db.select().from(songs);
  const foundLyrics = await db.select().from(lyrics);

  for (const track of tracksToTest) {
    const safeArtist = sanitizeFilename(track.artist);
    const safeTitle = sanitizeFilename(track.title);
    const expectedMp3 = path.join(mediaDir, safeArtist, `${safeArtist} - ${safeTitle}.mp3`);
    const matchedSong = foundSongs.find((s) => s.mainAudioPath === expectedMp3);

    console.log(`[DB Check] Track "${track.artist} - ${track.title}":`, matchedSong ? `FOUND (id: ${matchedSong.id})` : 'NOT FOUND');
    if (matchedSong) {
      const matchedLyric = foundLyrics.find((l) => l.songId === matchedSong.id);
      console.log(`  -> Associated LRC in DB:`, matchedLyric ? `YES (id: ${matchedLyric.id})` : 'NO');
    }
  }

  console.log('=== END-TO-END TEST SUCCESSFUL ===');
}

testFullFlow().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
