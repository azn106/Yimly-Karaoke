async function testAlbumEmbed() {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  };
  const albumRes = await fetch('https://open.spotify.com/embed/album/4LH4d3cOWNNXdURXd407Pt', { headers });
  const albumHtml = await albumRes.text();
  const albumMatch = albumHtml.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
  if (albumMatch) {
    const aData = JSON.parse(albumMatch[1]);
    console.log('Album data structure:', Object.keys(aData.props?.pageProps || {}));
    console.log('state.data:', aData.props?.pageProps?.state?.data);
  }
}
testAlbumEmbed().catch(console.error);
