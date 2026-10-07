async function testSpotifyScrapingMethods() {
  console.log('Testing Spotify GraphQL & Token methods...');
  
  // 1. Check if we can get a client_token from Spotify's clienttoken endpoint
  try {
    const clientTokenRes = await fetch('https://clienttoken.spotify.com/v1/clienttoken', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_data: {
          client_version: '1.2.32.100.g00000000',
          client_id: 'd8a5de95d3bc4da29ea3d307784d538f',
          js_sdk_data: {
            device_brand: 'unknown',
            device_model: 'unknown',
            os: 'linux',
            os_version: 'unknown'
          }
        }
      })
    });
    console.log('Client token status:', clientTokenRes.status);
    if (clientTokenRes.ok) {
      const data = await clientTokenRes.json();
      console.log('Client token response:', data);
    }
  } catch (e: any) {
    console.log('Client token error:', e.message);
  }

  // 2. Test Spotify web page scraping (open.spotify.com/playlist/...)
  try {
    const res = await fetch('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    console.log('Public playlist page status:', res.status);
    const html = await res.text();
    const scriptMatches = html.match(/<script type="application\/json" id="session">([^<]+)<\/script>/);
    if (scriptMatches) {
      console.log('Found session script:', scriptMatches[1].slice(0, 200));
    }
    const initialMatch = html.match(/<script id="initial-state" type="text\/plain">([^<]+)<\/script>/);
    if (initialMatch) {
      const decoded = Buffer.from(initialMatch[1], 'base64').toString('utf8');
      console.log('Found initial-state, length:', decoded.length);
      const parsed = JSON.parse(decoded);
      console.log('initial-state keys:', Object.keys(parsed));
    }
  } catch (e: any) {
    console.log('Public page error:', e.message);
  }
}

testSpotifyScrapingMethods().catch(console.error);
