import fs from 'fs';
import path from 'path';
import { db } from '../db/index.js';
import { songs, albums, artists, libraries, lyrics } from '../db/schema.js';
import { eq, or } from 'drizzle-orm';
import { getOrCreateArtist, syncSongArtists } from './artist-utils.js';
import { cleanSongTitle, normalizeSongTitle } from './canonical-metadata.js';

export { getOrCreateArtist, syncSongArtists, cleanSongTitle, normalizeSongTitle };

class SupportedAudioExtsSet extends Set<string> {
  includes(val: string): boolean {
    return this.has(val);
  }
}

export const SUPPORT_AUDIO_EXTS = ['.mp3', '.m4a', '.flac', '.wav', '.ogg'];
export const SUPPORTED_AUDIO_EXTS = new SupportedAudioExtsSet(SUPPORT_AUDIO_EXTS);

export function getArtworkDir(): string {
  const dataDir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(process.cwd(), 'data');
  const artworkDir = path.join(dataDir, 'artwork');
  if (!fs.existsSync(artworkDir)) {
    fs.mkdirSync(artworkDir, { recursive: true });
  }
  return artworkDir;
}

export async function saveArtworkBuffer(buf: Buffer, contentType?: string): Promise<string> {
  const artworkDir = getArtworkDir();
  let ext = '.jpg';
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('png') || (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)) {
    ext = '.png';
  } else if (ct.includes('webp') || (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')) {
    ext = '.webp';
  } else if (ct.includes('gif') || (buf.length >= 6 && buf.toString('ascii', 0, 3) === 'GIF')) {
    ext = '.gif';
  }
  const filename = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
  const filePath = path.join(artworkDir, filename);
  await fs.promises.writeFile(filePath, buf);
  return filename;
}

export async function scanLibrary(libraryId: number, libraryPath: string): Promise<void> {
  if (!fs.existsSync(libraryPath)) return;
  const entries = fs.readdirSync(libraryPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const artistName = entry.name;
      const artistDir = path.join(libraryPath, artistName);
      const artistId = await getOrCreateArtist(artistName);

      const subEntries = fs.readdirSync(artistDir, { withFileTypes: true });
      for (const sub of subEntries) {
        if (sub.isFile()) {
          const ext = path.extname(sub.name).toLowerCase();
          if (SUPPORTED_AUDIO_EXTS.has(ext)) {
            const audioPath = path.join(artistDir, sub.name);
            const title = path.basename(sub.name, ext);
            await importAudioFileRecord(libraryId, artistId, title, audioPath);
          }
        }
      }
    }
  }
}

export async function importSingleAudioFile(libraryId: number, filePath: string): Promise<number> {
  const ext = path.extname(filePath);
  const title = path.basename(filePath, ext);
  const parentDir = path.dirname(filePath);
  const artistName = path.basename(parentDir) || 'Unknown Artist';
  const artistId = await getOrCreateArtist(artistName);
  return await importAudioFileRecord(libraryId, artistId, title, filePath);
}

export async function importSingleLrcFile(_libraryId: number, filePath: string): Promise<void> {
  const ext = path.extname(filePath);
  const base = filePath.replace(/\.(lrc|elrc)$/, '');
  for (const audioExt of SUPPORT_AUDIO_EXTS) {
    const audioPath = base + audioExt;
    const [song] = await db.select().from(songs).where(eq(songs.mainAudioPath, audioPath)).limit(1);
    if (song) {
      const [existingLyr] = await db.select().from(lyrics).where(eq(lyrics.songId, song.id)).limit(1);
      const isElrc = filePath.endsWith('.elrc') || filePath.endsWith('.elrc.lrc');
      if (existingLyr) {
        await db.update(lyrics).set({
          ...(isElrc ? { elrcPath: filePath } : { lrcPath: filePath }),
        }).where(eq(lyrics.id, existingLyr.id));
      } else {
        await db.insert(lyrics).values({
          songId: song.id,
          lrcPath: isElrc ? '' : filePath,
          elrcPath: isElrc ? filePath : '',
        });
      }
      break;
    }
  }
}

export async function removeSingleFile(_libraryId: number, filePath: string): Promise<void> {
  await db.delete(songs).where(or(eq(songs.mainAudioPath, filePath), eq(songs.instrumentalAudioPath, filePath)));
}

export async function findExistingSongRecord(audioPath: string): Promise<any> {
  const [song] = await db.select().from(songs).where(or(eq(songs.mainAudioPath, audioPath), eq(songs.instrumentalAudioPath, audioPath))).limit(1);
  return song || null;
}

export async function reconcileDuplicateSongs(): Promise<void> {}
export async function withSongLock<T>(_key: string, fn: () => Promise<T>): Promise<T> {
  return await fn();
}

async function importAudioFileRecord(libraryId: number, artistId: number, title: string, audioPath: string): Promise<number> {
  const [existing] = await db.select().from(songs).where(eq(songs.mainAudioPath, audioPath)).limit(1);
  if (existing) {
    return existing.id;
  }

  const [inserted] = await db.insert(songs).values({
    libraryId,
    artistId,
    title,
    mainAudioPath: audioPath,
    duration: 180,
  }).returning();

  return inserted.id;
}
