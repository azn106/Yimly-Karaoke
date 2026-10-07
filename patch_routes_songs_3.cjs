const fs = require('fs');
let code = fs.readFileSync('server/routes/songs.ts', 'utf-8');

const oldLyricsFetch = `    const lrcRecord = await db.select().from(lyrics).where(eq(lyrics.songId, id)).limit(1);

    // Candidates collections separated by format hierarchy:`;

const newLyricsFetch = `    const formatQuery = req.query.format as string;
    const lrcRecord = await db.select().from(lyrics).where(eq(lyrics.songId, id)).limit(1);

    // Candidates collections separated by format hierarchy:`;

code = code.replace(oldLyricsFetch, newLyricsFetch);

const oldServe = `    if (lrcRecord.length > 0 && lrcRecord[0].lrcPath) {
      const dbPath = lrcRecord[0].lrcPath;
      const lowerDb = dbPath.toLowerCase();
      if (lowerDb.endsWith('.elrc.lrc')) {
        if (!candidateElrcs.includes(dbPath)) candidateElrcs.push(dbPath);
      } else if (lowerDb.endsWith('.lrc')) {
        if (!candidateStdLrcs.includes(dbPath)) candidateStdLrcs.push(dbPath);
      } else {
        if (!otherFallbacks.includes(dbPath)) otherFallbacks.push(dbPath);
      }
    }

    // Helper to persist/sync active path in database
    const persistMatchedPath = async (p: string) => {
      try {
        if (lrcRecord.length === 0) {
          await db.insert(lyrics).values({ songId: id, lrcPath: p });
        } else if (lrcRecord[0].lrcPath !== p) {
          await db.update(lyrics).set({ lrcPath: p }).where(eq(lyrics.id, lrcRecord[0].id));
        }
      } catch (err) {
        console.warn('Failed to sync lyrics path to DB:', err);
      }
    };

    // 1. Preferred / First Choice: Check .elrc.lrc candidates
    for (const filePath of candidateElrcs) {
      if (fs.existsSync(filePath)) {
        try {
          const content = await fs.promises.readFile(filePath, 'utf-8');
          if (isLrcContentValid(content)) {
            await persistMatchedPath(filePath);
            return res.type('text/plain').send(content);
          } else {
            console.warn(\`[Lyrics] .elrc.lrc at \${filePath} is invalid/unparseable; falling back to .lrc\`);
          }
        } catch (e) {
          console.warn(\`[Lyrics] Could not read .elrc.lrc at \${filePath}:\`, e);
        }
      }
    }

    // 2. Fallback: Check .lrc candidates if .elrc.lrc is missing or invalid
    for (const filePath of candidateStdLrcs) {`;

const newServe = `    if (lrcRecord.length > 0) {
      if (lrcRecord[0].elrcPath) {
        if (!candidateElrcs.includes(lrcRecord[0].elrcPath)) candidateElrcs.push(lrcRecord[0].elrcPath);
      }
      if (lrcRecord[0].lrcPath) {
        if (!candidateStdLrcs.includes(lrcRecord[0].lrcPath)) candidateStdLrcs.push(lrcRecord[0].lrcPath);
      }
    }

    // Helper to persist/sync active path in database
    const persistMatchedPath = async (p: string, isElrc: boolean) => {
      try {
        if (lrcRecord.length === 0) {
          const vals: any = { songId: id };
          if (isElrc) { vals.elrcPath = p; vals.lrcPath = ''; }
          else { vals.lrcPath = p; vals.elrcPath = null; }
          await db.insert(lyrics).values(vals);
        } else {
          const updates: any = {};
          if (isElrc && lrcRecord[0].elrcPath !== p) updates.elrcPath = p;
          else if (!isElrc && lrcRecord[0].lrcPath !== p) updates.lrcPath = p;
          if (Object.keys(updates).length > 0) {
            await db.update(lyrics).set(updates).where(eq(lyrics.id, lrcRecord[0].id));
          }
        }
      } catch (err) {
        console.warn('Failed to sync lyrics path to DB:', err);
      }
    };

    if (formatQuery === 'elrc' || !formatQuery) {
      // 1. Preferred / First Choice: Check .elrc.lrc candidates
      for (const filePath of candidateElrcs) {
        if (fs.existsSync(filePath)) {
          try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            if (isLrcContentValid(content)) {
              await persistMatchedPath(filePath, true);
              return res.type('text/plain').send(content);
            } else {
              console.warn(\`[Lyrics] .elrc.lrc at \${filePath} is invalid/unparseable; falling back to .lrc\`);
            }
          } catch (e) {
            console.warn(\`[Lyrics] Could not read .elrc.lrc at \${filePath}:\`, e);
          }
        }
      }
      if (formatQuery === 'elrc') return res.status(404).json({ error: 'ELRC not found' });
    }

    if (formatQuery === 'lrc' || !formatQuery) {
      // 2. Fallback: Check .lrc candidates if .elrc.lrc is missing or invalid
      for (const filePath of candidateStdLrcs) {`;

code = code.replace(oldServe, newServe);

fs.writeFileSync('server/routes/songs.ts', code);
