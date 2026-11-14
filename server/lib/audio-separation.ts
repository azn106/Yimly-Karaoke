import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import * as mm from 'music-metadata';
import { demucsWorkerManager } from './demucs-worker.js';
import { getSettings } from '../karaoke-sync-config.js';
import { isPreviewMode, templateSongPath } from './preview-mode.js';

export interface SeparationResult {
  ok: boolean;
  instrumentalPath?: string;
  error?: string;
  cudaDevice?: string;
}

/**
 * Verifies that a file exists, is non-trivial in size, and actually contains MP3 audio.
 */
export async function verifyValidMp3File(filePath: string): Promise<void> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Instrumental MP3 file does not exist: ${filePath}`);
  }
  const stats = fs.statSync(filePath);
  if (stats.size <= 1024) {
    throw new Error(`Instrumental MP3 file is empty or too small (${stats.size} bytes): ${filePath}`);
  }

  let isMp3 = false;
  try {
    const metadata = await mm.parseFile(filePath, { duration: true });
    const container = (metadata.format.container || '').toUpperCase();
    const codec = (metadata.format.codec || '').toUpperCase();
    if (container === 'MPEG' || codec.includes('MPEG') || codec.includes('MP3')) {
      isMp3 = true;
    }
  } catch {
    // Fall through to header inspection
  }

  if (!isMp3) {
    // Inspect leading bytes for ID3v2 header or MPEG audio frame sync (0xFF 0xE0..0xFF)
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(16);
      const bytesRead = fs.readSync(fd, buf, 0, 16, 0);
      if (bytesRead >= 3 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
        isMp3 = true; // ID3v2 tag
      } else if (bytesRead >= 2 && buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) {
        isMp3 = true; // Raw MPEG frame sync
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  if (!isMp3) {
    throw new Error(`Generated instrumental file does not contain valid MP3 audio: ${filePath}`);
  }
}

/**
 * Checks if NVIDIA GPU is present and CUDA is available in PyTorch.
 * Strictly verifies CUDA tensor operations.
 */
let cachedCudaCheck: { available: boolean; deviceName?: string; error?: string } | null = null;

export async function checkCudaAvailability(pythonBin?: string): Promise<{ available: boolean; deviceName?: string; error?: string }> {
  if (cachedCudaCheck && cachedCudaCheck.available) {
    return cachedCudaCheck;
  }
  const py = pythonBin || getSettings().pythonPath;
  return new Promise((resolve) => {
    const pyScript = `import sys, json
try:
    import numpy
    import torch
    import demucs
    avail = torch.cuda.is_available()
    cnt = torch.cuda.device_count()
    if avail and cnt > 0:
        name = torch.cuda.get_device_name(0)
        # Test tensor compute
        x = torch.ones((256, 256), device='cuda')
        y = torch.matmul(x, x)
        torch.cuda.synchronize()
        del x, y
        torch.cuda.empty_cache()
        print("###CUDA###" + json.dumps({"available": True, "name": name}))
    else:
        print("###CUDA###" + json.dumps({"available": False, "error": f"CUDA not available (is_available={avail}, count={cnt})"}))
except Exception as e:
    print("###CUDA###" + json.dumps({"available": False, "error": str(e)}))
