async function inspectSongDetails() {
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
  
  const songs: any[] = [];
  if (Array.isArray(sectionList)) {
    for (const sec of sectionList) {
      const items = sec.itemSectionRenderer?.contents || sec.musicShelfRenderer?.contents || [];
      for (const item of items) {
        const r = item.musicResponsiveListItemRenderer;
        if (r) {
          const videoId = r.playlistItemData?.videoId
            || r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId
            || r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;
          
          const title = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text;
          
          // Collect all runs across flexColumns and fixedColumns
          const col1Runs = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
          const col2Runs = r.flexColumns?.[2]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
          const fixedRuns = r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs || [];
          
          let durationStr = fixedRuns?.[0]?.text;
          let artists = '';
          let album = '';

          const metaText = [...col1Runs, ...col2Runs].map(x => x.text).join('');
          
          // Find time pattern like 3:33 or 03:33 in any run
          const allRuns = [...col1Runs, ...col2Runs, ...fixedRuns];
          for (const run of allRuns) {
            if (/^\d+:\d{2}(:\d{2})?$/.test(run.text?.trim())) {
              durationStr = run.text.trim();
            }
          }

          songs.push({
            videoId,
            title,
            metaText,
            durationStr,
            fullRuns: allRuns.map(r => r.text),
          });
        }
      }
    }
  }

  console.log('Parsed songs with videoId and duration:', songs.filter(s => s.videoId).slice(0, 8));
}

inspectSongDetails().catch(console.error);
