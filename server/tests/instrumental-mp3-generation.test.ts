import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import express from 'express';
import http from 'http';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import * as mm from 'music-metadata';

const execFileAsync = promisify(execFile);

const testDataDir = path.resolve(process.cwd(), 'data', 'test_instrumental_mp3_gen');
process.env.DATA_DIR = testDataDir;

import { setupDatabase, db } from '../db/index.js';
import {
  users,
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
import songsRoutes from '../routes/songs.js';
import {
  replaceSongRecordingSource,
  replaceSongInstrumental,
} from '../lib/source-replacement.js';
import {
  audioSeparationHooks,
  createInstrumentalWithFFmpeg,
  verifyValidMp3File,
} from '../lib/audio-separation.js';
import { demucsWorkerManager } from '../lib/demucs-worker.js';
import { downloadQueue } from '../lib/download-queue.js';
import { scanLibrary } from '../lib/scanner.js';

const JWT_SECRET =
  process.env.JWT_SECRET || 'yimly_deterministic_test_jwt_secret_ci_only_32_bytes_safe';

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
  // 1x1 red PNG generated via ffmpeg
  await execFileAsync('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=64x64:d=1',
    '-frames:v',
    '1',
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
    '-f',
    'lavfi',
    '-t',
    '1',
    '-i',
    'sine=frequency=440:sample_rate=44100',
    '-i',
    coverImagePath,
    '-map',
    '0:a',
    '-map',
    '1:v',
    '-c:a',
    'flac',
    '-c:v',
    'mjpeg',
    '-disposition:v',
    'attached_pic',
    '-metadata',
    `title=${tags.title}`,
    '-metadata',
    `artist=${tags.artist}`,
    '-metadata',
    `album=${tags.album}`,
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
    '-f',
    'lavfi',
    '-t',
    '1',
    '-i',
    'sine=frequency=523:sample_rate=44100',
    '-i',
    coverImagePath,
    '-map',
    '0:a',
    '-map',
    '1:v',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-c:v',
    'mjpeg',
    '-disposition:v',
    'attached_pic',
    '-metadata',
    `title=${tags.title}`,
    '-metadata',
    `artist=${tags.artist}`,
    '-metadata',
    `album=${tags.album}`,
    filePath,
  ]);
}

async function createSampleWav(filePath: string) {
  await execFileAsync('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-t',
    '1',
    '-i',
    'sine=frequency=330:sample_rate=44100',
    '-c:a',
    'pcm_s16le',
    filePath,
  ]);
}

async function assertRealMp3File(filePath: string) {
  assert.ok(filePath.toLowerCase().endsWith('.mp3'), `Expected .mp3 extension, got ${filePath}`);
  assert.ok(fs.existsSync(filePath), `Expected MP3 file to exist at ${filePath}`);
  assert.ok(fs.statSync(filePath).size > 1024, `Expected non-trivial MP3 size at ${filePath}`);

  const probed = await probeAudio(filePath);
  const audioStreams = (probed.streams || []).filter((s) => s.codec_type === 'audio');
  assert.ok(audioStreams.length >= 1, 'Expected at least one audio stream in MP3');
  assert.strictEqual(probed.format?.format_name, 'mp3', `Expected ffprobe format_name=mp3, got ${probed.format?.format_name}`);
  assert.strictEqual(audioStreams[0].codec_name, 'mp3', `Expected ffprobe codec_name=mp3, got ${audioStreams[0].codec_name}`);

  const meta = await mm.parseFile(filePath, { duration: true });
  assert.strictEqual(meta.format.container, 'MPEG', `Expected music-metadata container MPEG, got ${meta.format.container}`);
  assert.ok(
    (meta.format.codec || '').toUpperCase().includes('MPEG'),
    `Expected MPEG audio codec, got ${meta.format.codec}`
  );
}

