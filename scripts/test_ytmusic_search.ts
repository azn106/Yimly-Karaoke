async function testYTMusicSearch() {
  console.log('Testing YouTube Music WEB_REMIX search endpoint...');
  const query = 'Rick Astley - Never Gonna Give You Up';
  
  // YouTube Music search endpoint
  const url = 'https://music.youtube.com/youtubei/v1/search?prettyPrint=false';
  
  const body = {
    context: {
      client: {
        clientName: 'WEB_REMIX',
        clientVersion: '1.20240401.01.00',
        hl: 'en',
        gl: 'US',
      },
    },
    query,
    // params for 'Songs' filter in YouTube Music: Eg-KAQwIABAAGAEgASgB
    params: 'Eg-KAQwIABAAGAEgASgB',
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': 'https://music.youtube.com/',
      'Origin': 'https://music.youtube.com',
    },
    body: JSON.stringify(body),
  });

  console.log('Status:', res.status);
  const data = await res.json();
  console.log('Response keys:', Object.keys(data));
  
  // Inspect sections in contents
  const sectionList = data.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents
    || data.contents?.sectionListRenderer?.contents;
  
  console.log('Found sectionList:', !!sectionList, 'Sections:', sectionList?.length);

  const songs: any[] = [];
  if (Array.isArray(sectionList)) {
    for (const sec of sectionList) {
      const musicShelf = sec.musicShelfRenderer;
      if (musicShelf?.contents) {
        for (const item of musicShelf.contents) {
          const respItem = item.musicResponsiveListItemRenderer;
          if (respItem) {
            const flexCols = respItem.flexColumns || [];
            
            // Col 0: title
            const titleRuns = flexCols[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
            const title = titleRuns?.[0]?.text || '';
            const videoId = respItem.playlistItemData?.videoId || respItem.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;

            // Col 1: artists, album, duration
            const metaRuns = flexCols[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
            const metaTexts = metaRuns.map((r: any) => r.text).filter(Boolean);
            
            // Duration is usually the last run or in fixed columns
            const durationText = respItem.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text
              || metaTexts[metaTexts.length - 1];

            songs.push({
              videoId,
              title,
              metaTexts,
              durationText,
            });
          }
        }
      }
    }
  }

  console.log('Extracted YouTube Music songs:', songs.slice(0, 5));
}

testYTMusicSearch().catch(console.error);
