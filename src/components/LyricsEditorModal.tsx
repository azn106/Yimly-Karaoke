import React, { useState, useEffect } from 'react';
import { X, Save, Music } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface LyricsEditorModalProps {
  isOpen: boolean;
  songId: number | null;
  songTitle: string;
  format: 'lrc' | 'elrc';
  onClose: () => void;
  onSave: (songId?: number, format?: 'lrc' | 'elrc', exists?: boolean) => void;
}

export default function LyricsEditorModal({ isOpen, songId, songTitle, format, onClose, onSave }: LyricsEditorModalProps) {
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen && songId) {
      setIsLoading(true);
      setError('');
      setContent('');
      setIsNew(false);
      fetch(`/api/songs/${songId}/lyrics?format=${format}`)
        .then(res => {
          if (!res.ok) {
            if (res.status === 404) {
              setIsNew(true);
              return ''; // No existing lyrics, start empty in create mode
            }
            throw new Error('Failed to fetch lyrics');
          }
          setIsNew(false);
          return res.text();
        })
        .then(text => {
          setContent(text);
          setIsLoading(false);
        })
        .catch(err => {
          setError('Could not load existing lyrics.');
          setIsLoading(false);
        });
    }
  }, [isOpen, songId, format]);

  const handleSave = async () => {
    if (!songId) return;
    setIsSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/songs/${songId}/lrc?format=${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: content,
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to save lyrics');
      }
      onSave(songId, format, true);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'An error occurred while saving.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!songId || !window.confirm('Are you sure you want to delete these lyrics?')) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/songs/${songId}/lrc?format=${format}`, { method: 'DELETE' });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to delete');
      }
      onSave(songId, format, false);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to delete.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      >
        <motion.div 
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          className="bg-[#1A1C2C] border border-white/10 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        >
          <div className="flex items-center justify-between p-6 border-b border-white/10 bg-[#12131C]">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                format === 'elrc' ? 'bg-[#3B82F6]/15 text-[#3B82F6]' : 'bg-[#FF4FA3]/15 text-[#FF4FA3]'
              }`}>
                <Music className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <span>{isNew ? 'Create' : 'Edit'} {format === 'elrc' ? 'ELRC' : 'LRC'} Lyrics</span>
                  {isNew && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      New File
                    </span>
                  )}
                </h2>
                <p className="text-sm text-zinc-400 truncate max-w-sm">{songTitle}</p>
              </div>
            </div>
            <button 
              onClick={onClose}
              className="p-2 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 p-6 overflow-hidden flex flex-col relative">
            {error && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 text-sm">
                {error}
              </div>
            )}
            
            {isLoading ? (
              <div className="flex-1 flex items-center justify-center text-zinc-400">Loading lyrics...</div>
            ) : (
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder={
                  format === 'elrc'
                    ? "[00:00.00] <00:00.00>Enter <00:00.50>word-synced <00:01.00>ELRC <00:01.50>lyrics\n[00:02.00] <00:02.00>Next <00:02.50>line..."
                    : "[00:00.00] Enter line-synced LRC lyrics here\n[00:04.00] Next line..."
                }
                className="flex-1 w-full bg-black/40 border border-white/10 rounded-xl p-4 text-zinc-300 font-mono text-sm focus:outline-none focus:border-[#FF4FA3]/50 focus:ring-1 focus:ring-[#FF4FA3]/50 resize-none"
                spellCheck={false}
              />
            )}
          </div>

          <div className="p-6 border-t border-white/10 bg-[#12131C] flex items-center justify-between gap-3">
            <div>
              {!isNew && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isSaving || isLoading}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500/80 hover:bg-red-600 transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  Delete File
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-white/5 hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || isLoading}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#FF4FA3] hover:bg-[#FF4FA3]/90 transition-colors flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-[#FF4FA3]/20"
              >
                <Save className="w-4 h-4" />
                {isSaving ? 'Saving...' : (isNew ? `Create ${format === 'elrc' ? 'ELRC' : 'LRC'} File` : 'Save Lyrics')}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
