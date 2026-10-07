const fs = require('fs');
let code = fs.readFileSync('src/pages/Home.tsx', 'utf-8');

// Imports
if (!code.includes('LyricsEditorModal')) {
  code = code.replace("import { Play, Plus, Clock, Search, TrendingUp, Music, ListMusic, LogOut, Loader2, PlayCircle, Settings, FileText, ChevronRight, Share2, Users, Crown, KeyRound, Save, Edit3, Trash2, Calendar, Link, Check, Disc, Heart, Repeat, LayoutGrid, X } from 'lucide-react';", "import { Play, Plus, Clock, Search, TrendingUp, Music, ListMusic, LogOut, Loader2, PlayCircle, Settings, FileText, ChevronRight, Share2, Users, Crown, KeyRound, Save, Edit3, Trash2, Calendar, Link, Check, Disc, Heart, Repeat, LayoutGrid, X } from 'lucide-react';\nimport LyricsEditorModal from '../components/LyricsEditorModal';");
}

// State
if (!code.includes('editorState')) {
  code = code.replace("const [loading, setLoading] = useState(true);", "const [loading, setLoading] = useState(true);\n  const [editorState, setEditorState] = useState<{isOpen: boolean, songId: number | null, title: string, format: 'lrc'|'elrc'}>({isOpen: false, songId: null, title: '', format: 'lrc'});");
}

// Badges
const lrcBadgeRegex = /\{song\.hasLrc && \(\s*<span className="px-1\.5 py-0\.5 rounded text-\[9px\] font-bold uppercase tracking-wider bg-\[#FF4FA3\]\/20 text-\[#FF4FA3\] border border-\[#FF4FA3\]\/30 backdrop-blur">\s*LRC\s*<\/span>\s*\)\}/g;
const lrcBadgeRepl = `{song.hasLrc && (
                        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditorState({isOpen: true, songId: song.id, title: song.title, format: 'lrc'}); }} className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-[#FF4FA3]/20 text-[#FF4FA3] border border-[#FF4FA3]/30 backdrop-blur hover:bg-[#FF4FA3]/30 transition-colors cursor-pointer">
                          LRC
                        </button>
                      )}`;
code = code.replace(lrcBadgeRegex, lrcBadgeRepl);

const elrcBadgeRegex = /\{song\.hasElrc && \(\s*<span className="px-1\.5 py-0\.5 rounded text-\[9px\] font-bold uppercase tracking-wider bg-\[#3B82F6\]\/20 text-\[#3B82F6\] border border-\[#3B82F6\]\/30 backdrop-blur">\s*ELRC\s*<\/span>\s*\)\}/g;
const elrcBadgeRepl = `{song.hasElrc && (
                        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditorState({isOpen: true, songId: song.id, title: song.title, format: 'elrc'}); }} className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-[#3B82F6]/20 text-[#3B82F6] border border-[#3B82F6]/30 backdrop-blur hover:bg-[#3B82F6]/30 transition-colors cursor-pointer">
                          ELRC
                        </button>
                      )}`;
code = code.replace(elrcBadgeRegex, elrcBadgeRepl);

// Modal HTML
if (!code.includes('<LyricsEditorModal')) {
  const endTag = '    </div>\n  );\n}';
  const modalHtml = `      <LyricsEditorModal
        isOpen={editorState.isOpen}
        songId={editorState.songId}
        songTitle={editorState.title}
        format={editorState.format}
        onClose={() => setEditorState(prev => ({ ...prev, isOpen: false }))}
        onSave={() => window.location.reload()}
      />
`;
  code = code.replace(endTag, modalHtml + endTag);
}

fs.writeFileSync('src/pages/Home.tsx', code);
