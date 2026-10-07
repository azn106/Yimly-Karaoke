const fs = require('fs');
let code = fs.readFileSync('server/routes/songs.ts', 'utf-8');

const regexHandle = /(const existingLrc = await db\.select\(\)\.from\(lyrics\)\.where\(eq\(lyrics\.songId, id\)\)\.limit\(1\);\s*let lrcPath = existingLrc\.length > 0 \? existingLrc\[0\]\.lrcPath : null;[\s\S]*?content: lrcContent,\s*\}\);)/;

const newHandle = `const isElrc = req.query.format === 'elrc';
    const existingLrc = await db.select().from(lyrics).where(eq(lyrics.songId, id)).limit(1);
    let targetPath = existingLrc.length > 0 ? (isElrc ? existingLrc[0].elrcPath : existingLrc[0].lrcPath) : null;

    if (!targetPath) {
      const audioPath = song[0].mainAudioPath || song[0].instrumentalAudioPath;
      if (!audioPath) {
        return res.status(400).json({ error: 'Song has no audio path associated' });
      }
      const dir = path.dirname(audioPath);
      const audioExt = path.extname(audioPath);
      const baseName = path.basename(audioPath, audioExt);
      const cleanBase = baseName.replace(/\\s*\\((instrumental|karaoke|vocals|backing version|backing)\\)\\s*/gi, '').trim();
      targetPath = path.join(dir, isElrc ? \`\${cleanBase}.elrc.lrc\` : \`\${cleanBase}.lrc\`);
    }

    const dirPath = path.dirname(targetPath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    fs.writeFileSync(targetPath, lrcContent, 'utf-8');

    if (existingLrc.length === 0) {
      const vals: any = { songId: id };
      if (isElrc) { vals.elrcPath = targetPath; vals.lrcPath = ''; }
      else { vals.lrcPath = targetPath; vals.elrcPath = null; }
      await db.insert(lyrics).values(vals);
    } else {
      const updates: any = {};
      if (isElrc) updates.elrcPath = targetPath;
      else updates.lrcPath = targetPath;
      await db.update(lyrics).set(updates).where(eq(lyrics.songId, id));
    }

    res.json({
      success: true,
      songId: id,
      path: targetPath,
      hasLrc: isElrc ? undefined : true,
      hasElrc: isElrc ? true : undefined,
      content: lrcContent,
    });`;

code = code.replace(regexHandle, newHandle);

const regexDelete = /(router\.delete\('\/:id\/lrc', requireAdmin, async \(req: AuthenticatedRequest, res\) => \{\s*try \{\s*const id = parseInt\(req\.params\.id\);\s*if \(isNaN\(id\)\) return res\.status\(400\)\.json\(\{ error: 'Invalid song ID' \}\);\s*)(const existingLrc[\s\S]*?res\.json\(\{ success: true, songId: id, hasLrc: false \}\);)/;

const newDelete = `const isElrc = req.query.format === 'elrc';
    const existingLrc = await db.select().from(lyrics).where(eq(lyrics.songId, id)).limit(1);
    if (existingLrc.length > 0) {
      const rec = existingLrc[0];
      const targetPath = isElrc ? rec.elrcPath : rec.lrcPath;
      if (targetPath && fs.existsSync(targetPath)) {
        try { fs.unlinkSync(targetPath); } catch (e) {}
      }
      
      const newElrc = isElrc ? null : rec.elrcPath;
      const newLrc = isElrc ? rec.lrcPath : '';
      
      if ((newElrc === null || newElrc === '') && (newLrc === null || newLrc === '')) {
        await db.delete(lyrics).where(eq(lyrics.songId, id));
      } else {
        const updates: any = {};
        if (isElrc) updates.elrcPath = null;
        else updates.lrcPath = '';
        await db.update(lyrics).set(updates).where(eq(lyrics.songId, id));
      }
    }
    res.json({ success: true, songId: id, hasLrc: isElrc ? undefined : false, hasElrc: isElrc ? false : undefined });`;

code = code.replace(regexDelete, (match, p1, p2) => {
  return p1 + newDelete;
});

fs.writeFileSync('server/routes/songs.ts', code);
