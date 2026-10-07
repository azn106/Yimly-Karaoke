const fs = require('fs');
let code = fs.readFileSync('server/routes/songs.ts', 'utf-8');

code = code.replace(
`    return res.status(404).json({ error: 'Lyrics not found' });
  } catch (error) {`,
`    }
    return res.status(404).json({ error: 'Lyrics not found' });
  } catch (error) {`
);

fs.writeFileSync('server/routes/songs.ts', code);
