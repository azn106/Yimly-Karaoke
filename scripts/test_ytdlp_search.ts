import { getYtDlpPath } from '../server/lib/download-queue.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFilePromise = promisify(execFile);

async function testYtDlpSearchMulti() {
  const ytDlp = await getYtDlpPath();
  const sampleTracks = [
    { title: 'Never Gonna Give You Up', artist: 'Rick Astley' },
    { title: 'Blinding Lights', artist: 'The Weeknd' },
    { title: 'Flowers', artist: 'Miley Cyrus' },
    { title: 'Anti-Hero', artist: 'Taylor Swift' },
    { title: 'Shape of You', artist: 'Ed Sheeran' },
  ];

  for (let i = 0; i < sampleTracks.length; i++) {
    const t = sampleTracks[i];
    console.log(`\n[Resolve] ${i + 1}/${sampleTracks.length}`);
    console.log(`Artist: ${t.artist}`);
    console.log(`Title: ${t.title}`);
    const query = `ytsearch1:${t.artist} - ${t.title} official audio`;
    console.log(`Query: ${query}`);

    try {
      const { stdout } = await execFilePromise(ytDlp, [
        '--dump-json',
        '--no-playlist',
        '--js-runtimes', 'node',
        '--extractor-args', 'youtube:player_client=mweb,web',
        query,
      ], { timeout: 20000 });

      const parsed = JSON.parse(stdout);
      const url = parsed.webpage_url || `https://www.youtube.com/watch?v=${parsed.id}`;
      console.log(`[Resolve] YouTube result: ${url}`);
      console.log(`[Resolve] Title: "${parsed.title}", Uploader: "${parsed.uploader}", Duration: ${parsed.duration}s`);
      console.log(`[Resolve] SUCCESS`);
    } catch (err: any) {
      console.log(`[Resolve] FAILED: ${err.message}`);
    }
  }
}

testYtDlpSearchMulti().catch(console.error);
