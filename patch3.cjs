const fs = require('fs');
let text = fs.readFileSync('server/lib/scanner.ts', 'utf-8');

// We need to change the songsMap to store both lrc and elrc
text = text.replace(
`    lrc?: string;`,
`    lrc?: string;\n    elrc?: string;`
);

text = text.replace(
`  for (const audio of audioList) {
    const songInfo = songsMap.get(audio.songKey);
    if (!songInfo || songInfo.lrc) continue;
    const dirLrcs = dirLrcMap.get(audio.dir);
    if (!dirLrcs || dirLrcs.length === 0) continue;

    const normAudioBase = normalizeBaseName(audio.baseName);
    const cleanAudioBase = audio.cleanBaseName;
    const elrcs = dirLrcs.filter(l => l.isElrc);
    const stdLrcs = dirLrcs.filter(l => !l.isElrc);

    let matchedPath: string | null = null;
    for (const pool of [elrcs, stdLrcs]) {`,
`  for (const audio of audioList) {
    const songInfo = songsMap.get(audio.songKey);
    if (!songInfo) continue;
    const dirLrcs = dirLrcMap.get(audio.dir);
    if (!dirLrcs || dirLrcs.length === 0) continue;

    const normAudioBase = normalizeBaseName(audio.baseName);
    const cleanAudioBase = audio.cleanBaseName;
    const elrcs = dirLrcs.filter(l => l.isElrc);
    const stdLrcs = dirLrcs.filter(l => !l.isElrc);

    const checkPool = (pool: any[]) => {
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
      return validCandidates[0].fullPath;
    };

    if (!songInfo.elrc) {
      songInfo.elrc = checkPool(elrcs) || undefined;
    }
    if (!songInfo.lrc) {
      songInfo.lrc = checkPool(stdLrcs) || undefined;
    }
    
    // We don't break early, let both run... but wait, the original logic had 'for (const pool of [elrcs, stdLrcs]) {'
`
);

fs.writeFileSync('server/lib/scanner.ts.patch3', text); // dry run basically
