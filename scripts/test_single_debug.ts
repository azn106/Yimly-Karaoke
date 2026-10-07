import { resolveTrackToYouTube } from '../server/lib/youtube-resolver.js';

async function testSingle() {
  const res = await resolveTrackToYouTube({ title: 'Yesterday', artist: 'The Beatles', duration: 125 });
  console.log('Result:', res);
}

testSingle().catch(console.error);
