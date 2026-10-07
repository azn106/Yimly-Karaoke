import React, { useState, useEffect } from 'react';
import { X, Lock, Globe, User, Loader2, Shield } from 'lucide-react';
import { Playlist } from '../../types';

interface EditPlaylistModalProps {
  isOpen: boolean;
  playlist: Playlist | null;
  currentUser: any;
  onClose: () => void;
  onUpdated: (updated: Playlist) => void;
}

export default function EditPlaylistModal({
  isOpen,
  playlist,
  currentUser,
  onClose,
  onUpdated,
}: EditPlaylistModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [ownerUsername, setOwnerUsername] = useState('');
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = currentUser?.role === 'administrator';

  useEffect(() => {
    if (playlist) {
      setName(playlist.name || '');
      setDescription(playlist.description || '');
      setIsPublic(Boolean(playlist.isPublic));
      setOwnerUsername(playlist.ownerName || '');
    }
  }, [playlist]);

  useEffect(() => {
    if (isOpen && isAdmin) {
      fetch('/api/users')
        .then(async (res) => {
          if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
            return await res.json();
          }
          return [];
        })
        .then((users) => {
          if (Array.isArray(users)) setAllUsers(users);
        })
        .catch((e) => console.error('Failed to fetch users for ownership transfer:', e));
    }
  }, [isOpen, isAdmin]);

  if (!isOpen || !playlist) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Playlist name cannot be empty');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload: any = {
        name: name.trim(),
        description: description.trim() || undefined,
        isPublic,
      };

      if (isAdmin && ownerUsername && ownerUsername !== playlist.ownerName) {
        payload.ownerUsername = ownerUsername.trim();
      }

      const res = await fetch(`/api/playlists/${playlist.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to update playlist' }));
        throw new Error(data.error || 'Failed to update playlist');
      }

      const updated = await res.json();
      onUpdated({ ...playlist, ...updated });
      onClose();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to update playlist');
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
            <h2 className="text-lg font-bold text-white tracking-tight">Edit Playlist Details</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Update playlist metadata, visibility and settings</p>
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
              placeholder="Add a description..."
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

          {/* Admin Transfer Ownership */}
          {isAdmin && (
            <div className="p-4 bg-[#0D0E15] border border-amber-500/20 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-amber-400">
                <Shield className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-wider">Admin: Transfer Ownership</span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Current Owner: <span className="font-semibold text-white">{playlist.ownerName || 'User ID #' + playlist.userId}</span>
              </p>
              <select
                value={ownerUsername}
                onChange={(e) => setOwnerUsername(e.target.value)}
                className="w-full px-3 py-2 bg-[#141622] border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:border-amber-500 transition-all"
              >
                {allUsers.map((u) => (
                  <option key={u.id} value={u.username}>
                    {u.username} ({u.role})
                  </option>
                ))}
              </select>
            </div>
          )}

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
              <span>{loading ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
