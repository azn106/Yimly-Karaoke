import { resolveTrackToYouTube } from '../server/lib/youtube-resolver.js';

async function testBeatles() {
  const query = 'The Beatles - Yesterday official audio';
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  const html = await res.text();
  const match = html.match(/var ytInitialData = ({[\s\S]*?});<\/script>/) || html.match(/ytInitialData\s*=\s*({[\s\S]*?});/);
  const data = JSON.parse(match![1]);
  const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
  
  console.log('Results:');
  for (const section of contents || []) {
    for (const item of section.itemSectionRenderer?.contents || []) {
      const v = item.videoRenderer;
      if (v) {
        console.log({
          id: v.videoId,
          title: v.title?.runs?.[0]?.text,
          uploader: v.ownerText?.runs?.[0]?.text,
          duration: v.lengthText?.simpleText,
        });
      }
    }
  }
}

testBeatles().catch(console.error);
