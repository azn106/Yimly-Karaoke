import React, { useState, useEffect } from 'react';
import { X, Search, Plus, Check, Music, Loader2, AlertCircle } from 'lucide-react';
import { Playlist, PlaylistSongItem } from '../../types';
import LyricBadges from '../LyricBadges';

interface AddSongsModalProps {
  isOpen: boolean;
  playlist: Playlist | null;
  onClose: () => void;
  onSongAdded: (song: PlaylistSongItem) => void;
}

export default function AddSongsModal({
  isOpen,
  playlist,
  onClose,
  onSongAdded,
}: AddSongsModalProps) {
  const [search, setSearch] = useState('');
  const [allSongs, setAllSongs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && playlist) {
      loadLibrarySongs();
      // Initialize existing song IDs in playlist
      const existing = new Set<number>();
      if (playlist.songs && Array.isArray(playlist.songs)) {
        playlist.songs.forEach((s) => existing.add(s.id));
      }
      setAddedIds(existing);
    }
  }, [isOpen, playlist]);

  const loadLibrarySongs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/songs');
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        setAllSongs(Array.isArray(data) ? data : []);
      } else {
        throw new Error('Failed to load songs');
      }
    } catch (e: any) {
      console.error(e);
      setError('Could not load library songs');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !playlist) return null;

  const filteredSongs = allSongs.filter((song) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const titleMatch = song.title?.toLowerCase().includes(q);
    const artistMatch = song.artist?.toLowerCase().includes(q);
    const albumMatch = song.album?.toLowerCase().includes(q);
    return titleMatch || artistMatch || albumMatch;
  });

  const handleAddSong = async (song: any) => {
    if (addingId || addedIds.has(song.id)) return;
    setAddingId(song.id);
    try {
      const res = await fetch(`/api/playlists/${playlist.id}/songs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId: song.id }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to add song' }));
        throw new Error(data.error || 'Failed to add song');
      }

      const inserted = await res.json();
      setAddedIds((prev) => new Set(prev).add(song.id));
      onSongAdded({
        playlistSongId: inserted.id,
        position: inserted.position,
        addedAt: inserted.addedAt,
        id: song.id,
        title: song.title,
        artist: song.artist,
        artists: song.artists,
        album: song.album,
        albumId: song.albumId,
        duration: song.duration,
        variant: song.variant,
        hasArtwork: song.hasArtwork,
        hasLrc: song.hasLrc,
        hasElrc: song.hasElrc,
      });
    } catch (e: any) {
      alert(e.message || 'Failed to add song to playlist');
    } finally {
      setAddingId(null);
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div 
        className="w-full max-w-2xl bg-[#141622] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">Add Songs to Playlist</h2>
            <p className="text-xs text-zinc-400 mt-0.5 truncate max-w-sm">
              Adding to <span className="text-white font-medium">{playlist.name}</span>
            </p>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-4 border-b border-white/5 bg-[#0D0E15]">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              autoFocus
              placeholder="Search library songs by title, artist, or album..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-[#141622] border border-white/10 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#FF4FA3] focus:ring-1 focus:ring-[#FF4FA3] transition-all"
            />
          </div>
        </div>

        {/* Song List */}
        <div className="flex-1 overflow-y-auto divide-y divide-white/5 max-h-96 p-2">
          {loading && (
            <div className="py-16 text-center text-zinc-400 text-xs flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-[#FF4FA3]" />
              <span>Loading media library...</span>
            </div>
          )}

          {error && (
            <div className="p-4 m-4 bg-red-950/40 border border-red-500/30 rounded-xl text-red-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && filteredSongs.map((song) => {
            const isAdded = addedIds.has(song.id);
            const isAdding = addingId === song.id;

            return (
              <div 
                key={song.id}
                className="p-3 flex items-center justify-between hover:bg-white/5 rounded-xl transition-colors gap-3"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-lg bg-zinc-800 border border-white/10 flex items-center justify-center shrink-0 overflow-hidden">
                    {song.hasArtwork ? (
                      <img
                        src={`/api/songs/${song.id}/artwork`}
                        alt={song.title}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <Music className="w-4 h-4 text-zinc-400" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white truncate block">{song.title}</span>
                      <LyricBadges
                        hasLrc={song.hasLrc}
                        hasElrc={song.hasElrc}
                      />
                    </div>
                    <span className="text-[11px] text-zinc-400 truncate block">
                      {song.artist} {song.album ? `• ${song.album}` : ''}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-zinc-500 font-mono text-xs hidden sm:inline">
                    {formatDuration(song.duration)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleAddSong(song)}
                    disabled={isAdded || isAdding}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-all ${
                      isAdded
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-[#FF4FA3]/15 hover:bg-[#FF4FA3] text-[#FF4FA3] hover:text-white border border-[#FF4FA3]/30'
                    }`}
                  >
                    {isAdding ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : isAdded ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Plus className="w-3.5 h-3.5" />
                    )}
                    <span>{isAdded ? 'Added' : 'Add'}</span>
                  </button>
                </div>
              </div>
            );
          })}

          {!loading && !error && filteredSongs.length === 0 && (
            <div className="py-16 text-center text-zinc-500 text-xs">
              No matching songs found in library.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/5 bg-[#0E0F17] flex justify-between items-center">
          <span className="text-xs text-zinc-400">
            {addedIds.size} song{addedIds.size === 1 ? '' : 's'} in playlist
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-[#FF4FA3] hover:bg-[#e0378b] text-white rounded-xl text-xs font-semibold shadow-md shadow-[#FF4FA3]/20 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
