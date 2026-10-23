async function listScripts() {
  const playlistId = '37i9dQZF1DXcBWIGoYBM5M';
  const url = `https://open.spotify.com/playlist/${playlistId}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });

  const html = await res.text();
  const scriptRegex = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const attrs = match[1];
    const content = match[2];
    console.log('Script attrs:', attrs, 'Content length:', content.length, 'Preview:', content.slice(0, 100));
  }
}

listScripts().catch(console.error);
