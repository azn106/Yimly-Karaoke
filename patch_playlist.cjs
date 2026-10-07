const fs = require('fs');
let code = fs.readFileSync('src/components/playlist/PlaylistDetailView.tsx', 'utf-8');

// Add onOpenLyrics to props
code = code.replace(/onRemoveSong: \(songId: number\) => void;/g, "onRemoveSong: (songId: number) => void;\n  onOpenLyrics?: (songId: number, title: string, format: 'lrc'|'elrc') => void;");
code = code.replace(/onRemoveSong,/g, "onRemoveSong,\n  onOpenLyrics,");

// Update badges
const lrcBadgeRegex = /\{song\.hasLrc && \(\s*<span className="inline-block px-1\.5 py-0\.2 rounded text-\[8px\] font-bold uppercase tracking-wider bg-\[#FF4FA3\]\/15 text-\[#FF4FA3\] border border-\[#FF4FA3\]\/25 mt-0\.5">\s*LRC\s*<\/span>\s*\)\}/g;
const lrcBadgeRepl = `{song.hasLrc && (
                          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenLyrics && onOpenLyrics(song.id, song.title, 'lrc'); }} className="inline-block px-1.5 py-0.2 rounded text-[8px] font-bold uppercase tracking-wider bg-[#FF4FA3]/15 text-[#FF4FA3] border border-[#FF4FA3]/25 mt-0.5 hover:bg-[#FF4FA3]/30 transition-colors cursor-pointer">
                            LRC
                          </button>
                        )}
                        {song.hasElrc && (
                          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenLyrics && onOpenLyrics(song.id, song.title, 'elrc'); }} className="inline-block px-1.5 py-0.2 rounded text-[8px] font-bold uppercase tracking-wider bg-[#3B82F6]/15 text-[#3B82F6] border border-[#3B82F6]/25 mt-0.5 hover:bg-[#3B82F6]/30 transition-colors cursor-pointer">
                            ELRC
                          </button>
                        )}`;
code = code.replace(lrcBadgeRegex, lrcBadgeRepl);

fs.writeFileSync('src/components/playlist/PlaylistDetailView.tsx', code);
