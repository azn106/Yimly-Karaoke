import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as mm from 'music-metadata';

const execFileAsync = promisify(execFile);

const testDataDir = path.resolve(process.cwd(), 'data', 'test_shared_inst_pipeline');
process.env.DATA_DIR = testDataDir;

import { setupDatabase, db } from '../db/index.js';
import {
  users,
  sessions,
  libraries,
  artists,
  albums,
  songs,
  songArtists,
  songVerifiedSources,
  playlistSongs,
  playlists,
  favorites,
  lyrics,
  queueItems,
} from '../db/schema.js';
import { eq } from 'drizzle-orm';
import {
  audioSeparationHooks,
  verifyValidMp3File,
} from '../lib/audio-separation.js';
import { demucsWorkerManager } from '../lib/demucs-worker.js';
import {
  generateInstrumentalFromOriginal,
  installInstrumentalForSong,
  resolveCanonicalInstrumentalPath,
} from '../lib/instrumental-pipeline.js';
import { processDownloadedSong } from '../lib/song-processor.js';
import { ProcessingQueueManager } from '../lib/processing-queue.js';
import {
  replaceSongInstrumental,
  replaceSongRecordingSource,
} from '../lib/source-replacement.js';
import { downloadQueue } from '../lib/download-queue.js';
import { scanLibrary } from '../lib/scanner.js';

async function probeAudio(filePath: string) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  return JSON.parse(stdout) as {
    format?: { format_name?: string; duration?: string };
    streams?: Array<{ codec_type?: string; codec_name?: string }>;
  };
}

async function createMinimalPng(filePath: string) {
  await execFileAsync('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', 'color=c=blue:s=32x32:d=1',
    '-frames:v', '1',
    filePath,
  ]);
}

async function createSampleWav(filePath: string, freq = 330) {
  await execFileAsync('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-t', '1',
    '-i', `sine=frequency=${freq}:sample_rate=44100`,
    '-c:a', 'pcm_s16le',
    filePath,
  ]);
}

async function createSampleMp3(
  filePath: string,
  tags: { title: string; artist: string; album: string },
  freq = 440
) {
  await execFileAsync('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-t', '1',
    '-i', `sine=frequency=${freq}:sample_rate=44100`,
    '-c:a', 'libmp3lame',
    '-b:a', '192k',
    '-metadata', `title=${tags.title}`,
    '-metadata', `artist=${tags.artist}`,
    '-metadata', `album=${tags.album}`,
    filePath,
  ]);
}

async function createSampleFlac(
  filePath: string,
  coverImagePath: string,
  tags: { title: string; artist: string; album: string }
) {
  await execFileAsync('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-t', '1',
    '-i', 'sine=frequency=440:sample_rate=44100',
    '-i', coverImagePath,
    '-map', '0:a',
    '-map', '1:v',
    '-c:a', 'flac',
    '-c:v', 'mjpeg',
    '-disposition:v', 'attached_pic',
    '-metadata', `title=${tags.title}`,
    '-metadata', `artist=${tags.artist}`,
    '-metadata', `album=${tags.album}`,
    filePath,
  ]);
}

async function createSampleM4a(
  filePath: string,
  coverImagePath: string,
  tags: { title: string; artist: string; album: string }
) {
  await execFileAsync('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-t', '1',
    '-i', 'sine=frequency=523:sample_rate=44100',
    '-i', coverImagePath,
    '-map', '0:a',
    '-map', '1:v',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-c:v', 'mjpeg',
    '-disposition:v', 'attached_pic',
    '-metadata', `title=${tags.title}`,
    '-metadata', `artist=${tags.artist}`,
    '-metadata', `album=${tags.album}`,
    filePath,
  ]);
}

async function createSampleOpus(
  filePath: string,
  tags: { title: string; artist: string; album: string }
) {
  await execFileAsync('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-t', '1',
    '-i', 'sine=frequency=659:sample_rate=48000',
    '-c:a', 'libopus',
    '-b:a', '128k',
    '-metadata', `title=${tags.title}`,
    '-metadata', `artist=${tags.artist}`,
    '-metadata', `album=${tags.album}`,
    filePath,
  ]);
}

