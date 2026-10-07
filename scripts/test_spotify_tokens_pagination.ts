async function testSpotifyTokensAndPagination() {
  console.log('Testing Spotify Client IDs & Tokens...');

  // Test various known web client IDs
  const clientIds = [
    '279eb308b93d40909bd533261765c917',
    'd8a5de95d3bc4da29ea3d307784d538f',
    'a53696fbef304e2eb27ef80572d4c062',
    '088d8b13d42e47e3a24177c8e96bf353'
  ];

  for (const cid of clientIds) {
    try {
      const res = await fetch(`https://accounts.spotify.com/api/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: cid,
        })
      });
      console.log(`Client ID ${cid} token status:`, res.status);
      if (res.ok) {
        const d = await res.json();
        console.log(`Client ID ${cid} SUCCESS! Token:`, d.access_token?.slice(0, 15) + '...');
      }
    } catch (e: any) {
      console.log(`Client ID ${cid} error:`, e.message);
    }
  }
}

testSpotifyTokensAndPagination().catch(console.error);
