const fs = require('fs');
let code = fs.readFileSync('server/lib/scanner.ts', 'utf-8');

const oldDbUpsert = `  if (existingLrc.length === 0) {
    await db.insert(lyrics).values({ songId: bestMatchSongId, lrcPath: lrcFullPath });
    return true;
  } else {
    const curPath = existingLrc[0].lrcPath;
    // If existing path is an eLRC and new file is standard LRC, do not downgrade if eLRC is valid
    if (curPath && curPath.toLowerCase().endsWith('.elrc.lrc') && !isElrc && fsSync.existsSync(curPath)) {
      return false;
    }
    await db.update(lyrics).set({ lrcPath: lrcFullPath }).where(eq(lyrics.id, existingLrc[0].id));
    return true;
  }`;

const newDbUpsert = `  if (existingLrc.length === 0) {
    await db.insert(lyrics).values({ 
      songId: bestMatchSongId, 
      lrcPath: isElrc ? '' : lrcFullPath,
      elrcPath: isElrc ? lrcFullPath : null
    });
    return true;
  } else {
    const updates: any = {};
    if (isElrc) {
      updates.elrcPath = lrcFullPath;
    } else {
      updates.lrcPath = lrcFullPath;
    }
    await db.update(lyrics).set(updates).where(eq(lyrics.id, existingLrc[0].id));
    return true;
  }`;

code = code.replace(oldDbUpsert, newDbUpsert);
fs.writeFileSync('server/lib/scanner.ts', code);
