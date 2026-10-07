async function testYouTubeHtmlScrape() {
  console.log('Testing YouTube web results page parsing (ytInitialData)...');
  const query = 'Rick Astley Never Gonna Give You Up official audio';
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    }
  });

  console.log('Response status:', res.status);
  const html = await res.text();
  console.log('HTML length:', html.length);

  // Extract ytInitialData
  const match = html.match(/var ytInitialData = ({[\s\S]*?});<\/script>/) || html.match(/ytInitialData\s*=\s*({[\s\S]*?});/);
  if (match) {
    console.log('Found ytInitialData!');
    try {
      const data = JSON.parse(match[1]);
      const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
      console.log('Primary contents length:', contents?.length);

      const results: any[] = [];
      if (contents) {
        for (const section of contents) {
          const itemSection = section.itemSectionRenderer;
          if (itemSection?.contents) {
            for (const item of itemSection.contents) {
              const video = item.videoRenderer;
              if (video && video.videoId) {
                const title = video.title?.runs?.[0]?.text || '';
                const uploader = video.ownerText?.runs?.[0]?.text || '';
                const durationText = video.lengthText?.simpleText || '';
                results.push({
                  id: video.videoId,
                  title,
                  uploader,
                  durationText,
                  url: `https://www.youtube.com/watch?v=${video.videoId}`
                });
              }
            }
          }
        }
      }

      console.log('Extracted videos count:', results.length);
      console.log('Top 3 videos:', results.slice(0, 3));
    } catch (e: any) {
      console.log('JSON parse error:', e.message);
    }
  } else {
    console.log('No ytInitialData found');
  }
}

testYouTubeHtmlScrape().catch(console.error);
