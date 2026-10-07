import { execFile } from 'child_process';
import { getYtDlpPath } from '../server/lib/download-queue.js';

async function testYtDlp() {
  const ytDlpPath = await getYtDlpPath();
  const url = 'https://www.youtube.com/watch?v=GHMjD0Lp5DY'; // Rick Astley audio

  const args = [
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '0',
    '--no-playlist',
    '--extractor-args', 'youtube:player_client=web_creator,android,ios,web',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    '--max-filesize', '100M',
    '-o', './data/tmp_downloads/test_sample.%(ext)s',
    url,
  ];

  console.log('Running yt-dlp with arguments...');
  execFile(ytDlpPath, args, (err, stdout, stderr) => {
    if (err) {
      console.error('yt-dlp error:', err);
      console.error('stderr:', stderr);
    } else {
      console.log('yt-dlp success! stdout:', stdout);
    }
  });
}

testYtDlp().catch(console.error);
