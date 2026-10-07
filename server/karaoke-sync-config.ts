import path from 'path';

export function getAppPythonPath(): string {
  if (process.env.PYTHON_BIN) {
    return process.env.PYTHON_BIN;
  }
  return 'python3';
}

export function getSplitScriptPath(): string {
  return path.join(process.cwd(), 'server', 'lib', 'split.py');
}

export function getModelsDir(): string {
  if (process.env.TORCH_HOME) {
    return process.env.TORCH_HOME;
  }
  return path.join(process.cwd(), 'data', 'models');
}

export function getSettings() {
  return {
    pythonPath: getAppPythonPath(),
    splitScriptPath: getSplitScriptPath(),
    modelsDir: getModelsDir(),
    ffmpegPath: 'ffmpeg',
    demucs: {
      model: 'htdemucs',
      stems: 'vocals',
      format: 'flac',
      mp3Bitrate: 320,
      shifts: 1,
      overlap: 0.25,
      useGpu: true,
    },
    lyrics: {
      fetchElrc: true,
      fetchLrc: true,
      overwriteExisting: false,
      elrcLineLeadInMs: 500,
    },
  };
}
