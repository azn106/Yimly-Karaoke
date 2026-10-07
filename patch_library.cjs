const fs = require('fs');
let code = fs.readFileSync('src/pages/Library.tsx', 'utf-8');

// Imports
code = code.replace(
"import EditPlaylistModal from '../components/playlist/EditPlaylistModal';",
"import EditPlaylistModal from '../components/playlist/EditPlaylistModal';\nimport LyricsEditorModal from '../components/LyricsEditorModal';"
);

// State
const stateRegex = /const \[isEditPlaylistOpen, setIsEditPlaylistOpen\] = useState\(false\);/;
code = code.replace(stateRegex, "const [isEditPlaylistOpen, setIsEditPlaylistOpen] = useState(false);\n  const [editorState, setEditorState] = useState<{isOpen: boolean, songId: number | null, title: string, format: 'lrc'|'elrc'}>({isOpen: false, songId: null, title: '', format: 'lrc'});");

// First badge in album songs
const albumBadgeRegex = /\{song\.hasLrc && \(\s*<span className="px-1\.5 py-0\.5 rounded text-\[9px\] font-bold uppercase tracking-wider bg-\[#FF4FA3\]\/15 text-\[#FF4FA3\] border border-\[#FF4FA3\]\/25">\s*LRC\s*<\/span>\s*\)\}/g;
const albumBadgeRepl = `{song.hasLrc && (
                        <button 
                          onClick={(e) => { e.stopPropagation(); setEditorState({ isOpen: true, songId: song.id, title: song.title, format: 'lrc' }); }}
                          className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-[#FF4FA3]/15 text-[#FF4FA3] border border-[#FF4FA3]/25 hover:bg-[#FF4FA3]/30 transition-colors cursor-pointer"
                        >
                          LRC
                        </button>
                      )}
                      {song.hasElrc && (
                        <button 
                          onClick={(e) => { e.stopPropagation(); setEditorState({ isOpen: true, songId: song.id, title: song.title, format: 'elrc' }); }}
                          className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-[#3B82F6]/15 text-[#3B82F6] border border-[#3B82F6]/25 hover:bg-[#3B82F6]/30 transition-colors cursor-pointer"
                        >
                          ELRC
                        </button>
                      )}`;
code = code.replace(albumBadgeRegex, albumBadgeRepl);

// Second badge in main songs list
const mainBadgeRegex = /\{song\.hasLrc && \(\s*<span className="px-1\.5 py-0\.5 rounded text-\[9px\] font-bold uppercase tracking-wider bg-\[#FF4FA3\]\/15 text-\[#FF4FA3\] border border-\[#FF4FA3\]\/25 shrink-0">\s*LRC\s*<\/span>\s*\)\}/g;
const mainBadgeRepl = `{song.hasLrc && (
                            <button 
                              onClick={(e) => { e.stopPropagation(); setEditorState({ isOpen: true, songId: song.id, title: song.title, format: 'lrc' }); }}
                              className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-[#FF4FA3]/15 text-[#FF4FA3] border border-[#FF4FA3]/25 shrink-0 hover:bg-[#FF4FA3]/30 transition-colors cursor-pointer"
                            >
                              LRC
                            </button>
                          )}
                          {song.hasElrc && (
                            <button 
                              onClick={(e) => { e.stopPropagation(); setEditorState({ isOpen: true, songId: song.id, title: song.title, format: 'elrc' }); }}
                              className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-[#3B82F6]/15 text-[#3B82F6] border border-[#3B82F6]/25 shrink-0 hover:bg-[#3B82F6]/30 transition-colors cursor-pointer"
                            >
                              ELRC
                            </button>
                          )}`;
code = code.replace(mainBadgeRegex, mainBadgeRepl);

// Adding modal
const modalRegex = /(<EditPlaylistModal[\s\S]*?\/>)/;
const modalRepl = `$1
      <LyricsEditorModal
        isOpen={editorState.isOpen}
        songId={editorState.songId}
        songTitle={editorState.title}
        format={editorState.format}
        onClose={() => setEditorState(prev => ({ ...prev, isOpen: false }))}
        onSave={fetchSongs}
      />`;
code = code.replace(modalRegex, modalRepl);

fs.writeFileSync('src/pages/Library.tsx', code);
