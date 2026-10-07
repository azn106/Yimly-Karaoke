async function inspectSpotifyHtml() {
  const res = await fetch('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    }
  });
  const html = await res.text();
  console.log('HTML Length:', html.length);
  
  // Find all <script tags
  const regex = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const attrs = match[1];
    const body = match[2];
    if (attrs.includes('json') || body.includes('items') || body.includes('tracks') || body.includes('accessToken')) {
      console.log('Script tag attrs:', attrs, 'Body length:', body.length, 'Snippet:', body.slice(0, 300));
    }
  }
}

inspectSpotifyHtml().catch(console.error);