async function assertGenuineInstrumentalMp3(
  filePath: string,
  expectedSongTitle: string
) {
  assert.ok(filePath.endsWith(' (Instrumental).mp3'), `Expected canonical " (Instrumental).mp3" path, got ${filePath}`);
  assert.ok(fs.existsSync(filePath), `Expected instrumental MP3 to exist: ${filePath}`);
  await verifyValidMp3File(filePath);

  const probed = await probeAudio(filePath);
  const audioStreams = (probed.streams || []).filter((s) => s.codec_type === 'audio');
  assert.ok(audioStreams.length >= 1, 'Expected audio stream in instrumental MP3');
  assert.strictEqual(probed.format?.format_name, 'mp3');
  assert.strictEqual(audioStreams[0].codec_name, 'mp3');

  const meta = await mm.parseFile(filePath, { duration: true });
  assert.strictEqual(meta.format.container, 'MPEG');
  assert.strictEqual(meta.common.title, `${expectedSongTitle} (Instrumental)`);
  const comments = (meta.common.comment || []).map((c: any) =>
    typeof c === 'string' ? c : (c?.text || '')
  );
  const nativeTags = Object.values(meta.native || {}).flat();
  const hasNativeVariant = nativeTags.some((t: any) => {
    const id = String(t?.id || '').toUpperCase();
    const val = typeof t?.value === 'string' ? t.value : String(t?.value?.text || '');
    return (
      (id.includes('YIMLY_VARIANT') && val.trim().toLowerCase() === 'instrumental') ||
      val.includes('YIMLY_VARIANT=instrumental')
    );
  });
  assert.ok(
    hasNativeVariant || comments.some((c) => c.includes('YIMLY_VARIANT=instrumental')),
    `Expected YIMLY_VARIANT=instrumental tag in ID3 metadata, got common.comment=${JSON.stringify(comments)} native=${JSON.stringify(nativeTags)}`
  );
}

