async function testAlbumSources() {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  };
  const albumUrl = 'https://open.spotify.com/album/4LH4d3cOWNNXdURXd407Pt';

  // 1. oEmbed
  const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(albumUrl)}`);
  if (oembedRes.ok) {
    const oembed = await oembedRes.json();
    console.log('oEmbed title:', oembed.title, 'thumbnail:', oembed.thumbnail_url);
  }

  // 2. Open Spotify web page (open.spotify.com/album/...)
  const res = await fetch(albumUrl, { headers });
  const html = await res.text();
  console.log('Album web page length:', html.length);
  
  // Look for JSON or schema in html
  const scriptTags = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g);
  for (const s of scriptTags || []) {
    if (s.includes('album') && s.includes('track') && s.length > 500) {
      console.log('Script snippet (length ' + s.length + '):', s.slice(0, 300));
    }
  }

  // 3. iTunes Search for album tracks (Clean, official & rich metadata)
  const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent('4LH4d3cOWNNXdURXd407Pt')}&entity=album`);
  console.log('iTunes direct status:', itunesRes.status);
}

testAlbumSources().catch(console.error);
