const fs = require('fs');
let code = fs.readFileSync('server/routes/songs.ts', 'utf-8');

const oldLyricsFetch = `    const lyricsList = songIds.length > 0
      ? await db.select({ songId: lyrics.songId }).from(lyrics).where(inArray(lyrics.songId, songIds))
      : [];
    const lyricsSet = new Set(lyricsList.map(l => l.songId));

    const formatted = allSongs.map(s => {
      const trackArtists = artistsMap.get(s.id) || (s.artist ? [{ id: s.artistId, name: s.artist }] : []);
      return {
        ...s,
        artist: formatArtistDisplay(trackArtists.length > 0 ? trackArtists : s.artist),
        artists: trackArtists,
        hasArtwork: !!s.artworkPath || !!s.albumArtworkPath,
        hasLrc: lyricsSet.has(s.id)
      };
    });`;

const newLyricsFetch = `    const lyricsList = songIds.length > 0
      ? await db.select({ songId: lyrics.songId, lrcPath: lyrics.lrcPath, elrcPath: lyrics.elrcPath }).from(lyrics).where(inArray(lyrics.songId, songIds))
      : [];
    const lyricsMap = new Map();
    for (const l of lyricsList) {
      lyricsMap.set(l.songId, {
        hasLrc: !!l.lrcPath,
        hasElrc: !!l.elrcPath
      });
    }

    const formatted = allSongs.map(s => {
      const trackArtists = artistsMap.get(s.id) || (s.artist ? [{ id: s.artistId, name: s.artist }] : []);
      const l = lyricsMap.get(s.id) || { hasLrc: false, hasElrc: false };
      return {
        ...s,
        artist: formatArtistDisplay(trackArtists.length > 0 ? trackArtists : s.artist),
        artists: trackArtists,
        hasArtwork: !!s.artworkPath || !!s.albumArtworkPath,
        hasLrc: l.hasLrc,
        hasElrc: l.hasElrc
      };
    });`;

code = code.replace(oldLyricsFetch, newLyricsFetch);
fs.writeFileSync('server/routes/songs.ts', code);