test('Phase 2 Shared Instrumental Pipeline & Demucs Concurrency Foundation', async (t) => {
  fs.rmSync(testDataDir, { recursive: true, force: true });
  fs.mkdirSync(testDataDir, { recursive: true });

  await setupDatabase();

  // Clean database state
  await db.delete(songVerifiedSources);
  await db.delete(playlistSongs);
  await db.delete(playlists);
  await db.delete(favorites);
  await db.delete(queueItems);
  await db.delete(sessions);
  await db.delete(lyrics);
  await db.delete(songArtists);
  await db.delete(songs);
  await db.delete(albums);
  await db.delete(artists);
  await db.delete(libraries);
  await db.delete(users);

  const origCheckCuda = audioSeparationHooks.checkCudaAvailability;
  const origRunJob = demucsWorkerManager.runJob.bind(demucsWorkerManager);
  const origDownload = downloadQueue.downloadSingleTrackAudio;

  t.after(() => {
    audioSeparationHooks.checkCudaAvailability = origCheckCuda;
    demucsWorkerManager.runJob = origRunJob;
    downloadQueue.downloadSingleTrackAudio = origDownload;
    fs.rmSync(testDataDir, { recursive: true, force: true });
  });

  const adminUser = (
    await db
      .insert(users)
      .values({
        username: 'phase2_admin',
        password: 'hashed_password_placeholder',
        role: 'administrator',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
  )[0];

  const libraryDir = path.join(testDataDir, 'library');
  fs.mkdirSync(libraryDir, { recursive: true });
  const libRow = (await db.insert(libraries).values({ name: 'Phase 2 Lib', path: libraryDir }).returning())[0];
  const libraryId = libRow.id;

  const coverPath = path.join(testDataDir, 'cover.png');
  await createMinimalPng(coverPath);

  await t.test('1. Shared Demucs serialization lock: serializes overlapping processingQueue, replaceSongInstrumental, and direct callers with isolated progress & error recovery', async () => {
    audioSeparationHooks.checkCudaAvailability = async () => ({
      available: true,
      deviceName: 'Mock-NVIDIA-GPU',
    });

    let activeDemucsCount = 0;
    let maxConcurrentDemucs = 0;
    const timeline: string[] = [];

    demucsWorkerManager.runJob = async (_py, splitReqPath, _statusPath, _modelsDir, onProgress) => {
      assert.strictEqual(demucsWorkerManager.getLockStatus().locked, true, 'Lock must be held inside runJob');
      activeDemucsCount++;
      maxConcurrentDemucs = Math.max(maxConcurrentDemucs, activeDemucsCount);

      const req = JSON.parse(fs.readFileSync(splitReqPath, 'utf-8'));
      const baseAudioName = path.basename(req.audio, path.extname(req.audio));
      timeline.push(`start:${baseAudioName}`);

      onProgress(25, `progress-25:${baseAudioName}`);
      await new Promise((r) => setTimeout(r, 60));

      if (baseAudioName.includes('FAIL_ME')) {
        activeDemucsCount--;
        timeline.push(`fail:${baseAudioName}`);
        throw new Error(`Simulated Demucs failure for ${baseAudioName}`);
      }

      onProgress(80, `progress-80:${baseAudioName}`);
      await new Promise((r) => setTimeout(r, 40));

      const stemDir = path.join(req.out_dir, 'htdemucs', baseAudioName);
      fs.mkdirSync(stemDir, { recursive: true });
      await createSampleWav(path.join(stemDir, 'no_vocals.wav'));

      timeline.push(`end:${baseAudioName}`);
      activeDemucsCount--;
    };

    // Prepare three separate inputs invoked via DIFFERENT execution mechanisms:
    // A) New song via standalone ProcessingQueueManager -> processDownloadedSong (fails in Demucs)
    // B) Regenerate instrumental via DownloadQueueManager -> replaceSongInstrumental
    // C) Direct generateInstrumentalFromOriginal call + cancelled queued caller
    const failArtistDir = path.join(libraryDir, 'Lock Artist A');
    fs.mkdirSync(failArtistDir, { recursive: true });
    const failTrackPath = path.join(failArtistDir, 'FAIL_ME_Track.mp3');
    await createSampleMp3(failTrackPath, { title: 'Fail Track', artist: 'Lock Artist A', album: 'Lock Album' });

    const okArtistDir = path.join(libraryDir, 'Lock Artist B');
    fs.mkdirSync(okArtistDir, { recursive: true });
    const regenTrackPath = path.join(okArtistDir, 'Lock Artist B - Regen Track.mp3');
    await createSampleMp3(regenTrackPath, { title: 'Regen Track', artist: 'Lock Artist B', album: 'Lock Album' });

    const directTrackPath = path.join(okArtistDir, 'DirectCallerTrack.mp3');
    await createSampleMp3(directTrackPath, { title: 'Direct Track', artist: 'Lock Artist B', album: 'Lock Album' });

    const cancelTrackPath = path.join(okArtistDir, 'CancelQueuedTrack.mp3');
    await createSampleMp3(cancelTrackPath, { title: 'Cancel Track', artist: 'Lock Artist B', album: 'Lock Album' });

    const artB = (await db.insert(artists).values({ name: 'Lock Artist B' }).returning())[0];
    const songB = (
      await db
        .insert(songs)
        .values({
          libraryId,
          artistId: artB.id,
          title: 'Regen Track',
          mainAudioPath: regenTrackPath,
          instrumentalAudioPath: null,
          duration: 1,
          format: 'MPEG',
          variant: 'original',
        })
        .returning()
    )[0];
    await db.insert(songArtists).values({ songId: songB.id, artistId: artB.id, position: 0 });

    const procQueue = new ProcessingQueueManager(processDownloadedSong);
    const directProgressMsgs: string[] = [];
    const abortCtrl = new AbortController();

    const pNewSongFail = procQueue.enqueue({
      downloadTrackId: `dl_lock_fail_${Date.now()}`,
      originalAudioPath: failTrackPath,
      libraryId,
      title: 'Fail Track',
      artist: 'Lock Artist A',
      album: 'Lock Album',
      duration: 1,
    });

    const pRegen = replaceSongInstrumental(songB.id);

    const pDirect = generateInstrumentalFromOriginal({
      originalAudioPath: directTrackPath,
      targetDir: okArtistDir,
      metadata: { title: 'Direct Track', artist: 'Lock Artist B', album: 'Lock Album' },
      onProgress: (_pct, msg) => directProgressMsgs.push(msg),
    });

    const pCancelledWhileQueued = generateInstrumentalFromOriginal({
      originalAudioPath: cancelTrackPath,
      targetDir: okArtistDir,
      metadata: { title: 'Cancel Track', artist: 'Lock Artist B' },
      signal: abortCtrl.signal,
    });
    // Abort queued fourth job while earlier jobs hold the lock
    setTimeout(() => abortCtrl.abort(), 15);

    const [rFail, rRegen, rDirect, rCancel] = await Promise.allSettled([
      pNewSongFail,
      pRegen,
      pDirect,
      pCancelledWhileQueued,
    ]);

    assert.strictEqual(maxConcurrentDemucs, 1, `Expected max concurrent Demucs jobs === 1, got ${maxConcurrentDemucs}`);
    assert.strictEqual(demucsWorkerManager.getLockStatus().locked, false, 'Demucs lock must be cleanly released');
    assert.strictEqual(demucsWorkerManager.getLockStatus().queuedCount, 0, 'Demucs lock queue must be empty');

    assert.strictEqual(rFail.status, 'rejected', 'Failing New Song job must reject without blocking other callers');
    assert.strictEqual(rRegen.status, 'fulfilled');
    assert.strictEqual(rRegen.value.success, true, `Regen job must succeed after earlier failure: ${rRegen.value.error}`);

    assert.strictEqual(rDirect.status, 'fulfilled');
    try {
      await assertGenuineInstrumentalMp3(rDirect.value.stagedInstrumentalPath, 'Direct Track');
    } finally {
      rDirect.value.cleanup();
    }

    assert.strictEqual(rCancel.status, 'rejected', 'Cancelled queued Demucs caller must reject cleanly');
    assert.ok(
      directProgressMsgs.some((m) => m.includes('progress-80:DirectCallerTrack')),
      'Direct job must receive its own isolated progress events'
    );
    assert.ok(
      !directProgressMsgs.some((m) => m.includes('FAIL_ME_Track')),
      'Progress events must never leak across concurrent Demucs jobs'
    );

    // Ensure timeline entries never interleaved starts before previous ended/failed
    for (let i = 0; i < timeline.length; i += 2) {
      const startEv = timeline[i];
      const stopEv = timeline[i + 1];
      assert.ok(startEv?.startsWith('start:'), `Expected start event at index ${i}, got ${startEv}`);
      const jobName = startEv.slice('start:'.length);
      assert.ok(
        stopEv === `end:${jobName}` || stopEv === `fail:${jobName}`,
        `Expected matching stop event for ${jobName}, got ${stopEv} (timeline=${JSON.stringify(timeline)})`
      );
    }
  });

  await t.test('2. New Song (processDownloadedSong): .flac, .m4a, .wav, and .opus originals keep native formats and always produce genuine .mp3 instrumentals + YIMLY tags', async () => {
    audioSeparationHooks.checkCudaAvailability = async () => ({
      available: true,
      deviceName: 'Mock-NVIDIA-GPU',
    });
    demucsWorkerManager.runJob = async (_py, splitReqPath) => {
      const req = JSON.parse(fs.readFileSync(splitReqPath, 'utf-8'));
      const baseAudioName = path.basename(req.audio, path.extname(req.audio));
      const stemDir = path.join(req.out_dir, 'htdemucs', baseAudioName);
      fs.mkdirSync(stemDir, { recursive: true });
      await createSampleWav(path.join(stemDir, 'no_vocals.wav'));
    };

    const roomSessionId = crypto.randomUUID();
    await db.insert(sessions).values({
      id: roomSessionId,
      roomCode: `P2_${Date.now().toString().slice(-4)}`,
      hostId: adminUser.id,
      hostDevice: 'Test',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const cases: Array<{ ext: string; title: string; artist: string; album: string; create: (p: string) => Promise<void> }> = [
      {
        ext: '.flac',
        title: 'Flac Horizon',
        artist: 'Phase2 Flac Artist',
        album: 'Flac Album',
        create: (p) => createSampleFlac(p, coverPath, { title: 'Flac Horizon', artist: 'Phase2 Flac Artist', album: 'Flac Album' }),
      },
      {
        ext: '.m4a',
        title: 'M4a Horizon',
        artist: 'Phase2 M4a Artist',
        album: 'M4a Album',
        create: (p) => createSampleM4a(p, coverPath, { title: 'M4a Horizon', artist: 'Phase2 M4a Artist', album: 'M4a Album' }),
      },
      {
        ext: '.wav',
        title: 'Wav Horizon',
        artist: 'Phase2 Wav Artist',
        album: 'Wav Album',
        create: (p) => createSampleWav(p, 440),
      },
      {
        ext: '.opus',
        title: 'Opus Horizon',
        artist: 'Phase2 Opus Artist',
        album: 'Opus Album',
        create: (p) => createSampleOpus(p, { title: 'Opus Horizon', artist: 'Phase2 Opus Artist', album: 'Opus Album' }),
      },
    ];

    for (let idx = 0; idx < cases.length; idx++) {
      const tc = cases[idx];
      const artistDir = path.join(libraryDir, tc.artist);
      fs.mkdirSync(artistDir, { recursive: true });
      const baseName = `${tc.artist} - ${tc.title}`;
      const origPath = path.join(artistDir, `${baseName}${tc.ext}`);
      await tc.create(origPath);
      const origBytes = fs.readFileSync(origPath);

      const dlTrackId = `p2_track_${tc.ext}_${Date.now()}_${idx}`;
      await db.insert(queueItems).values({
        sessionId: roomSessionId,
        songId: null,
        position: idx + 1,
        status: 'pending',
        tempTitle: tc.title,
        tempArtist: tc.artist,
        downloadJobId: `p2_job_${idx}`,
        downloadTrackId: dlTrackId,
        downloadStatus: 'downloading',
        userId: adminUser.id,
        addedAt: new Date(),
      });

      await processDownloadedSong({
        downloadTrackId: dlTrackId,
        originalAudioPath: origPath,
        libraryId,
        title: tc.title,
        artist: tc.artist,
        album: tc.album,
        duration: 1,
      });

      const expectedInstMp3 = resolveCanonicalInstrumentalPath(origPath, artistDir, baseName);
      assert.strictEqual(expectedInstMp3, path.join(artistDir, `${baseName} (Instrumental).mp3`));
      assert.strictEqual(
        fs.existsSync(path.join(artistDir, `${baseName} (Instrumental)${tc.ext}`)),
        false,
        `Must NEVER write instrumental with source extension ${tc.ext}`
      );

      await assertGenuineInstrumentalMp3(expectedInstMp3, tc.title);
      assert.strictEqual(Buffer.compare(fs.readFileSync(origPath), origBytes), 0, `Original ${tc.ext} file preserved verbatim`);

      const qRow = (await db.select().from(queueItems).where(eq(queueItems.downloadTrackId, dlTrackId)))[0];
      assert.strictEqual(qRow.downloadStatus, 'ready');
      assert.ok(qRow.songId, 'Queue item linked to indexed songId');

      const songRow = (await db.select().from(songs).where(eq(songs.id, qRow.songId!)))[0];
      assert.strictEqual(songRow.mainAudioPath, origPath);
      assert.strictEqual(songRow.instrumentalAudioPath, expectedInstMp3);
      assert.ok(
        !songRow.format?.toLowerCase().includes('mpeg'),
        `Original format for ${tc.ext} should remain preserved in DB, got: ${songRow.format}`
      );
    }

    // Re-scan must keep all songs registered with both variants intact
    await scanLibrary(libraryId, libraryDir);
    for (const tc of cases) {
      const artistDir = path.join(libraryDir, tc.artist);
      const baseName = `${tc.artist} - ${tc.title}`;
      const origPath = path.join(artistDir, `${baseName}${tc.ext}`);
      const instPath = path.join(artistDir, `${baseName} (Instrumental).mp3`);
      const matched = await db.select().from(songs).where(eq(songs.mainAudioPath, origPath));
      assert.strictEqual(matched.length, 1);
      assert.strictEqual(matched[0].instrumentalAudioPath, instPath);
    }
  });

  await t.test('3. New Song (processDownloadedSong): regenerates invalid/disguised .mp3 instrumental instead of trusting size > 1024, and skips when genuinely valid MP3 exists', async () => {
    let demucsCalls = 0;
    audioSeparationHooks.checkCudaAvailability = async () => ({
      available: true,
      deviceName: 'Mock-NVIDIA-GPU',
    });
    demucsWorkerManager.runJob = async (_py, splitReqPath) => {
      demucsCalls++;
      const req = JSON.parse(fs.readFileSync(splitReqPath, 'utf-8'));
      const baseAudioName = path.basename(req.audio, path.extname(req.audio));
      const stemDir = path.join(req.out_dir, 'htdemucs', baseAudioName);
      fs.mkdirSync(stemDir, { recursive: true });
      await createSampleWav(path.join(stemDir, 'no_vocals.wav'));
    };

    const dir = path.join(libraryDir, 'Validation Artist');
    fs.mkdirSync(dir, { recursive: true });
    const baseName = 'Validation Artist - Integrity Check';
    const origFlac = path.join(dir, `${baseName}.flac`);
    const targetInstMp3 = path.join(dir, `${baseName} (Instrumental).mp3`);

    await createSampleFlac(origFlac, coverPath, {
      title: 'Integrity Check',
      artist: 'Validation Artist',
      album: 'Check LP',
    });

    // Disguise the FLAC bytes as a `.mp3` (> 1024 bytes, so weak size checks would wrongly skip!)
    fs.copyFileSync(origFlac, targetInstMp3);

    await processDownloadedSong({
      downloadTrackId: `disguised_${Date.now()}`,
      originalAudioPath: origFlac,
      libraryId,
      title: 'Integrity Check',
      artist: 'Validation Artist',
      album: 'Check LP',
      duration: 1,
    });

    assert.strictEqual(demucsCalls, 1, 'Disguised FLAC in .mp3 target must trigger regeneration via shared pipeline');
    await assertGenuineInstrumentalMp3(targetInstMp3, 'Integrity Check');

    // Running again when a genuinely valid MP3 already exists should skip Demucs cleanly
    await processDownloadedSong({
      downloadTrackId: `valid_skip_${Date.now()}`,
      originalAudioPath: origFlac,
      libraryId,
      title: 'Integrity Check',
      artist: 'Validation Artist',
      album: 'Check LP',
      duration: 1,
    });
    assert.strictEqual(demucsCalls, 1, 'Valid existing instrumental MP3 should skip redundant Demucs invocation');
  });

  await t.test('4. Regenerate Instrumental & Replace Audio both delegate to shared pipeline & verify format preservation without calling download on regenerate', async () => {
    let downloadCalls = 0;
    let demucsCalls = 0;

    audioSeparationHooks.checkCudaAvailability = async () => ({
      available: true,
      deviceName: 'Mock-NVIDIA-GPU',
    });
    demucsWorkerManager.runJob = async (_py, splitReqPath) => {
      demucsCalls++;
      const req = JSON.parse(fs.readFileSync(splitReqPath, 'utf-8'));
      const baseAudioName = path.basename(req.audio, path.extname(req.audio));
      const stemDir = path.join(req.out_dir, 'htdemucs', baseAudioName);
      fs.mkdirSync(stemDir, { recursive: true });
      await createSampleWav(path.join(stemDir, 'no_vocals.wav'));
    };

    const dir = path.join(libraryDir, 'Workflow Artist');
    fs.mkdirSync(dir, { recursive: true });
    const opusMain = path.join(dir, 'Workflow Artist - Dual Workflow.opus');
    await createSampleOpus(opusMain, {
      title: 'Dual Workflow',
      artist: 'Workflow Artist',
      album: 'Workflow LP',
    });

    const art = (await db.insert(artists).values({ name: 'Workflow Artist' }).returning())[0];
    const alb = (await db.insert(albums).values({ artistId: art.id, title: 'Workflow LP' }).returning())[0];
    const songRow = (
      await db
        .insert(songs)
        .values({
          libraryId,
          artistId: art.id,
          albumId: alb.id,
          title: 'Dual Workflow',
          mainAudioPath: opusMain,
          instrumentalAudioPath: null,
          duration: 1,
          format: 'Ogg',
          variant: 'original',
        })
        .returning()
    )[0];
    await db.insert(songArtists).values({ songId: songRow.id, artistId: art.id, position: 0 });

    downloadQueue.downloadSingleTrackAudio = async (_url, outDir) => {
      downloadCalls++;
      const dlM4a = path.join(outDir, `dl_${Date.now()}.m4a`);
      await createSampleM4a(dlM4a, coverPath, {
        title: 'Dual Workflow',
        artist: 'Workflow Artist',
        album: 'Workflow LP',
      });
      return dlM4a;
    };

    // A) Regenerate Instrumental: reuses opus main, zero downloads, writes genuine .mp3
    const regenRes = await replaceSongInstrumental(songRow.id);
    assert.strictEqual(regenRes.success, true, `Regenerate Instrumental failed: ${regenRes.error}`);
    assert.strictEqual(downloadCalls, 0, 'Regenerate Instrumental must never download from YouTube');
    assert.strictEqual(demucsCalls, 1);
    assert.ok(regenRes.instrumentalPath);
    await assertGenuineInstrumentalMp3(regenRes.instrumentalPath!, 'Dual Workflow');

    const afterRegen = (await db.select().from(songs).where(eq(songs.id, songRow.id)))[0];
    assert.strictEqual(afterRegen.mainAudioPath, opusMain);
    assert.strictEqual(afterRegen.instrumentalAudioPath, regenRes.instrumentalPath);

    // B) Replace Audio: downloads .m4a replacement, preserves .m4a main, runs shared pipeline for .mp3 instrumental, updates verified source
    const repAudioRes = await replaceSongRecordingSource(
      songRow.id,
      'https://www.youtube.com/watch?v=rYEDA3JcQqw'
    );
    assert.strictEqual(repAudioRes.success, true, `Replace Audio failed: ${repAudioRes.error}`);
    assert.strictEqual(downloadCalls, 1);
    assert.strictEqual(demucsCalls, 2);

    const expectedMainM4a = path.join(dir, 'Workflow Artist - Dual Workflow.m4a');
    const expectedInstMp3 = path.join(dir, 'Workflow Artist - Dual Workflow (Instrumental).mp3');
    assert.strictEqual(repAudioRes.originalPath, expectedMainM4a);
    assert.strictEqual(repAudioRes.instrumentalPath, expectedInstMp3);
    assert.strictEqual(fs.existsSync(opusMain), false, 'Superseded .opus main deleted after verified commit');

    const mainProbe = await probeAudio(expectedMainM4a);
    assert.ok((mainProbe.format?.format_name || '').includes('mp4'));
    await assertGenuineInstrumentalMp3(expectedInstMp3, 'Dual Workflow');

    const verifiedRows = await db
      .select()
      .from(songVerifiedSources)
      .where(eq(songVerifiedSources.songId, songRow.id));
    assert.strictEqual(verifiedRows.length, 1);
    assert.strictEqual(verifiedRows[0].videoId, 'rYEDA3JcQqw');
  });

  await t.test('5. Atomic installation, concurrent install guard, full filesystem + DB rollback, and temp cleanup', async () => {
    const dir = path.join(libraryDir, 'Atomic Artist');
    fs.mkdirSync(dir, { recursive: true });
    const origFlac = path.join(dir, 'Atomic Artist - Safe Song.flac');
    const stableInstMp3 = path.join(dir, 'Atomic Artist - Safe Song (Instrumental).mp3');
    const legacyWrongInst = path.join(dir, 'Atomic Artist - Safe Song (Instrumental).flac');

    await createSampleFlac(origFlac, coverPath, {
      title: 'Safe Song',
      artist: 'Atomic Artist',
      album: 'Safe Album',
    });
    await createSampleMp3(
      stableInstMp3,
      { title: 'Safe Song (Instrumental)', artist: 'Atomic Artist', album: 'Safe Album' },
      310
    );
    fs.writeFileSync(legacyWrongInst, Buffer.alloc(2048, 'legacy'));
    const preStableBytes = fs.readFileSync(stableInstMp3);

    const art = (await db.insert(artists).values({ name: 'Atomic Artist' }).returning())[0];
    const songRow = (
      await db
        .insert(songs)
        .values({
          libraryId,
          artistId: art.id,
          title: 'Safe Song',
          mainAudioPath: origFlac,
          instrumentalAudioPath: stableInstMp3,
          duration: 1,
          format: 'FLAC',
          variant: 'original',
        })
        .returning()
    )[0];
    await db.insert(songArtists).values({ songId: songRow.id, artistId: art.id, position: 0 });

    // Create a valid staged replacement MP3 (different frequency/bytes) and a disguised invalid MP3
    const validStagedMp3 = path.join(testDataDir, 'staged_new_valid.mp3');
    await createSampleMp3(
      validStagedMp3,
      { title: 'Safe Song (Instrumental)', artist: 'Atomic Artist', album: 'Safe Album' },
      770
    );
    const fakeStagedMp3 = path.join(testDataDir, 'staged_fake.mp3');
    fs.copyFileSync(origFlac, fakeStagedMp3);

    // 5a. Invalid staged MP3 fails before modifying existing file or DB
    await assert.rejects(
      () =>
        installInstrumentalForSong({
          songId: songRow.id,
          stagedInstrumentalPath: fakeStagedMp3,
          targetDir: dir,
          targetFilename: 'Atomic Artist - Safe Song (Instrumental).mp3',
        }),
      /does not contain valid MP3 audio/i
    );
    assert.strictEqual(Buffer.compare(fs.readFileSync(stableInstMp3), preStableBytes), 0);

    // 5b. Simulated DB commit failure rolls back overwritten target & DB & cleans backup files
    let releaseConcurrentCheck!: () => void;
    const lockEnteredPromise = new Promise<void>((resolveLock) => {
      releaseConcurrentCheck = resolveLock;
    });
    let allowHookThrow!: () => void;
    const waitToThrow = new Promise<void>((res) => {
      allowHookThrow = res;
    });

    const failingInstall = installInstrumentalForSong({
      songId: songRow.id,
      stagedInstrumentalPath: validStagedMp3,
      targetDir: dir,
      targetFilename: 'Atomic Artist - Safe Song (Instrumental).mp3',
      beforeDbCommit: async () => {
        releaseConcurrentCheck();
        await waitToThrow;
        throw new Error('Simulated DB commit error');
      },
    });

    await lockEnteredPromise;

    // 5c. Concurrent installation guard rejects second installer on same songId
    await assert.rejects(
      () =>
        installInstrumentalForSong({
          songId: songRow.id,
          stagedInstrumentalPath: validStagedMp3,
          targetDir: dir,
          targetFilename: 'Atomic Artist - Safe Song (Instrumental).mp3',
        }),
      /Concurrent instrumental installation already in progress/i
    );

    allowHookThrow();
    await assert.rejects(() => failingInstall, /Simulated DB commit error/);

    // Target file & DB record must be restored byte-for-byte
    assert.strictEqual(
      Buffer.compare(fs.readFileSync(stableInstMp3), preStableBytes),
      0,
      'Existing instrumental restored byte-for-byte on commit rollback'
    );
    const dbAfterRollback = (await db.select().from(songs).where(eq(songs.id, songRow.id)))[0];
    assert.strictEqual(dbAfterRollback.instrumentalAudioPath, stableInstMp3);
    assert.strictEqual(dbAfterRollback.format, 'FLAC');

    // Verify no leftover backup/temp files in artist dir or testDataDir
    const strayArtistFiles = fs
      .readdirSync(dir)
      .filter((f) => f.includes('.bak_') || f.includes('.destbak_') || f.includes('.tmp_'));
    assert.deepStrictEqual(strayArtistFiles, [], 'No backup or temp artifacts leaked in artist dir');

    const strayStagingDirs = fs
      .readdirSync(testDataDir)
      .filter((d) => d.startsWith('tmp_inst_') || d.startsWith('tmp_replace_'));
    assert.deepStrictEqual(strayStagingDirs, [], 'No staging directories leaked in DATA_DIR');

    const tmpDlDir = path.join(testDataDir, 'tmp_downloads');
    if (fs.existsSync(tmpDlDir)) {
      assert.deepStrictEqual(fs.readdirSync(tmpDlDir), [], 'No demucs_* temp directories leaked');
    }
  });
});
