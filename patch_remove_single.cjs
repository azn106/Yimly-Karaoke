const fs = require('fs');
let code = fs.readFileSync('server/lib/scanner.ts', 'utf-8');

const oldCode = `  if (isLrc) {
    // Check if any lyrics record pointed to this file
    const matchedLyrics = await db.select().from(lyrics).where(eq(lyrics.lrcPath, filePath));
    for (const l of matchedLyrics) {
      const songRec = await db.select().from(songs).where(eq(songs.id, l.songId)).limit(1);
      if (songRec.length > 0) {
        const audioPath = songRec[0].mainAudioPath || songRec[0].instrumentalAudioPath;
        const alternativeLrc = audioPath ? await findLyricsForAudio(audioPath, songRec[0].title) : null;
        if (alternativeLrc) {
          await db.update(lyrics).set({ lrcPath: alternativeLrc }).where(eq(lyrics.id, l.id));
        } else {
          await db.delete(lyrics).where(eq(lyrics.id, l.id));
        }
      } else {
        await db.delete(lyrics).where(eq(lyrics.id, l.id));
      }
    }
    return;
  }`;

const newCode = `  if (isLrc) {
    // Check if any lyrics record pointed to this file
    const matchedLyrics = await db.select().from(lyrics).where(or(eq(lyrics.lrcPath, filePath), eq(lyrics.elrcPath, filePath)));
    for (const l of matchedLyrics) {
      const isElrcRemove = l.elrcPath === filePath;
      const isLrcRemove = l.lrcPath === filePath;
      
      const updates: any = {};
      if (isElrcRemove) updates.elrcPath = null;
      if (isLrcRemove) updates.lrcPath = '';
      
      const newElrc = updates.elrcPath === null ? null : l.elrcPath;
      const newLrc = updates.lrcPath === '' ? '' : l.lrcPath;
      
      if ((newElrc === null || newElrc === '') && (newLrc === null || newLrc === '')) {
        await db.delete(lyrics).where(eq(lyrics.id, l.id));
      } else {
        await db.update(lyrics).set(updates).where(eq(lyrics.id, l.id));
      }
    }
    return;
  }`;

code = code.replace(oldCode, newCode);
fs.writeFileSync('server/lib/scanner.ts', code);
