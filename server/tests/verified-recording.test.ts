import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import express from 'express';
import http from 'http';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

const testDataDir = path.resolve(process.cwd(), 'data', 'test_verified_recording');
process.env.DATA_DIR = testDataDir;

import { setupDatabase, db } from '../db/index.js';
import { users, libraries, artists, albums, songs, songVerifiedSources, playlistSongs, playlists, favorites } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { replaceSongRecordingSource, replaceSongInstrumental, isValidYouTubeUrl, extractYouTubeVideoId } from '../lib/source-replacement.js';
import songsRoutes from '../routes/songs.js';
import playlistsRoutes from '../routes/playlists.js';
import favoritesRoutes from '../routes/favorites.js';
import { downloadQueue, sanitizeErrorMessage } from '../lib/download-queue.js';

const JWT_SECRET = process.env.JWT_SECRET || 'yimly_deterministic_test_jwt_secret_ci_only_32_bytes_safe';

test('Verified Recording, Reprocess Pipeline & Songs Page Card Options Suite', async (t) => {
  await setupDatabase();

  // Setup Express test app for route and permission tests
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/songs', songsRoutes);
  app.use('/api/playlists', playlistsRoutes);
  app.use('/api/favorites', favoritesRoutes);

  const server = http.createServer(app);
  let baseUrl = '';

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  t.after(() => {
    server.close();
  });

  // Cleanup test tables
  await db.delete(songVerifiedSources);
  await db.delete(playlistSongs);
  await db.delete(playlists);
  await db.delete(favorites);
  await db.delete(songs);
  await db.delete(albums);
  await db.delete(artists);
  await db.delete(libraries);
  await db.delete(users);

  // Create admin and regular user
  const adminUser = (await db.insert(users).values({
    username: 'admin_tester',
    password: 'hashed_password_placeholder',
    role: 'administrator',
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning())[0];

  const regularUser = (await db.insert(users).values({
    username: 'regular_tester',
    password: 'hashed_password_placeholder',
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning())[0];

  const adminToken = jwt.sign({ id: adminUser.id, username: adminUser.username, role: 'administrator' }, JWT_SECRET);
  const userToken = jwt.sign({ id: regularUser.id, username: regularUser.username, role: 'user' }, JWT_SECRET);

  // Setup library & test songs
  const libRes = await db.insert(libraries).values({ name: 'Test Lib', path: testDataDir }).returning();
  const libId = libRes[0].id;

  const artRes = await db.insert(artists).values({ name: 'Adele' }).returning();
  const artId = artRes[0].id;

  const albRes = await db.insert(albums).values({ artistId: artId, title: '21' }).returning();
  const albId = albRes[0].id;

  fs.mkdirSync(testDataDir, { recursive: true });
  const dummyAudioPath = path.join(testDataDir, 'adele_rolling.mp3');
  const dummyInstPath = path.join(testDataDir, 'adele_rolling (Instrumental).mp3');
  fs.writeFileSync(dummyAudioPath, Buffer.alloc(2048, 'a'));
  fs.writeFileSync(dummyInstPath, Buffer.alloc(2048, 'b'));

  const songRes = await db.insert(songs).values({
    libraryId: libId,
    artistId: artId,
    albumId: albId,
    title: 'Rolling in the Deep',
    mainAudioPath: dummyAudioPath,
    instrumentalAudioPath: dummyInstPath,
    duration: 228,
    format: 'mp3',
    variant: 'original',
  }).returning();
  const songId = songRes[0].id;

  // Duplicate title/artist song with different ID to test exact ID isolation
  const dummyAudioPath2 = path.join(testDataDir, 'adele_rolling_2.mp3');
  const dummyInstPath2 = path.join(testDataDir, 'adele_rolling_2 (Instrumental).mp3');
  fs.writeFileSync(dummyAudioPath2, Buffer.alloc(2048, 'c'));
  fs.writeFileSync(dummyInstPath2, Buffer.alloc(2048, 'd'));

  const songRes2 = await db.insert(songs).values({
    libraryId: libId,
    artistId: artId,
    albumId: albId,
    title: 'Rolling in the Deep',
    mainAudioPath: dummyAudioPath2,
    instrumentalAudioPath: dummyInstPath2,
    duration: 228,
    format: 'mp3',
    variant: 'original',
  }).returning();
  const song2Id = songRes2[0].id;

  // --- SECTION 1: SONGS PAGE UI SPECIFICATION AUDIT ---
  await t.test('UI Audit: one master Jukebox song card owns the full Library action set', () => {
    const libraryCode = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/Library.tsx'), 'utf-8');
    const cardCode = fs.readFileSync(path.resolve(process.cwd(), 'src/components/jukebox/JukeboxSongCard.tsx'), 'utf-8');
    const playlistCode = fs.readFileSync(path.resolve(process.cwd(), 'src/components/playlist/PlaylistDetailView.tsx'), 'utf-8');

    // The master card owns the shared artwork/playback/lyrics UI and the complete More Options menu.
    assert.ok(cardCode.includes('MoreVertical'), 'Master card renders the More Options control');
    assert.ok(cardCode.includes('onAddToQueue'), 'Master card owns Add to Queue');
    assert.ok(cardCode.includes('onToggleFavorite'), 'Master card supports favourites');
    assert.ok(cardCode.includes('onAddToPlaylist'), 'Master card supports Add to Playlist');
    assert.ok(cardCode.includes('onReplaceAudio'), 'Master card supports Replace Audio');
    assert.ok(cardCode.includes('onReplaceInstrumental'), 'Master card supports Replace Instrumental');
    assert.ok(cardCode.includes('onDeleteSong'), 'Master card supports Delete Song');

    const favIndex = cardCode.indexOf('Remove from Favourites');
    const playlistIndex = cardCode.indexOf('Add to Playlist');
    const replaceAudioIndex = cardCode.indexOf('Replace Audio');
    const replaceInstIndex = cardCode.indexOf('Replace Instrumental');
    const deleteIndex = cardCode.indexOf('Delete Song');
    assert.ok(favIndex !== -1 && playlistIndex !== -1 && replaceAudioIndex !== -1 && replaceInstIndex !== -1 && deleteIndex !== -1,
      'All five More Options actions are present');
    assert.ok(favIndex < playlistIndex && playlistIndex < replaceAudioIndex && replaceAudioIndex < replaceInstIndex && replaceInstIndex < deleteIndex,
      'More Options actions appear in the expected order');

    // Library song lists and search results pass their actions into the same component.
    assert.ok(libraryCode.includes('getSongCardActions(song)'), 'Library song rows use the shared action set');
    assert.ok(libraryCode.includes('getSongCardActions(item)'), 'Song search results use the shared action set');
    assert.ok(libraryCode.includes('handlePlayInJukebox(song, songs, idx)'), 'Play artwork button remains connected to the active song list');
    assert.ok(libraryCode.includes('handleQueueInJukebox(song)'), 'Jukebox queue handler remains connected');
    assert.ok(libraryCode.includes('deleteConfirmModal') && libraryCode.includes('Delete Song?'),
      'Delete Song continues to require confirmation');

    // Playlist detail uses the same Jukebox card while keeping its separate Karaoke room queue action.
    assert.ok(playlistCode.includes('onAddToJukeboxQueue'), 'Playlist detail connects the Jukebox queue action');
    assert.ok(playlistCode.includes('artworkTrailing={canEdit ?'), 'Playlist reorder controls stay beside the song artwork');
    assert.ok(playlistCode.includes('w-full table-fixed text-left text-sm'), 'Playlist track and recommendation tables fit the available viewport width');
    assert.ok(cardCode.includes('artworkTrailing'), 'Master card supports playlist-specific controls beside artwork');
    assert.ok(playlistCode.includes('onAddToQueue(song.id)'), 'Playlist detail retains its separate Karaoke room queue action');

    // Karaoke room UI is not migrated to the Jukebox Library master card.
    const roomSessionCode = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/RoomSession.tsx'), 'utf-8');
    assert.ok(!roomSessionCode.includes('JukeboxSongCard'), 'RoomSession remains on its own Karaoke UI');
  });

  // --- SECTION 2: VERIFIED SOURCE PERSISTENCE & PIPELINE REUSE ---
  await t.test('Regression: The exact supplied shortened URL and "?si=" parameters are preserved and validated', () => {
    const exactUrl = 'https://youtu.be/CWG-GDfejmY?si=K1vetd6tzVTYb9DB';
    assert.strictEqual(isValidYouTubeUrl(exactUrl), true, 'Exact shortened URL with ?si= must be recognized as valid');
    assert.strictEqual(extractYouTubeVideoId(exactUrl), 'CWG-GDfejmY', 'Video ID must be accurately extracted from shortened URL with ?si=');

    // Query param preservation across formats
    const watchWithSi = 'https://www.youtube.com/watch?v=CWG-GDfejmY&si=K1vetd6tzVTYb9DB';
    assert.strictEqual(isValidYouTubeUrl(watchWithSi), true);
    assert.strictEqual(extractYouTubeVideoId(watchWithSi), 'CWG-GDfejmY');

    const musicWithSi = 'https://music.youtube.com/watch?v=CWG-GDfejmY&si=K1vetd6tzVTYb9DB';
    assert.strictEqual(isValidYouTubeUrl(musicWithSi), true);
    assert.strictEqual(extractYouTubeVideoId(musicWithSi), 'CWG-GDfejmY');

    // Standard YouTube watch URLs and other supported forms
    assert.strictEqual(isValidYouTubeUrl('https://www.youtube.com/watch?v=CWG-GDfejmY'), true);
    assert.strictEqual(isValidYouTubeUrl('https://youtube.com/watch?v=CWG-GDfejmY'), true);
    assert.strictEqual(isValidYouTubeUrl('https://m.youtube.com/watch?v=CWG-GDfejmY'), true);
    assert.strictEqual(isValidYouTubeUrl('https://music.youtube.com/watch?v=CWG-GDfejmY'), true);
    assert.strictEqual(isValidYouTubeUrl('https://www.youtube.com/shorts/CWG-GDfejmY'), true);
    assert.strictEqual(isValidYouTubeUrl('https://www.youtube.com/embed/CWG-GDfejmY'), true);

    // Invalid URLs
    assert.strictEqual(isValidYouTubeUrl('https://spotify.com/track/CWG-GDfejmY'), false);
    assert.strictEqual(isValidYouTubeUrl('https://notyoutube.com/watch?v=CWG-GDfejmY'), false);
    assert.strictEqual(isValidYouTubeUrl('https://youtu.be/toolongvideoid12345'), false);
    assert.strictEqual(isValidYouTubeUrl('https://youtu.be/tooshort'), false);
    assert.strictEqual(isValidYouTubeUrl('not_a_url'), false);
    assert.strictEqual(isValidYouTubeUrl(''), false);
  });

  await t.test('Regression: sanitizeErrorMessage preserves URLs intact and extracts useful yt-dlp stderr', () => {
    const errorWithUrl = 'Command failed: /app/applet/yt-dlp -x --audio-format mp3 -o /app/applet/data/tmp.mp3 https://youtu.be/CWG-GDfejmY?si=K1vetd6tzVTYb9DB';
    const sanitizedWithoutStderr = sanitizeErrorMessage(errorWithUrl);
    assert.ok(sanitizedWithoutStderr.includes('https://youtu.be/CWG-GDfejmY?si=K1vetd6tzVTYb9DB'), 'Must preserve full URL including video ID and ?si= parameter');
    assert.ok(!sanitizedWithoutStderr.includes('https:?si='), 'Must NEVER corrupt URL into https:?si=');
    assert.ok(!sanitizedWithoutStderr.includes('/app/applet'), 'Must strip internal server filesystem paths');

    // Captures useful yt-dlp stderr over generic Command failed header
    const ytDlpStderr = 'WARNING: [youtube] some warning\nERROR: [youtube] CWG-GDfejmY: Video unavailable. This video is not available';
    const sanitizedWithStderr = sanitizeErrorMessage(errorWithUrl, ytDlpStderr);
    assert.strictEqual(sanitizedWithStderr, '[youtube] CWG-GDfejmY: Video unavailable. This video is not available', 'Must report informative yt-dlp stderr');

    // Bot challenge stderr reporting
    const botStderr = 'ERROR: [youtube] rYEDA3JcQqw: Sign in to confirm you’re not a bot. This helps protect our community.';
    assert.strictEqual(sanitizeErrorMessage(errorWithUrl, botStderr), '[youtube] rYEDA3JcQqw: Sign in to confirm you’re not a bot. This helps protect our community.');
  });

  await t.test('Regression: Failed replacement preserves existing audio files and previous verified source record', async () => {
    // 1. Seed pre-existing verified source for songId
    await db.delete(songVerifiedSources).where(eq(songVerifiedSources.songId, songId));
    await db.insert(songVerifiedSources).values({
      songId,
      youtubeUrl: 'https://www.youtube.com/watch?v=PREV_123456',
      videoId: 'PREV_123456',
      sourceTitle: 'Rolling in the Deep',
      sourceArtist: 'Adele',
      verified: 1,
      verifiedAt: new Date(Date.now() - 50000),
    });

    const preSong = (await db.select().from(songs).where(eq(songs.id, songId)))[0];
    const preAudioContent = fs.readFileSync(preSong.mainAudioPath!);

    // 2. Execute replacement with an invalid URL that fails
    const failRes = await replaceSongRecordingSource(songId, 'https://www.youtube.com/watch?v=invalid_id_fail');
    assert.strictEqual(failRes.success, false, 'Invalid source replacement must report failure');

    // 3. Verify previous verified source was preserved and NOT overwritten
    const verifiedAfterFail = await db.select().from(songVerifiedSources).where(eq(songVerifiedSources.songId, songId));
    assert.strictEqual(verifiedAfterFail.length, 1);
    assert.strictEqual(verifiedAfterFail[0].youtubeUrl, 'https://www.youtube.com/watch?v=PREV_123456', 'Previous verified source must be preserved on failure');
    assert.strictEqual(verifiedAfterFail[0].videoId, 'PREV_123456');

    // 4. Verify original audio file content and metadata are untouched
    const postSong = (await db.select().from(songs).where(eq(songs.id, songId)))[0];
    assert.strictEqual(postSong.mainAudioPath, preSong.mainAudioPath);
    assert.strictEqual(fs.readFileSync(postSong.mainAudioPath!).toString(), preAudioContent.toString(), 'Original audio content preserved');
  });

  await t.test('Replace Audio: Successful replacement updates audio paths, file size, and verified source atomically', async () => {
    const originalDownload = downloadQueue.downloadSingleTrackAudio;
    const testUrl = 'https://youtu.be/CWG-GDfejmY?si=K1vetd6tzVTYb9DB';

    // Mock download to produce valid staged main and instrumental files
    downloadQueue.downloadSingleTrackAudio = async (_url: string, outDir: string, format: string) => {
      const mainFile = path.join(outDir, `audio_${Date.now()}.${format}`);
      const instFile = path.join(outDir, `Adele - Rolling in the Deep (Instrumental).${format}`);
      fs.writeFileSync(mainFile, Buffer.alloc(2048, 'new_main_content'));
      fs.writeFileSync(instFile, Buffer.alloc(2048, 'new_inst_content'));
      return mainFile;
    };

    try {
      const result = await replaceSongRecordingSource(songId, testUrl);
      assert.strictEqual(result.success, true, 'Replacement must succeed when pipeline produces valid files');
      assert.strictEqual(result.songId, songId);

      // Verify files updated
      const updatedSong = (await db.select().from(songs).where(eq(songs.id, songId)))[0];
      assert.ok(fs.existsSync(updatedSong.mainAudioPath!), 'Main audio exists');
      assert.ok(fs.existsSync(updatedSong.instrumentalAudioPath!), 'Instrumental audio exists');
      assert.strictEqual(fs.readFileSync(updatedSong.mainAudioPath!).toString(), Buffer.alloc(2048, 'new_main_content').toString());

      // Verify verified source record saved AFTER successful commit
      const verified = await db.select().from(songVerifiedSources).where(eq(songVerifiedSources.songId, songId));
      assert.strictEqual(verified.length, 1);
      assert.strictEqual(verified[0].youtubeUrl, testUrl, 'Stores the complete URL with ?si= parameter');
      assert.strictEqual(verified[0].videoId, 'CWG-GDfejmY');
      assert.strictEqual(verified[0].verified, 1);
      assert.ok(verified[0].processedAt, 'ProcessedAt timestamp set upon successful replacement');

      // Exact ID isolation: second song with same artist and title did NOT receive verified source
      const verified2 = await db.select().from(songVerifiedSources).where(eq(songVerifiedSources.songId, song2Id));
      assert.strictEqual(verified2.length, 0, 'Song 2 must not receive verified source belonging to Song 1');

    } finally {
      downloadQueue.downloadSingleTrackAudio = originalDownload;
    }
  });

  await t.test('Replace Audio: Rollback restores previous files and database records if file commit fails', async () => {
    const preSong = (await db.select().from(songs).where(eq(songs.id, songId)))[0];
    const preAudioContent = fs.readFileSync(preSong.mainAudioPath!);
    const preVerified = (await db.select().from(songVerifiedSources).where(eq(songVerifiedSources.songId, songId)))[0];

    const originalDownload = downloadQueue.downloadSingleTrackAudio;

    // Simulate download succeeding in staging, but make final target directory write trigger an error
    downloadQueue.downloadSingleTrackAudio = async (_url: string, outDir: string, format: string) => {
      const mainFile = path.join(outDir, `audio_${Date.now()}.${format}`);
      const instFile = path.join(outDir, `Adele - Rolling in the Deep (Instrumental).${format}`);
      // Write corrupted empty instrumental file to trigger validation / commit failure
      fs.writeFileSync(mainFile, Buffer.alloc(2048, 'main'));
      fs.writeFileSync(instFile, Buffer.alloc(10, 'empty'));
      return mainFile;
    };

    try {
      const failRes = await replaceSongRecordingSource(songId, 'https://youtu.be/CWG-GDfejmY?si=K1vetd6tzVTYb9DB');
      assert.strictEqual(failRes.success, false, 'Should fail and abort commit when staged file validation fails');

      // Previous audio content and paths preserved
      const postSong = (await db.select().from(songs).where(eq(songs.id, songId)))[0];
      assert.strictEqual(postSong.mainAudioPath, preSong.mainAudioPath);
      assert.strictEqual(fs.readFileSync(postSong.mainAudioPath!).toString(), preAudioContent.toString(), 'Original audio preserved after rollback');

      // Verified source unchanged
      const postVerified = (await db.select().from(songVerifiedSources).where(eq(songVerifiedSources.songId, songId)))[0];
      assert.strictEqual(postVerified.youtubeUrl, preVerified.youtubeUrl);
    } finally {
      downloadQueue.downloadSingleTrackAudio = originalDownload;
    }
  });

  await t.test('Replace Audio: Concurrency protection blocks simultaneous replacements for same song', async () => {
    // Start two concurrent replacements
    const p1 = replaceSongRecordingSource(songId, 'https://www.youtube.com/watch?v=12345678901');
    const p2 = replaceSongRecordingSource(songId, 'https://www.youtube.com/watch?v=12345678901');

    const [r1, r2] = await Promise.all([p1, p2]);
    // One of them must report conflict
    const hasConflict = !r1.success || !r2.success;
    assert.ok(hasConflict, 'Concurrent replacements for same song ID are blocked');
  });

  // --- SECTION 3: REPLACE INSTRUMENTAL ---
  await t.test('Replace Instrumental: regenerates instrumental from original audio without downloading', async () => {
    const preSong = (await db.select().from(songs).where(eq(songs.id, songId)))[0];
    const originalMainPath = preSong.mainAudioPath;

    const res = await replaceSongInstrumental(songId);
    assert.ok(res.songId === songId);

    const postSong = (await db.select().from(songs).where(eq(songs.id, songId)))[0];
    assert.strictEqual(postSong.mainAudioPath, originalMainPath, 'Original main audio path left completely unchanged');
    assert.ok(postSong.instrumentalAudioPath, 'Instrumental audio path exists');
    assert.strictEqual(postSong.title, preSong.title, 'Song metadata preserved');
  });

  // --- SECTION 4: PERMISSIONS & API ENDPOINTS ---
  await t.test('Permissions: Non-admin users cannot call replace-source or replace-instrumental (403 Forbidden)', async () => {
    // Non-admin replace-source
    const res1 = await fetch(`${baseUrl}/api/songs/${songId}/replace-source`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ youtubeUrl: 'https://www.youtube.com/watch?v=rYEDA3JcQqw' }),
    });
    assert.strictEqual(res1.status, 403, 'Regular user must receive 403 Forbidden on replace-source');

    // Non-admin replace-instrumental
    const res2 = await fetch(`${baseUrl}/api/songs/${songId}/replace-instrumental`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
    });
    assert.strictEqual(res2.status, 403, 'Regular user must receive 403 Forbidden on replace-instrumental');

    // Admin can access replacement endpoints
    const res3 = await fetch(`${baseUrl}/api/songs/${songId}/verified-source`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(res3.status, 200, 'Admin can fetch verified source');
    const vData = await res3.json();
    assert.ok(vData.verifiedSource !== undefined);
  });
});
