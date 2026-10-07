async function testSpotifyToken() {
  // Test 1: spotify web client token
  const clientId = 'd8a5de95d3bc4da29ea3d307784d538f'; // Standard Spotify Web Player client ID
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
  });
  
  // Try client credentials token
  try {
    const res = await fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web-player', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://open.spotify.com/',
        'Origin': 'https://open.spotify.com',
      }
    });
    console.log('Get access token status:', res.status);
    if (res.ok) {
      const data = await res.json();
      console.log('Access token data:', data);
    }
  } catch (e: any) {
    console.log('Token error:', e.message);
  }

  // Test 2: Spotify embed with large playlist (> 100 tracks)
  // Let's test a known large playlist e.g. "Top 500 Songs of All Time" or similar
  const largePlaylistId = '5mG4rFw9P1K6p03n40v0lT'; // or other
  const res2 = await fetch(`https://open.spotify.com/embed/playlist/37i9dQZF1DWXRqgorJj26U`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    }
  });
  const html2 = await res2.text();
  const nextDataMatch = html2.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
  if (nextDataMatch) {
    const data = JSON.parse(nextDataMatch[1]);
    const entity = data.props?.pageProps?.state?.data?.entity;
    console.log('Rock Classics Playlist tracks count:', entity?.trackList?.length);
  }
}

testSpotifyToken().catch(console.error);
