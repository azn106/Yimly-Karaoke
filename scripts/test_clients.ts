import { getYtDlpPath } from '../server/lib/download-queue.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFilePromise = promisify(execFile);

async function testPlayerClients() {
  const ytDlp = await getYtDlpPath();

  const clients = [
    'ios',
    'mweb',
    'tv_embedded',
    'android_creator',
    'tv',
    'web_embedded',
    'mweb,ios',
    'ios,mweb,tv_embedded'
  ];

  const query = 'ytsearch1:Never Gonna Give You Up Rick Astley';

  for (const client of clients) {
    console.log(`Testing client: ${client}...`);
    try {
      const { stdout } = await execFilePromise(ytDlp, [
        '--dump-json',
        '--no-playlist',
        '--js-runtimes', 'node',
        '--extractor-args', `youtube:player_client=${client}`,
        query,
      ], { timeout: 15000 });
      const parsed = JSON.parse(stdout);
      console.log(`SUCCESS for client ${client}:`, {
        id: parsed.id,
        title: parsed.title,
        webpage_url: parsed.webpage_url
      });
      break;
    } catch (e: any) {
      console.log(`Failed for client ${client}:`, e.message.split('\n')[0]);
    }
  }

  // Also test soundcloud search
  console.log('\nTesting SoundCloud search (scsearch1)...');
  try {
    const { stdout } = await execFilePromise(ytDlp, [
      '--dump-json',
      '--no-playlist',
      'scsearch1:Never Gonna Give You Up Rick Astley',
    ], { timeout: 15000 });
    const parsed = JSON.parse(stdout);
    console.log('SUCCESS for SoundCloud search:', {
      id: parsed.id,
      title: parsed.title,
      uploader: parsed.uploader,
      url: parsed.webpage_url
    });
  } catch (e: any) {
    console.log('SoundCloud failed:', e.message);
  }
}

testPlayerClients().catch(console.error);
