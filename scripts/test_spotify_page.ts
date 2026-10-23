async function testSpotifyPage() {
  const playlistId = '37i9dQZF1DXcBWIGoYBM5M';
  const url = `https://open.spotify.com/playlist/${playlistId}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  console.log('Status:', res.status);
  const html = await res.text();
  console.log('HTML size:', html.length);
  const matches = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
  console.log('Script tags count:', matches.length);
  for (const m of matches) {
    if (m[1].includes('initial-state') || m[1].includes('Spotify.Entity') || m[1].includes('sessionData') || m[1].includes('accessToken')) {
      console.log('Found interesting script:', m[1].slice(0, 200));
    }
  }
}

testSpotifyPage().catch(console.error);
