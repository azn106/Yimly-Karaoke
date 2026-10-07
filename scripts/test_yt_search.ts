import { getYtDlpPath } from '../server/lib/download-queue.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFilePromise = promisify(execFile);

async function testYouTubeSearchAndDownload() {
  const ytDlp = await getYtDlpPath();
  console.log('Testing yt-dlp search with client args...');

  const query = 'ytsearch1:Rick Astley - Never Gonna Give You Up official audio';
  
  // Test 1: Search with client args
  try {
    const { stdout, stderr } = await execFilePromise(ytDlp, [
      '--dump-json',
      '--no-playlist',
      '--js-runtimes', 'node',
      '--extractor-args', 'youtube:player_client=android,web',
      query,
    ]);

    const parsed = JSON.parse(stdout);
    console.log('Test 1 Success! Found video:', {
      id: parsed.id,
      title: parsed.title,
      uploader: parsed.uploader,
      duration: parsed.duration,
      url: `https://www.youtube.com/watch?v=${parsed.id}`,
    });
  } catch (e: any) {
    console.log('Test 1 Failed:', e.message);
  }

  // Test 2: Test audio download with android player client
  try {
    const tmpDest = '/tmp/test_download_rick.%(ext)s';
    console.log('Testing audio download...');
    const { stdout, stderr } = await execFilePromise(ytDlp, [
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--no-playlist',
      '--js-runtimes', 'node',
      '--extractor-args', 'youtube:player_client=android,web',
      '-o', tmpDest,
      query,
    ]);
    console.log('Test 2 Audio download success!');
  } catch (e: any) {
    console.log('Test 2 Audio download failed:', e.message);
  }
}

testYouTubeSearchAndDownload().catch(console.error);
