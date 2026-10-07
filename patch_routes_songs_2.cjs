const fs = require('fs');
let code = fs.readFileSync('server/routes/songs.ts', 'utf-8');

const oldSelect = `      lrcPath: lyrics.lrcPath,
      artworkPath: songs.artworkPath,`;

const newSelect = `      lrcPath: lyrics.lrcPath,
      elrcPath: lyrics.elrcPath,
      artworkPath: songs.artworkPath,`;

code = code.replace(oldSelect, newSelect);

const oldHas = `    let hasElrc = false;
    let hasLrc = !!songRec[0].hasLrc;
    const audioPath = songRec[0].mainAudioPath || songRec[0].instrumentalAudioPath;
    if (songRec[0].lrcPath && songRec[0].lrcPath.toLowerCase().endsWith('.elrc.lrc')) {
      hasElrc = true;
      hasLrc = true;
    }
    if (audioPath && fs.existsSync(audioPath)) {
      const dir = path.dirname(audioPath);
      if (fs.existsSync(dir)) {
        try {
          const entries = await fs.promises.readdir(dir, { withFileTypes: true });
          const lrcEntries = entries.filter(e => e.isFile() && (e.name.toLowerCase().endsWith('.elrc.lrc') || e.name.toLowerCase().endsWith('.lrc')));
          for (const e of lrcEntries) {
            hasLrc = true;
            if (e.name.toLowerCase().endsWith('.elrc.lrc')) {
              hasElrc = true;
            }
          }
        } catch (e) {}
      }
    }`;

const newHas = `    let hasElrc = !!songRec[0].elrcPath;
    let hasLrc = !!songRec[0].lrcPath;
    const audioPath = songRec[0].mainAudioPath || songRec[0].instrumentalAudioPath;
    
    // Fallback: check filesystem if not in db
    if ((!hasLrc || !hasElrc) && audioPath && fs.existsSync(audioPath)) {
      const dir = path.dirname(audioPath);
      if (fs.existsSync(dir)) {
        try {
          const entries = await fs.promises.readdir(dir, { withFileTypes: true });
          const lrcEntries = entries.filter(e => e.isFile() && (e.name.toLowerCase().endsWith('.elrc.lrc') || e.name.toLowerCase().endsWith('.lrc')));
          for (const e of lrcEntries) {
            if (e.name.toLowerCase().endsWith('.elrc.lrc')) {
              hasElrc = true;
            } else if (e.name.toLowerCase().endsWith('.lrc')) {
              hasLrc = true;
            }
          }
        } catch (e) {}
      }
    }`;

code = code.replace(oldHas, newHas);
fs.writeFileSync('server/routes/songs.ts', code);
