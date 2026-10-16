import path from 'path';
import fs from 'fs';

export const isPreviewMode = process.env.PREVIEW_MODE === 'true';

// Use a separate directory for preview data if enabled
export const previewDataDir = isPreviewMode ? path.resolve(process.cwd(), 'preview-data') : null;
export const templateSongPath = path.resolve(process.cwd(), 'server', 'lib', 'template.mp3');

export function ensurePreviewDirectories() {
  if (isPreviewMode && previewDataDir) {
    if (!fs.existsSync(previewDataDir)) {
      fs.mkdirSync(previewDataDir, { recursive: true });
    }
    const dirs = ['artwork', 'playlist_covers', 'fonts', 'media', 'temp', 'tmp_downloads'];
    for (const dir of dirs) {
      const dirPath = path.join(previewDataDir, dir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    }
    console.log('--- PREVIEW MODE ENABLED: Data isolated to', previewDataDir, '---');
  }
}

export function simulateDownload(destination: string) {
  if (!fs.existsSync(templateSongPath)) {
    throw new Error(`Preview template file not found at ${templateSongPath}. Cannot simulate download.`);
  }
  fs.copyFileSync(templateSongPath, destination);
  console.log(`[PREVIEW] Simulated download: Copied ${templateSongPath} to ${destination}`);
}
