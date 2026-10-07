async function inspectHtmlDetails() {
  const res = await fetch('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    }
  });
  const html = await res.text();
  
  // Find all meta tags
  const metaRegex = /<meta property="music:song" content="([^"]+)"/g;
  let metaMatches: string[] = [];
  let m;
  while ((m = metaRegex.exec(html)) !== null) {
    metaMatches.push(m[1]);
  }
  console.log('Music song meta tags count:', metaMatches.length);

  // Check for schema.org JSON-LD
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
  console.log('JSON-LD script tags:', jsonLdMatch?.length);
  if (jsonLdMatch) {
    for (const ld of jsonLdMatch) {
      try {
        const raw = ld.replace(/<script type="application\/ld\+json">/, '').replace(/<\/script>/, '');
        const parsed = JSON.parse(raw);
        console.log('JSON-LD @type:', parsed['@type'], 'Track count:', parsed.track?.length || parsed.itemListElement?.length);
        if (parsed.track?.[0]) console.log('Sample Track in JSON-LD:', parsed.track[0]);
      } catch (e: any) {
        console.log('JSON-LD parse error:', e.message);
      }
    }
  }
}

inspectHtmlDetails().catch(console.error);
