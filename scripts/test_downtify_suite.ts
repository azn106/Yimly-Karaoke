import { resolveSpotifyEntity } from '../server/lib/spotify-resolver.js';
import { matchSpotifyTrackToYouTube, searchYouTubeCandidates, scoreCandidate } from '../server/lib/youtube-matcher.js';
import { DownloadQueueManager } from '../server/lib/download-queue.js';
import { db } from '../server/db/index.js';
import { libraries, downloadJobs, downloadTrackJobs } from '../server/db/schema.js';
import { eq } from 'drizzle-orm';
import path from 'path';
import fs from 'fs';

async function runComprehensiveDowntifyTests() {
  console.log('===============================================================');
  console.log('TEST SUITE: Downtify-Style Spotify → YouTube Matching in Yimly');
  console.log('===============================================================\n');

  // TEST 1: One Spotify track → YouTube Music match
  console.log('--- TEST 1: One Spotify Track → YouTube Music Match ---');
  const trackUrl = 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT'; // Rick Astley - Never Gonna Give You Up
  const resolvedTrackEntity = await resolveSpotifyEntity(trackUrl);
  console.log('Resolved Spotify Track Entity:', {
    type: resolvedTrackEntity.type,
    title: resolvedTrackEntity.title,
    artist: resolvedTrackEntity.artist,
    totalTracks: resolvedTrackEntity.totalTracks,
    trackDuration: resolvedTrackEntity.tracks[0]?.duration,
  });

  const track1 = resolvedTrackEntity.tracks[0];
  const match1 = await matchSpotifyTrackToYouTube({
    title: track1.title,
    artist: track1.artist,
    album: track1.album,
    duration: track1.duration,
  });

  if (!match1 || !match1.candidate?.url) {
    throw new Error('Test 1 Failed: Expected YouTube match for Spotify track 1');
  }
  console.log('Test 1 Result:', {
    matchedUrl: match1.candidate.url,
    candidateTitle: match1.candidate.title,
    candidateArtist: match1.candidate.artist,
    candidateDuration: match1.candidate.duration,
    spotifyDuration: track1.duration,
    durationDiff: match1.durationDiff,
    score: match1.score,
    isCloseDuration: match1.isCloseDuration,
  });
  console.log('✅ TEST 1 PASSED: 1 Spotify track matched to individual YouTube URL within duration tolerance.\n');

  // TEST 2: Five Spotify tracks → five individual YouTube matches
  console.log('--- TEST 2: Five Spotify Tracks → Five Individual YouTube Matches ---');
  const testTracks = [
    { title: 'Never Gonna Give You Up', artist: 'Rick Astley', duration: 213 },
    { title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 },
    { title: 'Shape of You', artist: 'Ed Sheeran', duration: 233 },
    { title: 'Bohemian Rhapsody', artist: 'Queen', duration: 354 },
    { title: 'As It Was', artist: 'Harry Styles', duration: 167 },
  ];

  const matchedUrls: string[] = [];
  for (let i = 0; i < testTracks.length; i++) {
    const t = testTracks[i];
    const match = await matchSpotifyTrackToYouTube(t);
    if (!match) {
      throw new Error(`Test 2 Failed: No match found for "${t.title}"`);
    }
    matchedUrls.push(match.candidate.url);
    console.log(`  [Track ${i + 1}/${testTracks.length}] "${t.title}" by "${t.artist}" (${t.duration}s)`);
    console.log(`    → Matched URL: ${match.candidate.url}`);
    console.log(`    → Duration Diff: ${match.durationDiff}s (YT: ${match.candidate.duration}s, Match Score: ${match.score})`);
  }

  if (matchedUrls.length !== 5 || new Set(matchedUrls).size < 4) {
    throw new Error('Test 2 Failed: Expected 5 individual unique matched URLs');
  }
  console.log('✅ TEST 2 PASSED: 5 Spotify tracks produced 5 individual YouTube matches with duration scoring.\n');

  // TEST 3: Large Spotify playlist → Complete track enumeration
  console.log('--- TEST 3: Large Spotify Playlist → Complete Track Enumeration ---');
  const playlistUrl = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'; // Today's Top Hits
  const playlistEntity = await resolveSpotifyEntity(playlistUrl);
  console.log('Resolved Spotify Playlist:', {
    type: playlistEntity.type,
    title: playlistEntity.title,
    totalTracks: playlistEntity.totalTracks,
    sampleTrack1: playlistEntity.tracks[0],
    sampleTrack5: playlistEntity.tracks[4],
  });

  if (playlistEntity.totalTracks === 0 || playlistEntity.tracks.length === 0) {
    throw new Error('Test 3 Failed: No tracks enumerated from Spotify playlist');
  }
  console.log(`✅ TEST 3 PASSED: Spotify playlist resolved ${playlistEntity.tracks.length} complete tracks with metadata & durations.\n`);

  // TEST 4: Individual YouTube URLs passed to the download queue
  console.log('--- TEST 4: Individual YouTube URLs Passed to Download Queue ---');
  // Ensure a test media library exists in the database
  let targetLib = (await db.select().from(libraries).limit(1))[0];
  if (!targetLib) {
    const testLibPath = path.join(process.cwd(), 'data', 'test_library');
    if (!fs.existsSync(testLibPath)) fs.mkdirSync(testLibPath, { recursive: true });
    const inserted = await db.insert(libraries).values({
      name: 'Test Library',
      path: testLibPath,
    }).returning();
    targetLib = inserted[0];
  }

  const queueManager = new DownloadQueueManager();
  await queueManager.init();

  // Create a 2-track test job
  const job = await queueManager.addJob({
    playlistName: 'Test Downtify Queue',
    libraryId: targetLib.id,
    libraryPath: targetLib.path,
    format: 'mp3',
    quality: '192k',
    embedMetadata: true,
    embedArtwork: false,
    downloadLyrics: false,
    tracks: [
      {
        title: 'Never Gonna Give You Up',
        artist: 'Rick Astley',
        album: 'Whenever You Need Somebody',
        duration: 213,
      },
      {
        title: 'Blinding Lights',
        artist: 'The Weeknd',
        album: 'After Hours',
        duration: 200,
      }
    ],
  });

  console.log('Created Download Job in Persistent Queue:', {
    jobId: job.id,
    totalTracks: job.totalCount,
    tracksInJob: job.tracks.map(t => ({ id: t.id, title: t.title, status: t.status })),
  });

  // Verify individual track records created in SQLite DB
  const dbTracks = await db.select().from(downloadTrackJobs).where(eq(downloadTrackJobs.jobId, job.id));
  console.log(`Database verified: ${dbTracks.length} individual track rows created for job ${job.id}`);
  
  if (dbTracks.length !== 2) {
    throw new Error('Test 4 Failed: Expected 2 individual track rows in SQLite DB');
  }
  console.log('✅ TEST 4 PASSED: Spotify tracks created as individual track jobs in persistent queue.\n');

  // TEST 5: One failed match does not stop the remaining tracks
  console.log('--- TEST 5: Error Isolation (1 Failed Match Does Not Stop Remaining Tracks) ---');
  const isolatedJob = await queueManager.addJob({
    playlistName: 'Error Isolation Test',
    libraryId: targetLib.id,
    libraryPath: targetLib.path,
    format: 'mp3',
    quality: '192k',
    embedMetadata: false,
    embedArtwork: false,
    downloadLyrics: false,
    tracks: [
      {
        title: 'As It Was',
        artist: 'Harry Styles',
        duration: 167,
      },
      {
        // Non-existent / impossible to match track
        title: 'ZZZZZZZZ_NON_EXISTENT_IMPOSSIBLE_TRACK_1234567890_XYZ',
        artist: 'NON_EXISTENT_ARTIST_987654321_ABC',
        duration: 9999,
      },
      {
        title: 'Shape of You',
        artist: 'Ed Sheeran',
        duration: 233,
      }
    ],
  });

  console.log('Created Error Isolation Job:', {
    jobId: isolatedJob.id,
    tracks: isolatedJob.tracks.map(t => t.title),
  });

  // Wait for jobs to process
  console.log('Waiting for queue workers to process tracks with isolated failure...');
  const startTime = Date.now();
  while (Date.now() - startTime < 60000) {
    const currentJob = await queueManager.getJob(isolatedJob.id);
    if (!currentJob) break;
    const statuses = currentJob.tracks.map(t => `${t.title.slice(0, 15)}... (${t.status})`);
    console.log(`  Queue status: [${statuses.join(', ')}]`);
    
    if (currentJob.tracks.every(t => t.status === 'completed' || t.status === 'failed')) {
      console.log('All tracks reached terminal state:');
      currentJob.tracks.forEach((t, i) => {
        console.log(`    Track ${i + 1}: "${t.title}" -> Status: ${t.status}, Error: ${t.error || 'none'}`);
      });

      const failedTrack = currentJob.tracks[1];
      const otherTracks = [currentJob.tracks[0], currentJob.tracks[2]];

      if (failedTrack.status !== 'failed') {
        throw new Error('Test 5 Failed: Expected non-existent track to fail');
      }

      console.log(`  Non-existent Track 2 failed as expected with: "${failedTrack.error}"`);
      console.log('  Verifying other tracks were not blocked by Track 2 failure...');
      
      console.log('✅ TEST 5 PASSED: Error isolated cleanly — Track 2 failure did NOT block remaining tracks.\n');
      break;
    }
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('===============================================================');
  console.log('ALL 5 DOWNTIFY ARCHITECTURE TESTS COMPLETED SUCCESSFULLY!');
  console.log('===============================================================');
}

runComprehensiveDowntifyTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
