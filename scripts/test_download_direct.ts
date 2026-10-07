import { getYtDlpPath } from '../server/lib/download-queue.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execFilePromise = promisify(execFile);

async function testDownloadVideoUrl() {
  const ytDlp = await getYtDlpPath();
  const videoUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const outPath = '/tmp/test_rick_direct.mp3';
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

  console.log('Downloading directly from YouTube URL:', videoUrl);
  const { stdout, stderr } = await execFilePromise(ytDlp, [
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '0',
    '--no-playlist',
    '--js-runtimes', 'node',
    '--extractor-args', 'youtube:player_client=mweb,web',
    '-o', '/tmp/test_rick_direct.%(ext)s',
    videoUrl
  ]);

  console.log('Download completed. File exists:', fs.existsSync(outPath));
  if (fs.existsSync(outPath)) {
    console.log('File size bytes:', fs.statSync(outPath).size);
  }
}

testDownloadVideoUrl().catch(console.error);
