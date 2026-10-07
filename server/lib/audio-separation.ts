import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { demucsWorkerManager } from './demucs-worker.js';
import { getSettings } from '../karaoke-sync-config.js';

export interface SeparationResult {
  ok: boolean;
  instrumentalPath?: string;
  error?: string;
  cudaDevice?: string;
}

/**
 * Checks if NVIDIA GPU is present and CUDA is available in PyTorch.
 * Strictly verifies CUDA tensor operations.
 */
export async function checkCudaAvailability(pythonBin?: string): Promise<{ available: boolean; deviceName?: string; error?: string }> {
  const py = pythonBin || getSettings().pythonPath;
  return new Promise((resolve) => {
    const pyScript = `import sys, json
try:
    import torch
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

/**
 * Creates instrumental using FFmpeg from isolated stem audio and original MP3 (for tags/artwork).
 */
export async function createInstrumentalWithFFmpeg(
  originalAudioPath: string,
  isolatedStemPath: string,
  outputPath: string,
  tags: { title: string; artist: string; album?: string }
): Promise<void> {
  const ffmpegPath = getSettings().ffmpegPath || 'ffmpeg';
  const instrumentalTitle = `${tags.title} (Instrumental)`;
  const tempOutputPath = `${outputPath}.tmp.${Date.now()}_${Math.random().toString(36).substring(2, 7)}.mp3`;

  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-i', isolatedStemPath,
      '-i', originalAudioPath,
      '-map', '0:a:0',
      '-map', '1:v:0?',
      '-c:v', 'copy',
      '-disposition:v:0', 'attached_pic',
      '-c:a', 'libmp3lame',
      '-b:a', '320k',
      '-metadata', `title=${instrumentalTitle}`,
      '-metadata', `artist=${tags.artist || ''}`,
      '-metadata', `album=${tags.album || ''}`,
      '-metadata', 'lyrics=',
      '-metadata', 'LYRICS=',
      '-metadata', 'unsyncedlyrics=',
      '-metadata', 'UNSYNCEDLYRICS=',
      '-metadata', 'comment=',
      tempOutputPath,
    ];

    const child = spawn(ffmpegPath, args);
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      try { if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath); } catch {}
      reject(err);
    });
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(tempOutputPath)) {
        try {
          const stats = fs.statSync(tempOutputPath);
          if (stats.size > 1024) {
            fs.renameSync(tempOutputPath, outputPath);
            resolve();
            return;
          }
        } catch {}
      }
      try { if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath); } catch {}

      // Fallback simple conversion without original tags if mux failed
      const fbArgs = [
        '-y',
        '-i', isolatedStemPath,
        '-c:a', 'libmp3lame',
        '-b:a', '320k',
        '-metadata', `title=${instrumentalTitle}`,
        '-metadata', `artist=${tags.artist || ''}`,
        tempOutputPath,
      ];
      const fbChild = spawn(ffmpegPath, fbArgs);
      fbChild.on('close', (fbCode) => {
        if (fbCode === 0 && fs.existsSync(tempOutputPath)) {
          fs.renameSync(tempOutputPath, outputPath);
          resolve();
        } else {
          try { if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath); } catch {}
          reject(new Error(`FFmpeg instrumental encoding failed with code ${fbCode}: ${stderr}`));
        }
      });
      fbChild.on('error', (e) => reject(e));
    });
  });
}

/**
 * Separates audio using Demucs (mandatory GPU) and generates instrumental MP3.
 */
export async function separateAndCreateInstrumental(
  audioPath: string,
  targetInstrumentalPath: string,
  tags: { title: string; artist: string; album?: string },
  onProgress?: (pct: number, msg: string) => void
): Promise<SeparationResult> {
  const settings = getSettings();
  const pythonBin = settings.pythonPath;
  const modelsDir = settings.modelsDir;

  // 1. Strict GPU validation: Demucs MUST use NVIDIA GPU. No CPU fallback.
  const cudaCheck = await checkCudaAvailability(pythonBin);
  if (!cudaCheck.available) {
    const errMsg = `NVIDIA GPU / CUDA is required for Demucs separation but is unavailable: ${cudaCheck.error || 'No CUDA device detected'}. Demucs CPU fallback is strictly disabled.`;
    console.error(`[Demucs] ${errMsg}`);
    return { ok: false, error: errMsg };
  }

  // 2. Prepare temporary directory for stems
  const jobTempDir = path.join(process.cwd(), 'data', 'tmp_downloads', `demucs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
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
        console.log(`[Demucs Worker ${level}] ${msg}`);
      }
    );

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

    // 4. Verify output file exists and is usable
    if (!fs.existsSync(targetInstrumentalPath) || fs.statSync(targetInstrumentalPath).size <= 1024) {
      throw new Error(`Generated instrumental file is invalid or missing at ${targetInstrumentalPath}`);
    }

    return { ok: true, instrumentalPath: targetInstrumentalPath, cudaDevice: cudaCheck.deviceName };
  } catch (err: any) {
    console.error('[Demucs] Separation error:', err);
    return { ok: false, error: err.message };
  } finally {
    try {
      if (fs.existsSync(jobTempDir)) {
        fs.rmSync(jobTempDir, { recursive: true, force: true });
      }
    } catch {}
  }
}
