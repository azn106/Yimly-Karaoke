async function testSpotifyPagination() {
  const playlistId = '37i9dQZF1DXcBWIGoYBM5M';
  
  // Test if embed accepts offset or limit
  const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}?utm_source=generator`;
  const res = await fetch(embedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });

  const html = await res.text();
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
  if (nextDataMatch) {
    const data = JSON.parse(nextDataMatch[1]);
    const entity = data.props?.pageProps?.state?.data?.entity;
    console.log('Playlist name:', entity?.name);
    console.log('Total tracks reported:', entity?.duration, 'Tracks array count:', entity?.trackList?.length);
  }
}

testSpotifyPagination().catch(console.error);
