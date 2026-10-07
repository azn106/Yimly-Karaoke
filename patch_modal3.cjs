const fs = require('fs');
let code = fs.readFileSync('src/components/LyricsEditorModal.tsx', 'utf-8');

code = code.replace(
`              {isSaving ? 'Saving...' : 'Save Lyrics'}
            </button>
          </div>`,
`              {isSaving ? 'Saving...' : 'Save Lyrics'}
            </button>
            <button
              onClick={async () => {
                if (!songId || !window.confirm('Are you sure you want to delete these lyrics?')) return;
                setIsSaving(true);
                try {
                  const res = await fetch(\`/api/songs/\${songId}/lrc?format=\${format}\`, { method: 'DELETE' });
                  if (!res.ok) throw new Error('Failed to delete');
                  onSave();
                  onClose();
                } catch (e) { setError('Failed to delete.'); }
                finally { setIsSaving(false); }
              }}
              disabled={isSaving || isLoading}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              Delete
            </button>
          </div>`
);
fs.writeFileSync('src/components/LyricsEditorModal.tsx', code);
