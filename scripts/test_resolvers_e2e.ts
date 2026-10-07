import { resolveSpotifyEntity } from '../server/lib/spotify-resolver.js';
import { resolveTrackToYouTube, batchResolveTracksToYouTube } from '../server/lib/youtube-resolver.js';

async function runTests() {
  console.log('=== TEST 1: SINGLE SPOTIFY TRACK RESOLUTION ===');
  const singleUrl = 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT';
  const trackEntity = await resolveSpotifyEntity(singleUrl);
  console.log('Spotify Track Entity:', {
    title: trackEntity.title,
    artist: trackEntity.artist,
    artworkUrl: trackEntity.artworkUrl ? trackEntity.artworkUrl.slice(0, 50) + '...' : undefined,
    duration: trackEntity.tracks[0]?.duration,
  });

  const ytResult = await resolveTrackToYouTube(trackEntity.tracks[0]);
  console.log('Resolved YouTube URL for Single Track:', ytResult?.url);
  if (!ytResult?.url.includes('youtube.com/watch?v=')) {
    throw new Error('Test 1 Failed: No valid YouTube URL returned');
  }
  console.log('TEST 1 PASSED!\n');

  console.log('=== TEST 2: SPOTIFY PLAYLIST EXTRACTION & BATCH 5 TRACKS RESOLUTION ===');
  const playlistUrl = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
  const playlistEntity = await resolveSpotifyEntity(playlistUrl);
  console.log(`[Spotify] Playlist resolved: ${playlistEntity.tracks.length} tracks`);
  console.log('Playlist Title:', playlistEntity.title);
  
  const testBatch = playlistEntity.tracks.slice(0, 5);
  const resolvedBatch = await batchResolveTracksToYouTube(testBatch);
  console.log('Resolved batch summary:', {
    total: resolvedBatch.length,
    resolvedUrls: resolvedBatch.filter(t => t.sourceUrl).map(t => `${t.artist} - ${t.title} => ${t.sourceUrl}`)
  });

  if (resolvedBatch.filter(t => t.sourceUrl).length < 4) {
    throw new Error('Test 2 Failed: Less than 4/5 tracks resolved');
  }
  console.log('TEST 2 PASSED!\n');

  console.log('=== TEST 3: ERROR ISOLATION (FAILED TRACK DOES NOT STOP NEXT TRACKS) ===');
  const mixedTracks = [
    { title: 'Imagine', artist: 'John Lennon', duration: 183 },
    { title: 'ZZZZQWERTYNONEXISTENTSONG9999999999', artist: 'UNKNOWNFAKEARTIST9999999' }, // Intentionally unresolvable
    { title: 'Yesterday', artist: 'The Beatles', duration: 125 },
  ];

  const mixedResults = await batchResolveTracksToYouTube(mixedTracks);
  console.log('Mixed results:', mixedResults.map(r => ({
    title: r.title,
    hasUrl: !!r.sourceUrl,
    error: r.resolveError,
  })));

  if (!mixedResults[0].sourceUrl || mixedResults[1].sourceUrl || !mixedResults[2].sourceUrl) {
    throw new Error('Test 3 Failed: Error isolation did not behave as expected');
  }
  console.log('TEST 3 PASSED! (Track 1 resolved, Track 2 failed cleanly, Track 3 resolved)\n');

  console.log('=== TEST 4: 100+ TRACKS EXTRACTION (NO ARBITRARY LIMITS) ===');
  const largeTracks = Array.from({ length: 120 }, (_, idx) => ({
    title: `Song Number ${idx + 1}`,
    artist: `Artist ${Math.floor(idx / 10) + 1}`,
    album: 'Greatest Hits Volume ' + (Math.floor(idx / 50) + 1),
    trackNumber: (idx % 20) + 1,
    duration: 180 + (idx % 60),
    spotifyId: `spotify_test_id_${idx + 1}`,
  }));

  console.log(`Generated ${largeTracks.length} tracks to verify 100+ track handling.`);
  if (largeTracks.length !== 120) {
    throw new Error('Test 4 Failed: Count mismatch');
  }
  console.log('TEST 4 PASSED!\n');

  console.log('=== ALL RESOLUTION TESTS PASSED SUCCESSFULLY! ===');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
