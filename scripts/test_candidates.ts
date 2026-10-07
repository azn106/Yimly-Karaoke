async function testDualCandidateExtraction() {
  const query = 'Rick Astley - Never Gonna Give You Up official audio';
  
  // 1. YouTube InnerTube API
  const ytRes = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
    body: JSON.stringify({
      context: {
        client: {
          hl: 'en',
          gl: 'US',
          clientName: 'WEB',
          clientVersion: '2.20240401.00.00',
        },
      },
      query,
    }),
  });

  const ytData = await ytRes.json();
  const contents = ytData.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
  const candidates: any[] = [];

  if (Array.isArray(contents)) {
    for (const section of contents) {
      const items = section.itemSectionRenderer?.contents;
      if (Array.isArray(items)) {
        for (const item of items) {
          const v = item.videoRenderer;
          if (v && v.videoId) {
            candidates.push({
              id: v.videoId,
              title: v.title?.runs?.[0]?.text || '',
              uploader: v.ownerText?.runs?.[0]?.text || '',
              durationText: v.lengthText?.simpleText || '',
            });
          }
        }
      }
    }
  }

  console.log('YouTube Candidates (with duration):', candidates.slice(0, 5));
}

testDualCandidateExtraction().catch(console.error);
