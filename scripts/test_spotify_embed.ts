async function testEmbedPlaylist() {
  const playlistId = '37i9dQZF1DXcBWIGoYBM5M'; // Today's Top Hits
  const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}`;
  const res = await fetch(embedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });

  console.log('Status:', res.status);
  const html = await res.text();
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
  if (nextDataMatch) {
    const data = JSON.parse(nextDataMatch[1]);
    const entity = data.props?.pageProps?.state?.data?.entity;
    console.log('Entity keys:', Object.keys(entity || {}));
    console.log('Track list length:', entity?.trackList?.length);
    console.log('Sample track 0:', entity?.trackList?.[0]);
  }
}

testEmbedPlaylist().catch(console.error);
