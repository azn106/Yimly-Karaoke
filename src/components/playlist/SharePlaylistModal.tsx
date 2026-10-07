import React, { useState, useEffect } from 'react';
import { X, Users, UserPlus, Trash2, Globe, Lock, Loader2, Shield, Check, User } from 'lucide-react';
import { Playlist, PlaylistCollaborator } from '../../types';

interface SharePlaylistModalProps {
  isOpen: boolean;
  playlist: Playlist | null;
  currentUser: any;
  onClose: () => void;
  onUpdated?: (updated: Playlist) => void;
}

export default function SharePlaylistModal({
  isOpen,
  playlist,
  currentUser,
  onClose,
  onUpdated,
}: SharePlaylistModalProps) {
  const [collaborators, setCollaborators] = useState<PlaylistCollaborator[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [username, setUsername] = useState('');
  const [permission, setPermission] = useState<'view' | 'edit'>('view');
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [allUsers, setAllUsers] = useState<any[]>([]);

  const isAdmin = currentUser?.role === 'administrator';

  useEffect(() => {
    if (playlist && isOpen) {
      setIsPublic(Boolean(playlist.isPublic));
      loadCollaborators();
      loadUsersList();
    }
  }, [playlist, isOpen]);

  const loadUsersList = async () => {
    try {
      if (isAdmin) {
        const res = await fetch('/api/users');
        if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
          const data = await res.json();
          if (Array.isArray(data)) setAllUsers(data);
        }
      }
    } catch (e) {
      // Non-critical
    }
  };

  const loadCollaborators = async () => {
    if (!playlist) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/playlists/${playlist.id}/collaborators`);
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        setCollaborators(Array.isArray(data) ? data : []);
      }
    } catch (e: any) {
      console.error('Failed to load collaborators:', e);
      setError('Could not load collaborator list');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !playlist) return null;

  const handleAddCollaborator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('Please enter a username');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/playlists/${playlist.id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          permission,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to share playlist' }));
        throw new Error(data.error || 'Failed to share playlist');
      }

      setUsername('');
      setSuccessMsg('Collaborator added successfully');
      setTimeout(() => setSuccessMsg(null), 3000);
      loadCollaborators();
    } catch (err: any) {
      setError(err.message || 'Failed to add collaborator');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveCollaborator = async (userId: number) => {
    try {
      const res = await fetch(`/api/playlists/${playlist.id}/share/${userId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setCollaborators((prev) => prev.filter((c) => c.userId !== userId));
      } else {
        const data = await res.json().catch(() => ({ error: 'Failed to remove collaborator' }));
        alert(data.error || 'Failed to remove collaborator');
      }
    } catch (e: any) {
      alert(e.message || 'Failed to remove collaborator');
    }
  };

  const handleTogglePublic = async (newVal: boolean) => {
    setIsPublic(newVal);
    try {
      const res = await fetch(`/api/playlists/${playlist.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic: newVal }),
      });
      if (res.ok) {
        const updated = await res.json();
        if (onUpdated) onUpdated({ ...playlist, ...updated });
      }
    } catch (e) {
      console.error('Failed to update public status:', e);
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
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#FF4FA3]/15 text-[#FF4FA3] flex items-center justify-center border border-[#FF4FA3]/25">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">Manage Sharing</h2>
              <p className="text-xs text-zinc-400 mt-0.5 truncate max-w-xs">{playlist.name}</p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          {error && (
            <div className="p-3 bg-red-950/40 border border-red-500/30 rounded-xl text-red-300 text-xs">
              {error}
            </div>
          )}

          {successMsg && (
            <div className="p-3 bg-emerald-950/40 border border-emerald-500/30 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Visibility Section */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider block">
              General Access
            </label>
            <div className="flex items-center justify-between p-3.5 bg-[#0D0E15] border border-white/5 rounded-xl">
              <div className="flex items-center gap-3">
                {isPublic ? (
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center border border-emerald-500/25">
                    <Globe className="w-4 h-4" />
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-zinc-800 text-zinc-400 flex items-center justify-center border border-white/5">
                    <Lock className="w-4 h-4" />
                  </div>
                )}
                <div>
                  <span className="text-xs font-bold text-white block">
                    {isPublic ? 'Public Playlist' : 'Private Playlist'}
                  </span>
                  <span className="text-[11px] text-zinc-400 block">
                    {isPublic ? 'Anyone on this server can view and play' : 'Only you and specific collaborators can access'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleTogglePublic(!isPublic)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  isPublic
                    ? 'bg-zinc-800 text-zinc-300 border-white/10 hover:bg-zinc-700'
                    : 'bg-[#FF4FA3]/15 text-[#FF4FA3] border-[#FF4FA3]/30 hover:bg-[#FF4FA3] hover:text-white'
                }`}
              >
                {isPublic ? 'Make Private' : 'Make Public'}
              </button>
            </div>
          </div>

          {/* Add Collaborator Form */}
          <form onSubmit={handleAddCollaborator} className="space-y-2">
            <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider block">
              Invite Collaborator
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Enter username (e.g. test2)"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#0D0E15] border border-white/10 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#FF4FA3] focus:ring-1 focus:ring-[#FF4FA3] transition-all"
                />
              </div>

              <select
                value={permission}
                onChange={(e) => setPermission(e.target.value as 'view' | 'edit')}
                className="px-3 py-2 bg-[#0D0E15] border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-[#FF4FA3] transition-all shrink-0"
              >
                <option value="view">Can View</option>
                <option value="edit">Can Edit</option>
              </select>

              <button
                type="submit"
                disabled={submitting || !username.trim()}
                className="px-4 py-2 bg-[#FF4FA3] hover:bg-[#e0378b] disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-md shadow-[#FF4FA3]/20 transition-all inline-flex items-center gap-1.5 shrink-0"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                <span>Add</span>
              </button>
            </div>
          </form>

          {/* Collaborators List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-300 uppercase tracking-wider block">
                Who Has Access
              </label>
              <span className="text-[11px] text-zinc-500 font-mono">
                {collaborators.length + 1} user{collaborators.length > 0 ? 's' : ''}
              </span>
            </div>

            <div className="bg-[#0D0E15] border border-white/5 rounded-xl divide-y divide-white/5 overflow-hidden max-h-56 overflow-y-auto">
              {/* Owner Row */}
              <div className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-white/10 flex items-center justify-center text-xs font-bold text-white">
                    {playlist.ownerName?.[0]?.toUpperCase() || 'O'}
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-white block">
                      {playlist.ownerName || `User #${playlist.userId}`}
                    </span>
                    <span className="text-[10px] text-zinc-400 block">Creator / Owner</span>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-zinc-800 text-zinc-300 border border-white/10">
                  Owner
                </span>
              </div>

              {/* Shared Users */}
              {collaborators.map((collab) => (
                <div key={collab.id} className="p-3 flex items-center justify-between hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#141622] border border-white/10 flex items-center justify-center text-xs font-bold text-zinc-300">
                      {collab.username?.[0]?.toUpperCase() || 'U'}
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-white block">{collab.username}</span>
                      <span className="text-[10px] text-zinc-400 capitalize block">
                        {collab.permission === 'edit' ? 'Can add & edit songs' : 'Can view & play'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                      collab.permission === 'edit'
                        ? 'bg-[#FF4FA3]/15 text-[#FF4FA3] border-[#FF4FA3]/30'
                        : 'bg-zinc-800/80 text-zinc-300 border-white/10'
                    }`}>
                      {collab.permission === 'edit' ? 'Editor' : 'Viewer'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCollaborator(collab.userId)}
                      className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      title="Remove access"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}

              {collaborators.length === 0 && (
                <div className="p-4 text-center text-xs text-zinc-500">
                  No individual collaborators invited yet.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/5 bg-[#0E0F17] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-white/10 hover:bg-white/15 text-white rounded-xl text-xs font-semibold transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
