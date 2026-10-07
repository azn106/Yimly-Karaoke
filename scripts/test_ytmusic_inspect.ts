async function inspectYTMusicStructure() {
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
    params: 'Eg-KAQwIABAAGAEgASgB', // Songs filter
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
  console.log('Section list length:', sectionList?.length);
  if (sectionList && sectionList.length > 0) {
    console.log('Section 0 keys:', Object.keys(sectionList[0]));
    const musicShelf = sectionList[0].musicShelfRenderer || sectionList[0].musicCardShelfRenderer;
    console.log('MusicShelf title:', musicShelf?.title?.runs?.[0]?.text);
    console.log('MusicShelf contents count:', musicShelf?.contents?.length);
    if (musicShelf?.contents?.[0]) {
      console.log('Item 0 JSON snippet:', JSON.stringify(musicShelf.contents[0], null, 2).slice(0, 1000));
    }
  }
}

inspectYTMusicStructure().catch(console.error);
