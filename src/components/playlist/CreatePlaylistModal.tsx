import React, { useState, useRef } from 'react';
import { X, Lock, Globe, Upload, Image as ImageIcon, Loader2 } from 'lucide-react';
import { Playlist } from '../../types';

interface CreatePlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (playlist: Playlist) => void;
}

export default function CreatePlaylistModal({ isOpen, onClose, onCreated }: CreatePlaylistModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file (PNG, JPG, WebP, GIF)');
      return;
    }
    setError(null);
    setCoverFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      setCoverPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Playlist name is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Create playlist on server
      const res = await fetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          isPublic,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to create playlist' }));
        throw new Error(data.error || 'Failed to create playlist');
      }

      const created: Playlist = await res.json();

      // 2. Upload cover if selected
      if (coverFile) {
        try {
          const buffer = await coverFile.arrayBuffer();
          const coverRes = await fetch(`/api/playlists/${created.id}/cover`, {
            method: 'POST',
            headers: {
              'Content-Type': coverFile.type || 'image/jpeg',
            },
            body: buffer,
          });
          if (coverRes.ok) {
            const updated = await coverRes.json();
            onCreated({ ...created, ...updated, coverImageUrl: `/api/playlists/${created.id}/cover?t=${Date.now()}` });
            onClose();
            return;
          }
        } catch (coverErr) {
          console.error('Cover upload error:', coverErr);
        }
      }

      onCreated(created);
      onClose();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to create playlist');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div 
        className="w-full max-w-lg bg-[#141622] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">Create New Playlist</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Add a new playlist to your karaoke library</p>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
          {error && (
            <div className="p-3 bg-red-950/40 border border-red-500/30 rounded-xl text-red-300 text-xs">
              {error}
            </div>
          )}

          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider block">
              Playlist Name <span className="text-[#FF4FA3]">*</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              placeholder="e.g. 90s Karaoke Party"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2.5 bg-[#0D0E15] border border-white/10 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-[#FF4FA3] focus:ring-1 focus:ring-[#FF4FA3] transition-all"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider block">
              Description <span className="text-zinc-500 font-normal lowercase">(optional)</span>
            </label>
            <textarea
              rows={2}
              placeholder="Add an optional description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-4 py-2 bg-[#0D0E15] border border-white/10 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-[#FF4FA3] focus:ring-1 focus:ring-[#FF4FA3] transition-all resize-none"
            />
          </div>

          {/* Visibility */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider block">
              Visibility
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setIsPublic(false)}
                className={`p-3 rounded-xl border text-left flex items-start gap-3 transition-all ${
                  !isPublic
                    ? 'bg-[#FF4FA3]/10 border-[#FF4FA3] text-white shadow-sm'
                    : 'bg-[#0D0E15] border-white/5 text-zinc-400 hover:text-zinc-200 hover:border-white/15'
                }`}
              >
                <Lock className={`w-4 h-4 mt-0.5 shrink-0 ${!isPublic ? 'text-[#FF4FA3]' : 'text-zinc-500'}`} />
                <div>
                  <span className="text-xs font-bold block text-white">Private</span>
                  <span className="text-[11px] text-zinc-400 block mt-0.5">Only you and collaborators</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setIsPublic(true)}
                className={`p-3 rounded-xl border text-left flex items-start gap-3 transition-all ${
                  isPublic
                    ? 'bg-[#FF4FA3]/10 border-[#FF4FA3] text-white shadow-sm'
                    : 'bg-[#0D0E15] border-white/5 text-zinc-400 hover:text-zinc-200 hover:border-white/15'
                }`}
              >
                <Globe className={`w-4 h-4 mt-0.5 shrink-0 ${isPublic ? 'text-[#FF4FA3]' : 'text-zinc-500'}`} />
                <div>
                  <span className="text-xs font-bold block text-white">Public</span>
                  <span className="text-[11px] text-zinc-400 block mt-0.5">Visible to all server users</span>
                </div>
              </button>
            </div>
          </div>

          {/* Optional Cover Upload */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider block">
              Cover Image <span className="text-zinc-500 font-normal lowercase">(optional)</span>
            </label>
            
            <input
              type="file"
              ref={fileInputRef}
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
            />

            <div 
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-4 p-3 bg-[#0D0E15] border border-dashed border-white/15 hover:border-[#FF4FA3]/40 rounded-xl cursor-pointer transition-colors group"
            >
              <div className="w-14 h-14 rounded-lg bg-zinc-800/80 border border-white/10 flex items-center justify-center shrink-0 overflow-hidden group-hover:border-[#FF4FA3]/30">
                {coverPreview ? (
                  <img src={coverPreview} alt="Cover preview" className="w-full h-full object-cover" />
                ) : (
                  <ImageIcon className="w-6 h-6 text-zinc-500 group-hover:text-[#FF4FA3] transition-colors" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-xs font-medium text-white block group-hover:text-[#FF4FA3] transition-colors">
                  {coverFile ? coverFile.name : 'Upload playlist artwork'}
                </span>
                <span className="text-[11px] text-zinc-500 block mt-0.5">
                  JPG, PNG, WebP or GIF (saved permanently on server)
                </span>
              </div>
              <button
                type="button"
                className="px-3 py-1.5 bg-white/5 group-hover:bg-[#FF4FA3]/15 text-zinc-300 group-hover:text-[#FF4FA3] rounded-lg text-xs font-semibold border border-white/10 group-hover:border-[#FF4FA3]/30 transition-all shrink-0"
              >
                <Upload className="w-3.5 h-3.5 inline mr-1" /> Browse
              </button>
            </div>
          </div>

          {/* Footer buttons */}
          <div className="pt-3 border-t border-white/5 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="px-5 py-2 rounded-xl text-xs font-semibold bg-[#FF4FA3] hover:bg-[#e0378b] text-white shadow-lg shadow-[#FF4FA3]/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all inline-flex items-center gap-1.5"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{loading ? 'Creating...' : 'Create Playlist'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
