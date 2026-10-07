async function testAllEmbedTypes() {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  };

  // 1. Track
  console.log('--- TRACK EMBED ---');
  const trackRes = await fetch('https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT', { headers });
  const trackHtml = await trackRes.text();
  const trackMatch = trackHtml.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
  if (trackMatch) {
    const tData = JSON.parse(trackMatch[1]);
    const entity = tData.props?.pageProps?.state?.data?.entity;
    console.log('Track Entity:', {
      name: entity?.name || entity?.title,
      artist: entity?.artists?.[0]?.name || entity?.subtitle,
      artists: entity?.artists,
      album: entity?.album?.name || entity?.albumTitle,
      duration: entity?.duration,
      coverArt: entity?.visualIdentity?.image?.[0]?.url || entity?.coverArt?.sources?.[0]?.url,
    });
  }

  // 2. Album
  console.log('\n--- ALBUM EMBED ---');
  const albumRes = await fetch('https://open.spotify.com/embed/album/4LH4d3cOWNNXdURXd407Pt', { headers });
  const albumHtml = await albumRes.text();
  const albumMatch = albumHtml.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
  if (albumMatch) {
    const aData = JSON.parse(albumMatch[1]);
    const entity = aData.props?.pageProps?.state?.data?.entity;
    console.log('Album Entity:', {
      name: entity?.name || entity?.title,
      artist: entity?.artists?.[0]?.name || entity?.subtitle,
      trackCount: entity?.trackList?.length,
      sampleTrack: entity?.trackList?.[0],
    });
  }

  // 3. Playlist
  console.log('\n--- PLAYLIST EMBED ---');
  const playlistRes = await fetch('https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M', { headers });
  const playlistHtml = await playlistRes.text();
  const playlistMatch = playlistHtml.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
  if (playlistMatch) {
    const pData = JSON.parse(playlistMatch[1]);
    const entity = pData.props?.pageProps?.state?.data?.entity;
    console.log('Playlist Entity:', {
      name: entity?.name || entity?.title,
      trackCount: entity?.trackList?.length,
      sampleTrack: entity?.trackList?.[0],
      rawKeys: Object.keys(entity || {}),
    });
  }
}

testAllEmbedTypes().catch(console.error);