`;
    const proc = spawn(py, ['-c', pyScript]);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      const match = stdout.match(/###CUDA###(.*?)$/m);
      if (match && match[1]) {
        try {
          const parsed = JSON.parse(match[1]);
          if (parsed.available) {
            cachedCudaCheck = parsed;
          }
          resolve(parsed);
          return;
        } catch {}
      }
      resolve({ available: false, error: stderr || stdout || `Python execution failed with code ${code}` });
    });
    proc.on('error', (err) => {
      resolve({ available: false, error: err.message });
    });
  });
}

export const audioSeparationHooks = {
  checkCudaAvailability: (pythonBin?: string) => checkCudaAvailability(pythonBin),
};

export interface InstrumentalMetadataTags {
  title: string;
  artist: string;
  album?: string;
  trackNumber?: number;
  discNumber?: number;
  year?: number;
}

export interface SeparationOptions {
  signal?: AbortSignal;
  isCancelled?: () => boolean;
  onLog?: (level: 'INFO' | 'WARN' | 'ERR', msg: string) => void;
}

function getDataTempRoot(): string {
  const base = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(process.cwd(), 'data');
  return path.join(base, 'tmp_downloads');
}

function buildInstrumentalMetadataArgs(tags: InstrumentalMetadataTags): string[] {
  const instrumentalTitle = `${tags.title} (Instrumental)`;
  const args: string[] = [
    '-metadata', `title=${instrumentalTitle}`,
    '-metadata', `artist=${tags.artist || ''}`,
    '-metadata', `album=${tags.album || ''}`,
  ];
  if (tags.trackNumber && Number.isFinite(tags.trackNumber)) {
    args.push('-metadata', `track=${Math.floor(tags.trackNumber)}`);
  }
  if (tags.discNumber && Number.isFinite(tags.discNumber)) {
    args.push('-metadata', `disc=${Math.floor(tags.discNumber)}`);
  }
  if (tags.year && Number.isFinite(tags.year)) {
    args.push('-metadata', `date=${Math.floor(tags.year)}`);
  }
  args.push(
    '-metadata', 'lyrics=',
    '-metadata', 'LYRICS=',
    '-metadata', 'unsyncedlyrics=',
    '-metadata', 'UNSYNCEDLYRICS=',
    '-metadata', 'comment=YIMLY_VARIANT=instrumental',
    '-metadata', 'YIMLY_VARIANT=instrumental'
  );
  return args;
}

/**
 * Creates instrumental using FFmpeg from isolated stem audio and original audio (for tags/artwork).
 * Always encodes output as MP3 (libmp3lame 320k) and enforces a .mp3 extension.
 */
export async function createInstrumentalWithFFmpeg(
  originalAudioPath: string,
  isolatedStemPath: string,
  outputPath: string,
  tags: InstrumentalMetadataTags
): Promise<void> {
  if (!outputPath.toLowerCase().endsWith('.mp3')) {
    throw new Error(`Instrumental output path must use a .mp3 extension, received: ${outputPath}`);
  }

  const ffmpegPath = getSettings().ffmpegPath || 'ffmpeg';
  const tempOutputPath = `${outputPath}.tmp.${Date.now()}_${Math.random().toString(36).substring(2, 7)}.mp3`;

  const cleanupTemp = () => {
    try {
      if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
    } catch {}
  };

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const metadataArgs = buildInstrumentalMetadataArgs(tags);

  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-threads', '2',
      '-i', isolatedStemPath,
      '-i', originalAudioPath,
      '-map', '0:a:0',
      '-map', '1:v:0?',
      '-c:v', 'copy',
      '-disposition:v:0', 'attached_pic',
      '-c:a', 'libmp3lame',
      '-b:a', '320k',
      '-id3v2_version', '3',
      ...metadataArgs,
      '-f', 'mp3',
      tempOutputPath,
    ];

    let timedOut = false;
    const child = spawn(ffmpegPath, args);
    const watchdog = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      cleanupTemp();
      reject(new Error('FFmpeg instrumental encoding timed out'));
    }, 300000); // 5 minutes

    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(watchdog);
      cleanupTemp();
      if (!timedOut) reject(err);
    });
    child.on('close', async (code) => {
      clearTimeout(watchdog);
      if (timedOut) return;
      if (code === 0 && fs.existsSync(tempOutputPath)) {
        try {
          await verifyValidMp3File(tempOutputPath);
          fs.renameSync(tempOutputPath, outputPath);
          resolve();
          return;
        } catch {}
      }
      cleanupTemp();

      // Fallback simple conversion without original artwork/video stream if mux failed
      const fbArgs = [
        '-y',
        '-threads', '2',
        '-i', isolatedStemPath,
        '-c:a', 'libmp3lame',
        '-b:a', '320k',
        '-id3v2_version', '3',
        ...metadataArgs,
        '-f', 'mp3',
        tempOutputPath,
      ];
      let fbTimedOut = false;
      let fbStderr = '';
      const fbChild = spawn(ffmpegPath, fbArgs);
      const fbWatchdog = setTimeout(() => {
        fbTimedOut = true;
        fbChild.kill('SIGKILL');
        cleanupTemp();
        reject(new Error('FFmpeg instrumental fallback encoding timed out'));
      }, 300000); // 5 minutes
      fbChild.stderr.on('data', (d) => { fbStderr += d.toString(); });
      fbChild.on('close', async (fbCode) => {
        clearTimeout(fbWatchdog);
        if (fbTimedOut) return;
        if (fbCode === 0 && fs.existsSync(tempOutputPath)) {
          try {
            await verifyValidMp3File(tempOutputPath);
            fs.renameSync(tempOutputPath, outputPath);
            resolve();
            return;
          } catch (valErr: any) {
            cleanupTemp();
            reject(new Error(`FFmpeg instrumental fallback output failed MP3 verification: ${valErr?.message || valErr}`));
            return;
          }
        }
        cleanupTemp();
        reject(new Error(`FFmpeg instrumental encoding failed with code ${fbCode}: ${fbStderr || stderr}`));
      });
      fbChild.on('error', (e) => {
        clearTimeout(fbWatchdog);
        cleanupTemp();
        if (!fbTimedOut) reject(e);
      });
    });
  });
}

/**
 * Separates audio using Demucs (mandatory GPU, serialized across all callers via shared lock)
 * and generates a verified instrumental MP3.
 */
export async function separateAndCreateInstrumental(
  audioPath: string,
  targetInstrumentalPath: string,
  tags: InstrumentalMetadataTags,
  onProgress?: (pct: number, msg: string) => void,
  options?: SeparationOptions
): Promise<SeparationResult> {
  if (!targetInstrumentalPath.toLowerCase().endsWith('.mp3')) {
    return {
      ok: false,
      error: `Target instrumental path must end with .mp3, received: ${targetInstrumentalPath}`,
    };
  }

  if (options?.signal?.aborted || options?.isCancelled?.()) {
    return { ok: false, error: 'Instrumental separation cancelled.' };
  }

  const settings = getSettings();
  const pythonBin = settings.pythonPath;
  const modelsDir = settings.modelsDir;

  let cudaDevice: string | undefined = undefined;
  // 1. Strict GPU validation: Demucs MUST use NVIDIA GPU. No CPU fallback.
  if (!isPreviewMode) {
    const cudaCheck = await audioSeparationHooks.checkCudaAvailability(pythonBin);
    if (!cudaCheck.available) {
      const errMsg = `NVIDIA GPU / CUDA is required for Demucs separation but is unavailable: ${cudaCheck.error || 'No CUDA device detected'}. Demucs CPU fallback is strictly disabled.`;
      console.error(`[Demucs] ${errMsg}`);
      return { ok: false, error: errMsg };
    }
    cudaDevice = cudaCheck.deviceName;
  }

  const targetDir = path.dirname(targetInstrumentalPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // 2. Preview simulation
  if (isPreviewMode) {
    fs.copyFileSync(templateSongPath, targetInstrumentalPath);
    await verifyValidMp3File(targetInstrumentalPath);
    console.log(`[PREVIEW] Simulated audio separation: Copied ${templateSongPath} to ${targetInstrumentalPath}`);
    return { ok: true, instrumentalPath: targetInstrumentalPath };
  }

  const jobTempDir = path.join(getDataTempRoot(), `demucs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
  fs.mkdirSync(jobTempDir, { recursive: true });

  const reqFile = path.join(jobTempDir, 'split_request.json');
  const statusFile = path.join(jobTempDir, 'split_status.json');

  const splitReq = {
    audio: audioPath,
    out_dir: jobTempDir,
    model: 'htdemucs',
    stems: 'vocals', // 2-stem vocal separation -> vocals and no_vocals
    format: 'wav',
    shifts: 1,
    overlap: 0.25,
    use_gpu: true,
  };

  fs.writeFileSync(reqFile, JSON.stringify(splitReq), 'utf-8');

  try {
    if (onProgress) onProgress(15, 'Waiting for Demucs GPU separation queue...');

    await demucsWorkerManager.runWithLock(async () => {
      if (options?.signal?.aborted || options?.isCancelled?.()) {
        throw new Error('Instrumental separation cancelled.');
      }

      if (onProgress) onProgress(20, 'Separating vocals and accompaniment with Demucs (GPU)...');

      await demucsWorkerManager.runJob(
        pythonBin,
        reqFile,
        statusFile,
        modelsDir,
        (pct, msg) => {
          if (onProgress) onProgress(20 + Math.round(pct * 0.6), msg);
        },
        (level, msg) => {
          options?.onLog?.(level, msg);
          console.log(`[Demucs Worker ${level}] ${msg}`);
        },
        { signal: options?.signal, isCancelled: options?.isCancelled }
      );
    }, { signal: options?.signal, isCancelled: options?.isCancelled });

    // Locate the no_vocals stem
    const baseAudioName = path.basename(audioPath, path.extname(audioPath));
    const htdemucsOutDir = path.join(jobTempDir, 'htdemucs', baseAudioName);
    const noVocalsStem = path.join(htdemucsOutDir, 'no_vocals.wav');

    if (!fs.existsSync(noVocalsStem)) {
      throw new Error(`Demucs finished but no_vocals.wav was not found at ${noVocalsStem}`);
    }

    if (onProgress) onProgress(85, 'Encoding final instrumental MP3 with FFmpeg...');

    // 3. Generate final instrumental MP3 with FFmpeg
    await createInstrumentalWithFFmpeg(audioPath, noVocalsStem, targetInstrumentalPath, tags);

    // 4. Verify output file exists and contains valid MP3 audio
    await verifyValidMp3File(targetInstrumentalPath);

    return { ok: true, instrumentalPath: targetInstrumentalPath, cudaDevice };
  } catch (err: any) {
    console.error('[Demucs] Separation error:', err);
    try {
      if (fs.existsSync(targetInstrumentalPath)) {
        fs.unlinkSync(targetInstrumentalPath);
      }
    } catch {}
    return { ok: false, error: err.message };
  } finally {
    try {
      if (fs.existsSync(jobTempDir)) {
        await fs.promises.rm(jobTempDir, { recursive: true, force: true });
      }
    } catch {}
  }
}
