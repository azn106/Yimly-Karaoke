async function testYouTubeAndroidSearch() {
  console.log('Testing YouTube Android InnerTube client search...');

  const sampleTracks = [
    { title: 'Never Gonna Give You Up', artist: 'Rick Astley' },
    { title: 'Blinding Lights', artist: 'The Weeknd' },
    { title: 'Flowers', artist: 'Miley Cyrus' },
    { title: 'Anti-Hero', artist: 'Taylor Swift' },
    { title: 'Shape of You', artist: 'Ed Sheeran' },
  ];

  for (const t of sampleTracks) {
    const query = `${t.artist} - ${t.title} official audio`;
    const res = await fetch('https://www.youtube.com/youtubei/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11; en_US) gzip',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '19.09.37',
            hl: 'en',
            gl: 'US',
          }
        },
        query: query,
      })
    });

    const data = await res.json();
    const sectionList = data.contents?.sectionListRenderer?.contents;
    let foundVideo: any = null;

    if (sectionList) {
      for (const sec of sectionList) {
        const items = sec.itemSectionRenderer?.contents;
        if (items) {
          for (const item of items) {
            const v = item.videoRenderer || item.compactVideoRenderer;
            if (v && v.videoId) {
              const title = v.title?.runs?.[0]?.text || v.title?.accessibility?.accessibilityData?.label || '';
              const uploader = v.ownerText?.runs?.[0]?.text || v.shortBylineText?.runs?.[0]?.text || '';
              const lengthText = v.lengthText?.accessibility?.accessibilityData?.label || v.lengthText?.runs?.[0]?.text || '';
              foundVideo = {
                id: v.videoId,
                title,
                uploader,
                lengthText,
                url: `https://www.youtube.com/watch?v=${v.videoId}`
              };
              break;
            }
          }
        }
        if (foundVideo) break;
      }
    }

    console.log(`\nTrack: ${t.artist} - ${t.title}`);
    console.log('Result:', foundVideo);
  }
}

testYouTubeAndroidSearch().catch(console.error);
