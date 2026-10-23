const http = require('http');
http.get('http://localhost:3000/api/songs', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const songs = JSON.parse(data);
      console.log(songs.slice(0, 3).map(s => ({id: s.id, title: s.title, hasLrc: s.hasLrc, hasElrc: s.hasElrc})));
    } catch(e) { console.log("error", e.message, data.slice(0, 100)); }
  });
});
