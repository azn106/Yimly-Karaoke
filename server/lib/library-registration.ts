import fs from 'fs';
import path from 'path';
import { db } from '../db/index.js';
import { libraries, songs } from '../db/schema.js';
import { scanLibrary } from './scanner.js';
import { eq } from 'drizzle-orm';

export async function registerSampleLibraryIfNeeded(isProd: boolean) {
  const shouldRegisterSample = !isProd && process.env.AUTO_REGISTER_SAMPLE_LIBRARY === 'true';
  if (!shouldRegisterSample) {
    return;
  }

  const sampleDir = path.resolve(process.cwd(), 'sample');
  if (!fs.existsSync(sampleDir)) {
    console.log('[Library] Sample directory not found at:', sampleDir);
    return;
  }

  const existingLibs = await db.select().from(libraries);
  let sampleLib = existingLibs.find(l => l.path === sampleDir || l.name === 'Sample Library');

  if (!sampleLib) {
    if (existingLibs.length > 0) {
      const placeholderLib = existingLibs.find(l => l.path === '/media' && (l.name === 'Sample' || l.name === 'Sample Library'));
      if (placeholderLib) {
        console.log('[Library] Updating placeholder sample library path to:', sampleDir);
        await db.update(libraries).set({ path: sampleDir, name: 'Sample Library' }).where(eq(libraries.id, placeholderLib.id));
        sampleLib = { ...placeholderLib, path: sampleDir, name: 'Sample Library' };
      } else {
        // User library exists; do not overwrite or add sample library
        return;
      }
    } else {
      console.log('[Library] Auto-registering Sample Library...');
      const [inserted] = await db.insert(libraries).values({
        name: 'Sample Library',
        path: sampleDir,
      }).returning();
      sampleLib = inserted;
    }
  }

  if (sampleLib) {
    const librarySongs = await db.select().from(songs).where(eq(songs.libraryId, sampleLib.id));
    if (librarySongs.length === 0) {
      console.log(`[Library] Scanning library at: ${sampleLib.path}`);
      await scanLibrary(sampleLib.id, sampleLib.path);
      console.log(`[Library] Library scan completed.`);
    }
  }
}
