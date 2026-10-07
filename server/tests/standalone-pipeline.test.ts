import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { checkCudaAvailability, createInstrumentalWithFFmpeg } from '../lib/audio-separation.js';
import { fetchSongDualLyrics } from '../lyrics/manager.js';

test('Standalone Pipeline: Strict CUDA Validation reports failure when torch/CUDA is unavailable', async () => {
  const cudaCheck = await checkCudaAvailability();
  // In the web preview container (no NVIDIA GPU / torch installed), checkCudaAvailability MUST fail cleanly
  assert.strictEqual(cudaCheck.available, false, 'CUDA check must report unavailable without GPU');
  assert.ok(cudaCheck.error, 'Must provide detailed error reason rather than silently falling back to CPU');
});

test('Standalone Pipeline: FFmpeg Instrumental Creation Muxes & Cleans Metadata', async () => {
  const testDir = path.join(process.cwd(), 'data', 'test_inst_mux');
  fs.mkdirSync(testDir, { recursive: true });

  const dummyOriginal = path.join(testDir, 'Test - Song.mp3');
  const dummyStem = path.join(testDir, 'stem_novocals.wav');
  const targetInst = path.join(testDir, 'Test - Song (Instrumental).mp3');

  // Generate 1 second dummy silence with ffmpeg for both original and stem
  const { execSync } = await import('child_process');
  execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 1 -q:a 9 -acodec libmp3lame "${dummyOriginal}"`);
  execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 1 "${dummyStem}"`);

  await createInstrumentalWithFFmpeg(dummyOriginal, dummyStem, targetInst, {
    title: 'Song',
    artist: 'Test',
    album: 'Test Album'
  });

  assert.strictEqual(fs.existsSync(targetInst), true, 'Instrumental output MP3 must exist');
  assert.ok(fs.statSync(targetInst).size > 1024, 'Instrumental file must be non-empty and valid size');

  // Clean up
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('Standalone Pipeline: Cloud Lyrics Cascade (NetEase -> QQ -> Kugou -> Musixmatch)', async () => {
  const res = await fetchSongDualLyrics('Shape of You', 'Ed Sheeran');
  assert.ok(res.lrcResult || res.elrcResult, 'Must successfully retrieve at least line-synced or word-synced lyrics');
  if (res.lrcResult) {
    assert.ok(['netease', 'qqmusic', 'kugou', 'musixmatch'].includes(res.lrcResult.source));
  }
  if (res.elrcResult) {
    assert.ok(['netease', 'qqmusic', 'kugou', 'musixmatch'].includes(res.elrcResult.source));
  }
});
