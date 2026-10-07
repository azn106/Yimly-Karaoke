async function inspectAppServerConfig() {
  const playlistId = '37i9dQZF1DXcBWIGoYBM5M';
  const url = `https://open.spotify.com/playlist/${playlistId}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  const html = await res.text();
  const m = html.match(/id="appServerConfig" type="text\/plain">([^<]+)<\/script>/);
  if (m) {
    const jsonStr = Buffer.from(m[1], 'base64').toString('utf-8');
    const config = JSON.parse(jsonStr);
    console.log('appServerConfig keys:', Object.keys(config));
    console.log('Client token/auth:', config.session, config.accessToken, config.clientVersion);
  }
}

inspectAppServerConfig().catch(console.error);