test('Instrumental MP3 Generation: Replace Audio & Regenerate Instrumental Regression Suite', async (t) => {
  fs.mkdirSync(testDataDir, { recursive: true });

  await setupDatabase();

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/songs', songsRoutes);

  const server = http.createServer(app);
  let baseUrl = '';
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  // Save originals so we restore stubs cleanly
  const origCheckCuda = audioSeparationHooks.checkCudaAvailability;
  const origRunJob = demucsWorkerManager.runJob.bind(demucsWorkerManager);
  const origDownload = downloadQueue.downloadSingleTrackAudio;

  let demucsShouldFail = false;

  const installRealFFmpegDemucsStub = () => {
    audioSeparationHooks.checkCudaAvailability = async () => ({
      available: true,
      deviceName: 'Mock-NVIDIA-GPU',
    });
    demucsWorkerManager.runJob = async (_py, splitReqPath) => {
      if (demucsShouldFail) {
        throw new Error('Simulated Demucs stem separation failure');
      }
      const req = JSON.parse(fs.readFileSync(splitReqPath, 'utf-8'));
      const baseAudioName = path.basename(req.audio, path.extname(req.audio));
      const stemDir = path.join(req.out_dir, 'htdemucs', baseAudioName);
      fs.mkdirSync(stemDir, { recursive: true });
      await createSampleWav(path.join(stemDir, 'no_vocals.wav'));
    };
  };

  t.after(() => {
    audioSeparationHooks.checkCudaAvailability = origCheckCuda;
    demucsWorkerManager.runJob = origRunJob;
    downloadQueue.downloadSingleTrackAudio = origDownload;
    server.close();
  });

  // Clear tables cleanly
  await db.delete(songVerifiedSources);
  await db.delete(playlistSongs);
  await db.delete(playlists);
  await db.delete(favorites);
  await db.delete(queueItems);
  await db.delete(lyrics);
  await db.delete(songArtists);
  await db.delete(songs);
  await db.delete(albums);
  await db.delete(artists);
  await db.delete(libraries);
  await db.delete(users);

  const adminUser = (
    await db
      .insert(users)
      .values({
        username: 'inst_admin',
        password: 'hashed_password_placeholder',
        role: 'administrator',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
  )[0];
  const adminToken = jwt.sign(
    { id: adminUser.id, username: adminUser.username, role: 'administrator' },
    JWT_SECRET
  );

  const libraryDir = path.join(testDataDir, 'library');
  fs.rmSync(libraryDir, { recursive: true, force: true });
  fs.mkdirSync(libraryDir, { recursive: true });
  const coverPath = path.join(testDataDir, 'cover.jpg');
  await createMinimalPng(coverPath);

  const libRes = await db.insert(libraries).values({ name: 'Inst MP3 Test Lib', path: libraryDir }).returning();
  const libraryId = libRes[0].id;

  await t.test('verifyValidMp3File rejects a FLAC file disguised with a .mp3 extension', async () => {
    const realFlac = path.join(testDataDir, 'real_source.flac');
    const fakeMp3 = path.join(testDataDir, 'disguised_flac.mp3');
    await createSampleFlac(realFlac, coverPath, {
      title: 'Fake MP3',
      artist: 'Test Artist',
      album: 'Test Album',
    });
    fs.copyFileSync(realFlac, fakeMp3);
    await assert.rejects(() => verifyValidMp3File(fakeMp3), /does not contain valid MP3 audio/i);
  });

  await t.test('Regenerate Instrumental (API + DB + scanner): FLAC source with obsolete .flac instrumental generates genuine .mp3 and preserves .flac main', async () => {
    installRealFFmpegDemucsStub();
    demucsShouldFail = false;

    const flacArtistDir = path.join(libraryDir, 'Flac Artist');
    fs.mkdirSync(flacArtistDir, { recursive: true });
    const mainFlacPath = path.join(flacArtistDir, 'Flac Artist - Crystal Anthem.flac');
    const oldInstFlacPath = path.join(flacArtistDir, 'Flac Artist - Crystal Anthem (Instrumental).flac');

    await createSampleFlac(mainFlacPath, coverPath, {
      title: 'Crystal Anthem',
      artist: 'Flac Artist',
      album: 'Lossless LP',
    });
    // Seed a legacy wrong-extension instrumental file
    fs.writeFileSync(oldInstFlacPath, Buffer.alloc(2048, 'legacy_inst'));

    const art = (await db.insert(artists).values({ name: 'Flac Artist' }).returning())[0];
    const alb = (await db.insert(albums).values({ artistId: art.id, title: 'Lossless LP' }).returning())[0];
    const songRow = (
      await db
        .insert(songs)
        .values({
          libraryId,
          artistId: art.id,
          albumId: alb.id,
          title: 'Crystal Anthem',
          mainAudioPath: mainFlacPath,
          instrumentalAudioPath: oldInstFlacPath,
          duration: 1,
          format: 'FLAC',
          variant: 'original',
          fileSize: fs.statSync(mainFlacPath).size,
        })
        .returning()
    )[0];
    await db.insert(songArtists).values({ songId: songRow.id, artistId: art.id, position: 0 });

    const preMainBytes = fs.readFileSync(mainFlacPath);

    // Call the real Regenerate Instrumental API endpoint
    const resp = await fetch(`${baseUrl}/api/songs/${songRow.id}/replace-instrumental`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(resp.status, 200);
    const body = (await resp.json()) as any;
    assert.strictEqual(body.success, true);

    const expectedInstPath = path.join(flacArtistDir, 'Flac Artist - Crystal Anthem (Instrumental).mp3');
    assert.strictEqual(body.instrumentalPath, expectedInstPath);

    // Verify real MP3 output
    await assertRealMp3File(expectedInstPath);

    // Verify original FLAC main audio untouched and obsolete .flac instrumental removed
    assert.strictEqual(Buffer.compare(fs.readFileSync(mainFlacPath), preMainBytes), 0, 'Original FLAC untouched');
    assert.strictEqual(fs.existsSync(oldInstFlacPath), false, 'Obsolete .flac instrumental deleted');

    // Verify database state
    const updatedSong = (await db.select().from(songs).where(eq(songs.id, songRow.id)))[0];
    assert.strictEqual(updatedSong.mainAudioPath, mainFlacPath);
    assert.strictEqual(updatedSong.instrumentalAudioPath, expectedInstPath);
    assert.strictEqual(updatedSong.format, 'FLAC', 'Main recording format metadata preserved');

    // Verify audio streaming endpoints serve matching Content-Types
    const instStreamRes = await fetch(`${baseUrl}/api/songs/${songRow.id}/audio?type=instrumental`, {
      method: 'HEAD',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(instStreamRes.status, 200);
    assert.strictEqual(instStreamRes.headers.get('content-type'), 'audio/mpeg');

    const mainStreamRes = await fetch(`${baseUrl}/api/songs/${songRow.id}/audio?type=main`, {
      method: 'HEAD',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.strictEqual(mainStreamRes.status, 200);
    assert.strictEqual(mainStreamRes.headers.get('content-type'), 'audio/flac');

    // Verify full library re-scan keeps same song ID and both main (.flac) and instrumental (.mp3)
    await scanLibrary(libraryId, libraryDir);
    const afterScanSongs = await db.select().from(songs).where(eq(songs.id, songRow.id));
    assert.strictEqual(afterScanSongs.length, 1);
    assert.strictEqual(afterScanSongs[0].mainAudioPath, mainFlacPath);
    assert.strictEqual(afterScanSongs[0].instrumentalAudioPath, expectedInstPath);
    assert.strictEqual(afterScanSongs[0].format, 'FLAC');
  });

  await t.test('Regenerate Instrumental: M4A source (format "M4A/isom/iso2") generates genuine .mp3 without ENOENT slash failure', async () => {
    installRealFFmpegDemucsStub();
    demucsShouldFail = false;

    const m4aArtistDir = path.join(libraryDir, 'M4a Artist');
    fs.mkdirSync(m4aArtistDir, { recursive: true });
    const mainM4aPath = path.join(m4aArtistDir, 'M4a Artist - Velour Groove.m4a');
    const oldInstM4aPath = path.join(m4aArtistDir, 'M4a Artist - Velour Groove (Instrumental).m4a');

    await createSampleM4a(mainM4aPath, coverPath, {
      title: 'Velour Groove',
      artist: 'M4a Artist',
      album: 'AAC Session',
    });
    fs.writeFileSync(oldInstM4aPath, Buffer.alloc(2048, 'legacy_m4a_inst'));

    const art = (await db.insert(artists).values({ name: 'M4a Artist' }).returning())[0];
    const alb = (await db.insert(albums).values({ artistId: art.id, title: 'AAC Session' }).returning())[0];
    const songRow = (
      await db
        .insert(songs)
        .values({
          libraryId,
          artistId: art.id,
          albumId: alb.id,
          title: 'Velour Groove',
          mainAudioPath: mainM4aPath,
          instrumentalAudioPath: oldInstM4aPath,
          duration: 1,
          format: 'M4A/isom/iso2',
          variant: 'original',
          fileSize: fs.statSync(mainM4aPath).size,
        })
        .returning()
    )[0];
    await db.insert(songArtists).values({ songId: songRow.id, artistId: art.id, position: 0 });

    const res = await replaceSongInstrumental(songRow.id);
    assert.strictEqual(res.success, true, `Expected M4A regenerate instrumental to succeed, got: ${res.error}`);

    const expectedInstPath = path.join(m4aArtistDir, 'M4a Artist - Velour Groove (Instrumental).mp3');
    assert.strictEqual(res.instrumentalPath, expectedInstPath);
    await assertRealMp3File(expectedInstPath);
    assert.strictEqual(fs.existsSync(oldInstM4aPath), false, 'Obsolete .m4a instrumental cleaned up');

    const updated = (await db.select().from(songs).where(eq(songs.id, songRow.id)))[0];
    assert.strictEqual(updated.mainAudioPath, mainM4aPath);
    assert.strictEqual(updated.instrumentalAudioPath, expectedInstPath);
    assert.strictEqual(updated.format, 'M4A/isom/iso2');

    // Safely overwrite an existing .mp3 instrumental on a subsequent regeneration
    const resSecond = await replaceSongInstrumental(songRow.id);
    assert.strictEqual(resSecond.success, true, 'Regenerating over existing .mp3 instrumental must succeed');
    assert.strictEqual(resSecond.instrumentalPath, expectedInstPath);
    await assertRealMp3File(expectedInstPath);
  });

  await t.test('Replace Audio (API + FFmpeg): Downloaded FLAC recording keeps main as .flac and saves real MP3 instrumental as .mp3', async () => {
    installRealFFmpegDemucsStub();
    demucsShouldFail = false;

    const artistDir = path.join(libraryDir, 'Replace Flac Artist');
    fs.mkdirSync(artistDir, { recursive: true });
    const oldMainMp3 = path.join(artistDir, 'Replace Flac Artist - Midnight Echo.mp3');
    const oldInstMp3 = path.join(artistDir, 'Replace Flac Artist - Midnight Echo (Instrumental).mp3');
    fs.writeFileSync(oldMainMp3, Buffer.alloc(2048, 'old_main'));
    fs.writeFileSync(oldInstMp3, Buffer.alloc(2048, 'old_inst'));

    const art = (await db.insert(artists).values({ name: 'Replace Flac Artist' }).returning())[0];
    const alb = (await db.insert(albums).values({ artistId: art.id, title: 'Replace Album' }).returning())[0];
    const songRow = (
      await db
        .insert(songs)
        .values({
          libraryId,
          artistId: art.id,
          albumId: alb.id,
          title: 'Midnight Echo',
          mainAudioPath: oldMainMp3,
          instrumentalAudioPath: oldInstMp3,
          duration: 1,
          format: 'MPEG',
          variant: 'original',
          fileSize: 2048,
        })
        .returning()
    )[0];
    await db.insert(songArtists).values({ songId: songRow.id, artistId: art.id, position: 0 });

    let receivedFormatArg = '';
    downloadQueue.downloadSingleTrackAudio = async (_url, outDir, format) => {
      receivedFormatArg = format;
      const dlFlac = path.join(outDir, `audio_${Date.now()}.flac`);
      await createSampleFlac(dlFlac, coverPath, {
        title: 'Midnight Echo',
        artist: 'Replace Flac Artist',
        album: 'Replace Album',
      });
      return dlFlac;
    };

    try {
      const resp = await fetch(`${baseUrl}/api/songs/${songRow.id}/replace-source`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ youtubeUrl: 'https://youtu.be/CWG-GDfejmY?si=K1vetd6tzVTYb9DB' }),
      });
      assert.strictEqual(resp.status, 200);
      const body = (await resp.json()) as any;
      assert.strictEqual(body.success, true);
      assert.strictEqual(receivedFormatArg, 'mp3', 'Normalized format "MPEG" -> "mp3" instead of raw container string');

      const expectedMainFlac = path.join(artistDir, 'Replace Flac Artist - Midnight Echo.flac');
      const expectedInstMp3 = path.join(artistDir, 'Replace Flac Artist - Midnight Echo (Instrumental).mp3');
      assert.strictEqual(body.originalPath, expectedMainFlac);
      assert.strictEqual(body.instrumentalPath, expectedInstMp3);

      // Main recording is real FLAC
      const mainProbe = await probeAudio(expectedMainFlac);
      assert.strictEqual(mainProbe.format?.format_name, 'flac');
      assert.strictEqual(mainProbe.streams?.[0]?.codec_name, 'flac');

      // Instrumental is real MP3
      await assertRealMp3File(expectedInstMp3);

      // Obsolete old main .mp3 was cleaned up
      assert.strictEqual(fs.existsSync(oldMainMp3), false, 'Old .mp3 main file removed when replaced by .flac');

      // DB metadata reflects FLAC main & MP3 instrumental
      const updated = (await db.select().from(songs).where(eq(songs.id, songRow.id)))[0];
      assert.strictEqual(updated.mainAudioPath, expectedMainFlac);
      assert.strictEqual(updated.instrumentalAudioPath, expectedInstMp3);
      assert.strictEqual(updated.format, 'FLAC');

      // Verified source saved after commit
      const verified = await db.select().from(songVerifiedSources).where(eq(songVerifiedSources.songId, songRow.id));
      assert.strictEqual(verified.length, 1);
      assert.strictEqual(verified[0].videoId, 'CWG-GDfejmY');
    } finally {
      downloadQueue.downloadSingleTrackAudio = origDownload;
    }
  });

  await t.test('Replace Audio: M4A recording ("M4A/isom/iso2") normalizes download format to "m4a", preserves .m4a main, and produces real .mp3 instrumental', async () => {
    installRealFFmpegDemucsStub();
    demucsShouldFail = false;

    const artistDir = path.join(libraryDir, 'Replace M4a Artist');
    fs.mkdirSync(artistDir, { recursive: true });
    const oldMainM4a = path.join(artistDir, 'Replace M4a Artist - Neon Drift.m4a');
    await createSampleM4a(oldMainM4a, coverPath, {
      title: 'Neon Drift',
      artist: 'Replace M4a Artist',
      album: 'Drive EP',
    });

    const art = (await db.insert(artists).values({ name: 'Replace M4a Artist' }).returning())[0];
    const alb = (await db.insert(albums).values({ artistId: art.id, title: 'Drive EP' }).returning())[0];
    const songRow = (
      await db
        .insert(songs)
        .values({
          libraryId,
          artistId: art.id,
          albumId: alb.id,
          title: 'Neon Drift',
          mainAudioPath: oldMainM4a,
          instrumentalAudioPath: null,
          duration: 1,
          format: 'M4A/isom/iso2',
          variant: 'original',
          fileSize: fs.statSync(oldMainM4a).size,
        })
        .returning()
    )[0];
    await db.insert(songArtists).values({ songId: songRow.id, artistId: art.id, position: 0 });

    let receivedFormatArg = '';
    downloadQueue.downloadSingleTrackAudio = async (_url, outDir, format) => {
      receivedFormatArg = format;
      const dlM4a = path.join(outDir, `audio_${Date.now()}.m4a`);
      await createSampleM4a(dlM4a, coverPath, {
        title: 'Neon Drift',
        artist: 'Replace M4a Artist',
        album: 'Drive EP',
      });
      return dlM4a;
    };

    try {
      const res = await replaceSongRecordingSource(songRow.id, 'https://www.youtube.com/watch?v=rYEDA3JcQqw');
      assert.strictEqual(res.success, true, `Expected M4A replace audio to succeed, got: ${res.error}`);
      assert.strictEqual(receivedFormatArg, 'm4a', 'Format passed to downloadSingleTrackAudio must be "m4a"');

      const expectedMainM4a = path.join(artistDir, 'Replace M4a Artist - Neon Drift.m4a');
      const expectedInstMp3 = path.join(artistDir, 'Replace M4a Artist - Neon Drift (Instrumental).mp3');
      assert.strictEqual(res.originalPath, expectedMainM4a);
      assert.strictEqual(res.instrumentalPath, expectedInstMp3);

      const mainProbe = await probeAudio(expectedMainM4a);
      assert.ok((mainProbe.format?.format_name || '').includes('mp4'), 'Main audio container is M4A/MP4');
      assert.strictEqual(mainProbe.streams?.[0]?.codec_name, 'aac');

      await assertRealMp3File(expectedInstMp3);

      const updated = (await db.select().from(songs).where(eq(songs.id, songRow.id)))[0];
      assert.strictEqual(updated.mainAudioPath, expectedMainM4a);
      assert.strictEqual(updated.instrumentalAudioPath, expectedInstMp3);
      assert.strictEqual(updated.format, 'M4A/isom/iso2');
    } finally {
      downloadQueue.downloadSingleTrackAudio = origDownload;
    }
  });

  await t.test('Failure & Rollback + Temp Cleanup: separation failure and FFmpeg failure preserve existing files & DB without leaking temp files', async () => {
    installRealFFmpegDemucsStub();

    const artistDir = path.join(libraryDir, 'Rollback Artist');
    fs.mkdirSync(artistDir, { recursive: true });
    const mainFlac = path.join(artistDir, 'Rollback Artist - Safe Track.flac');
    const existingInstMp3 = path.join(artistDir, 'Rollback Artist - Safe Track (Instrumental).mp3');

    await createSampleFlac(mainFlac, coverPath, {
      title: 'Safe Track',
      artist: 'Rollback Artist',
      album: 'Safe Album',
    });
    const stemWav = path.join(testDataDir, 'safe_stem.wav');
    await createSampleWav(stemWav);
    await createInstrumentalWithFFmpeg(mainFlac, stemWav, existingInstMp3, {
      title: 'Safe Track',
      artist: 'Rollback Artist',
      album: 'Safe Album',
    });
    const preInstBytes = fs.readFileSync(existingInstMp3);

    const art = (await db.insert(artists).values({ name: 'Rollback Artist' }).returning())[0];
    const songRow = (
      await db
        .insert(songs)
        .values({
          libraryId,
          artistId: art.id,
          title: 'Safe Track',
          mainAudioPath: mainFlac,
          instrumentalAudioPath: existingInstMp3,
          duration: 1,
          format: 'FLAC',
          variant: 'original',
          fileSize: fs.statSync(mainFlac).size,
        })
        .returning()
    )[0];
    await db.insert(songArtists).values({ songId: songRow.id, artistId: art.id, position: 0 });

    // 1. Demucs separation failure
    demucsShouldFail = true;
    const failRes = await replaceSongInstrumental(songRow.id);
    assert.strictEqual(failRes.success, false);
    assert.strictEqual(Buffer.compare(fs.readFileSync(existingInstMp3), preInstBytes), 0, 'Existing instrumental preserved on failure');
    const afterFailSong = (await db.select().from(songs).where(eq(songs.id, songRow.id)))[0];
    assert.strictEqual(afterFailSong.instrumentalAudioPath, existingInstMp3);
    assert.strictEqual(afterFailSong.format, 'FLAC');

    // 2. FFmpeg invalid stem failure cleans up .tmp.*.mp3
    const bogusStem = path.join(testDataDir, 'bogus_stem.wav');
    fs.writeFileSync(bogusStem, 'not valid audio');
    const ffmpegFailOut = path.join(artistDir, 'Should Not Exist (Instrumental).mp3');
    await assert.rejects(() =>
      createInstrumentalWithFFmpeg(mainFlac, bogusStem, ffmpegFailOut, {
        title: 'Fail Track',
        artist: 'Rollback Artist',
      })
    );
    assert.strictEqual(fs.existsSync(ffmpegFailOut), false);
    const leftoverFiles = fs.readdirSync(artistDir).filter((f) => f.includes('.tmp.') || f.includes('.bak_'));
    assert.deepStrictEqual(leftoverFiles, [], 'No leftover temp or backup files in artist dir');

    // Verify no tmp_inst_* or tmp_replace_* directories leaked under data/
    const dataRoot = path.join(process.cwd(), 'data');
    if (fs.existsSync(dataRoot)) {
      const strayReplaceDirs = fs
        .readdirSync(dataRoot)
        .filter((d) => d.startsWith(`tmp_inst_${songRow.id}_`) || d.startsWith(`tmp_replace_${songRow.id}_`));
      assert.deepStrictEqual(strayReplaceDirs, [], 'No leaked staging directories');
    }
  });

  await t.test('FFmpeg fallback path still produces genuine MP3 when primary artwork mux input fails', async () => {
    const stemWav = path.join(testDataDir, 'fallback_stem.wav');
    await createSampleWav(stemWav);
    const missingOrig = path.join(testDataDir, 'nonexistent_original.flac');
    const fallbackOut = path.join(testDataDir, 'Fallback Track (Instrumental).mp3');

    await createInstrumentalWithFFmpeg(missingOrig, stemWav, fallbackOut, {
      title: 'Fallback Track',
      artist: 'Fallback Artist',
      album: 'Fallback Album',
    });

    await assertRealMp3File(fallbackOut);
  });
});
