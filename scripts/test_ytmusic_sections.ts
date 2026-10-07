async function parseAllSections() {
  const query = 'Rick Astley - Never Gonna Give You Up';
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
    params: 'Eg-KAQwIABAAGAEgASgB',
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  const sectionList = data.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents;
  
  for (let i = 0; i < (sectionList || []).length; i++) {
    const sec = sectionList[i];
    const key = Object.keys(sec)[0];
    const shelf = sec[key];
    const shelfTitle = shelf?.title?.runs?.[0]?.text || shelf?.header?.musicHeaderRenderer?.title?.runs?.[0]?.text || 'No title';
    console.log(`Sec ${i}: [${key}] Title: "${shelfTitle}" - items: ${shelf?.contents?.length || 0}`);
    if (shelf?.contents) {
      for (const item of shelf.contents) {
        const r = item.musicResponsiveListItemRenderer;
        if (r) {
          const title = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text;
          const col1Runs = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.map((x: any) => x.text) || [];
          const videoId = r.playlistItemData?.videoId || r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
          console.log(`  -> Song: "${title}" | Info: ${col1Runs.join('')} | videoId: ${videoId}`);
        }
      }
    }
  }
}

parseAllSections().catch(console.error);
