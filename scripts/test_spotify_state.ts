async function inspectSpotifyHtml() {
  const playlistId = '37i9dQZF1DXcBWIGoYBM5M';
  const url = `https://open.spotify.com/playlist/${playlistId}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  const html = await res.text();
  const sessionMatch = html.match(/<script id="session" type="application\/json">([^<]+)<\/script>/);
  if (sessionMatch) {
    console.log('Found session script:', sessionMatch[1]);
  }
  const initMatch = html.match(/<script id="initial-state" type="text\/plain">([^<]+)<\/script>/);
  if (initMatch) {
    console.log('Found initial-state script!');
    const buf = Buffer.from(initMatch[1], 'base64').toString('utf-8');
    const state = JSON.parse(buf);
    console.log('State top keys:', Object.keys(state));
    if (state.entities?.items) {
      console.log('Entities items count:', Object.keys(state.entities.items).length);
      const firstKey = Object.keys(state.entities.items)[0];
      console.log('Sample entity item:', state.entities.items[firstKey]);
    }
  }
}

inspectSpotifyHtml().catch(console.error);
