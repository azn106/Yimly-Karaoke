const fs = require('fs');
let code = fs.readFileSync('server/lib/scanner.ts', 'utf-8');

code = code.replace(
`  const songsMap = new Map<string, {
    artists: string[];
    albumArtist?: string;
    album: string;
    title: string;
    mainAudio?: string;
    instrumentalAudio?: string;
    lrc?: string;
    duration?: number;
    trackNumber?: number;`,
`  const songsMap = new Map<string, {
    artists: string[];
    albumArtist?: string;
    album: string;
    title: string;
    mainAudio?: string;
    instrumentalAudio?: string;
    lrc?: string;
    elrc?: string;
    duration?: number;
    trackNumber?: number;`
);

const oldMatching = `    const elrcs = dirLrcs.filter(l => l.isElrc);
    const stdLrcs = dirLrcs.filter(l => !l.isElrc);

    let matchedPath: string | null = null;

    for (const pool of [elrcs, stdLrcs]) {
      if (pool.length === 0) continue;

      const validCandidates = pool.filter(lrc => {
        try {
          if (!fsSync.existsSync(lrc.fullPath)) return false;
          const content = fsSync.readFileSync(lrc.fullPath, 'utf-8');
          return isLrcContentValid(content);
        } catch {
          return false;
        }
      });

      if (validCandidates.length === 0) continue;

      const exactMatch = validCandidates.find(lrc => normalizeBaseName(lrc.baseName) === normAudioBase);
      if (exactMatch) {
        matchedPath = exactMatch.fullPath;
        break;
      }

      const cleanMatch = validCandidates.find(lrc => lrc.cleanBaseName === cleanAudioBase);
      if (cleanMatch) {
        matchedPath = cleanMatch.fullPath;
        break;
      }

      const songTitleNorm = normalizeBaseName(songInfo.title);
      const titleMatch = validCandidates.find(lrc => normalizeBaseName(lrc.baseName) === songTitleNorm || lrc.cleanBaseName === songTitleNorm);
      if (titleMatch) {
        matchedPath = titleMatch.fullPath;
        break;
      }
    }

    if (matchedPath) {
      songInfo.lrc = matchedPath;
    }`;

const newMatching = `    const elrcs = dirLrcs.filter(l => l.isElrc);
    const stdLrcs = dirLrcs.filter(l => !l.isElrc);

    const checkPool = (pool: typeof elrcs) => {
      if (pool.length === 0) return null;
      const validCandidates = pool.filter(lrc => {
        try {
          if (!fsSync.existsSync(lrc.fullPath)) return false;
          const content = fsSync.readFileSync(lrc.fullPath, 'utf-8');
          return isLrcContentValid(content);
        } catch { return false; }
      });
      if (validCandidates.length === 0) return null;
      
      const exactMatch = validCandidates.find(lrc => normalizeBaseName(lrc.baseName) === normAudioBase);
      if (exactMatch) return exactMatch.fullPath;
      
      const cleanMatch = validCandidates.find(lrc => lrc.cleanBaseName === cleanAudioBase);
      if (cleanMatch) return cleanMatch.fullPath;
      
      const songTitleNorm = normalizeBaseName(songInfo.title);
      const titleMatch = validCandidates.find(lrc => normalizeBaseName(lrc.baseName) === songTitleNorm || lrc.cleanBaseName === songTitleNorm);
      if (titleMatch) return titleMatch.fullPath;
      
      return null;
    };

    if (!songInfo.elrc) {
      const match = checkPool(elrcs);
      if (match) songInfo.elrc = match;
    }
    if (!songInfo.lrc) {
      const match = checkPool(stdLrcs);
      if (match) songInfo.lrc = match;
    }`;

code = code.replace(`    if (!songInfo || songInfo.lrc) continue;`, `    if (!songInfo) continue;`);
code = code.replace(oldMatching, newMatching);

// Also need to update the fallback matching logic
const oldFallback = `    let matchedPath: string | null = null;
    for (const pool of [allElrcs, allStdLrcs]) {
      if (pool.length === 0) continue;

      const exactMatch = pool.find(lrc => normalizeBaseName(lrc.baseName) === normAudioBase);
      if (exactMatch) {
        matchedPath = exactMatch.fullPath;
        break;
      }

      const cleanMatch = pool.find(lrc => lrc.cleanBaseName === cleanAudioBase);
      if (cleanMatch) {
        matchedPath = cleanMatch.fullPath;
        break;
      }

      const songTitleNorm = normalizeBaseName(songInfo.title);
      const titleMatch = pool.find(lrc => normalizeBaseName(lrc.baseName) === songTitleNorm || lrc.cleanBaseName === songTitleNorm);
      if (titleMatch) {
        matchedPath = titleMatch.fullPath;
        break;
      }
    }

    if (matchedPath) {
      songInfo.lrc = matchedPath;
    }`;

const newFallback = `    const checkPoolFallback = (pool: typeof allElrcs) => {
      if (pool.length === 0) return null;
      const exactMatch = pool.find(lrc => normalizeBaseName(lrc.baseName) === normAudioBase);
      if (exactMatch) return exactMatch.fullPath;
      const cleanMatch = pool.find(lrc => lrc.cleanBaseName === cleanAudioBase);
      if (cleanMatch) return cleanMatch.fullPath;
      const songTitleNorm = normalizeBaseName(songInfo.title);
      const titleMatch = pool.find(lrc => normalizeBaseName(lrc.baseName) === songTitleNorm || lrc.cleanBaseName === songTitleNorm);
      if (titleMatch) return titleMatch.fullPath;
      return null;
    };

    if (!songInfo.elrc) {
      const match = checkPoolFallback(allElrcs);
      if (match) songInfo.elrc = match;
    }
    if (!songInfo.lrc) {
      const match = checkPoolFallback(allStdLrcs);
      if (match) songInfo.lrc = match;
    }`;

code = code.replace(oldFallback, newFallback);

// Also update the DB insert/update logic
const oldDbUpsert = `    if (song.lrc) {
      const existingLrc = await db.select().from(lyrics).where(eq(lyrics.songId, songId)).limit(1);
      if (existingLrc.length === 0) {
        await db.insert(lyrics).values({
          songId,
          lrcPath: song.lrc,
        });
      } else {
        await db.update(lyrics).set({ lrcPath: song.lrc }).where(eq(lyrics.id, existingLrc[0].id));
      }
    }`;

const newDbUpsert = `    if (song.lrc || song.elrc) {
      const existingLrc = await db.select().from(lyrics).where(eq(lyrics.songId, songId)).limit(1);
      if (existingLrc.length === 0) {
        await db.insert(lyrics).values({
          songId,
          lrcPath: song.lrc || '',
          elrcPath: song.elrc || null,
        });
      } else {
        await db.update(lyrics).set({ 
          lrcPath: song.lrc || '',
          elrcPath: song.elrc || null
        }).where(eq(lyrics.id, existingLrc[0].id));
      }
    }`;

code = code.replace(oldDbUpsert, newDbUpsert);

fs.writeFileSync('server/lib/scanner.ts', code);
