import { getYtDlpPath } from '../server/lib/download-queue.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFilePromise = promisify(execFile);

async function testSpotify() {
  console.log('1. Checking getYtDlpPath()...');
  const ytDlp = await getYtDlpPath();
  console.log('ytDlp path:', ytDlp);
  const { stdout: ver } = await execFilePromise(ytDlp, ['--version']);
  console.log('ytDlp version:', ver.trim());

  console.log('\n2. Testing Spotify Track URL resolution with yt-dlp...');
  const testTrackUrl = 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT';
  try {
    const { stdout, stderr } = await execFilePromise(ytDlp, [
      '--dump-json',
      '--flat-playlist',
      testTrackUrl
    ]);
    console.log('Track output:', stdout.slice(0, 200));
  } catch (err: any) {
    console.log('Track error:', err.message, err.stderr);
  }

  console.log('\n3. Testing Spotify Playlist URL resolution with yt-dlp...');
  const testPlaylistUrl = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
  try {
    const { stdout, stderr } = await execFilePromise(ytDlp, [
      '--dump-json',
      '--flat-playlist',
      testPlaylistUrl
    ]);
    console.log('Playlist line count:', stdout.trim().split('\n').length);
    console.log('Sample line:', stdout.trim().split('\n')[0]);
  } catch (err: any) {
    console.log('Playlist error:', err.message, err.stderr);
  }

  console.log('\n4. Testing YouTube search for Artist - Title with yt-dlp...');
  const query = 'ytsearch1:Rick Astley - Never Gonna Give You Up audio';
  try {
    const { stdout } = await execFilePromise(ytDlp, [
      '--dump-json',
      '--default-search', 'ytsearch',
      '--no-playlist',
      query
    ]);
    const parsed = JSON.parse(stdout);
    console.log('Search result found:', {
      id: parsed.id,
      title: parsed.title,
      uploader: parsed.uploader,
      duration: parsed.duration,
      url: parsed.webpage_url || `https://www.youtube.com/watch?v=${parsed.id}`,
    });
  } catch (err: any) {
    console.log('YouTube search error:', err.message);
  }
}

testSpotify().catch(console.error);
