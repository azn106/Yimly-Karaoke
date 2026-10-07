import { scanLibrary } from './server/lib/scanner.js';
import { db } from './server/db/index.js';
import { songs, libraries, artists, lyrics } from './server/db/schema.js';
import { eq, isNotNull } from 'drizzle-orm';
import path from 'path';

async function run() {
  const mediaPath = path.resolve('./media');
  const libs = await db.select().from(libraries).where(eq(libraries.path, mediaPath));
  let libId = 1;
  if (libs.length === 0) {
    const inserted = await db.insert(libraries).values({ name: 'Default', path: mediaPath }).returning();
    libId = inserted[0].id;
  } else {
    libId = libs[0].id;
  }

  console.log('Scanning...', mediaPath);
  await scanLibrary(libId, mediaPath);
  console.log('Scan complete.');

  const allSongs = await db.select({
    id: songs.id,
    title: songs.title,
    artist: artists.name,
    hasMain: isNotNull(songs.mainAudioPath),
    hasInst: isNotNull(songs.instrumentalAudioPath),
    mainPath: songs.mainAudioPath,
    instPath: songs.instrumentalAudioPath
  }).from(songs).leftJoin(artists, eq(songs.artistId, artists.id));

  const allLyrics = await db.select().from(lyrics);

  console.log(JSON.stringify({ songs: allSongs, lyrics: allLyrics }, null, 2));
}

run().catch(console.error);
