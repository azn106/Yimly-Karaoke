async function testSpotifyWebToken() {
  console.log('Fetching Spotify anonymous web token...');
  const tokenRes = await fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });

  console.log('Token response status:', tokenRes.status);
  const tokenData = await tokenRes.json();
  console.log('Token data:', {
    hasToken: !!tokenData.accessToken,
    isAnonymous: tokenData.isAnonymous,
    clientId: tokenData.clientId,
  });

  if (tokenData.accessToken) {
    const playlistId = '37i9dQZF1DXcBWIGoYBM5M'; // Today's Top Hits
    const plRes = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
      headers: {
        Authorization: `Bearer ${tokenData.accessToken}`,
      },
    });
    console.log('Playlist fetch status:', plRes.status);
    if (plRes.ok) {
      const plData = await plRes.json();
      console.log('Playlist title:', plData.name);
      console.log('Total tracks:', plData.tracks?.total);
      console.log('Items in first page:', plData.tracks?.items?.length);
      const first = plData.tracks?.items?.[0]?.track;
      if (first) {
        console.log('Sample Track 1:', {
          title: first.name,
          artist: first.artists?.map((a: any) => a.name).join(', '),
          album: first.album?.name,
          durationSeconds: Math.round(first.duration_ms / 1000),
          releaseDate: first.album?.release_date,
          artworkUrl: first.album?.images?.[0]?.url,
        });
      }
    }
  }
}

testSpotifyWebToken().catch(console.error);
