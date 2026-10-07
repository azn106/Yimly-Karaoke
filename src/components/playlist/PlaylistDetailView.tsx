import React, { useState, useRef } from 'react';
import { 
  ArrowLeft, 
  Play, 
  Plus, 
  Edit3, 
  Share2, 
  Trash2, 
  Globe, 
  Lock, 
  Users, 
  Music, 
  Disc, 
  Upload, 
  Image as ImageIcon, 
  Copy, 
  Eraser, 
  Check, 
  MoreVertical, 
  ArrowUp, 
  ArrowDown,
  Loader2,
  Shield
} from 'lucide-react';
import { Playlist, PlaylistSongItem } from '../../types';
import LyricBadges from '../LyricBadges';

interface PlaylistDetailViewProps {
  playlist: Playlist;
  currentUser: any;
  onBack: () => void;
  onOpenArtist: (artistId: number) => void;
  onOpenAlbum: (albumId: number) => void;
  onAddToQueue: (songId: number) => void;
  onPlayAll: (playlist: Playlist) => void;
  onOpenAddSongs: () => void;
  onOpenEdit: () => void;
  onOpenShare: () => void;
  onDuplicate: () => void;
  onClear: () => void;
  onDelete: () => void;
  onCoverUpload: (file: File) => void;
  onCoverRemove: () => void;
  onRemoveSong: (playlistSongId: number) => void;
  onReorderSong: (playlistSongId: number, direction: 'up' | 'down') => void;
  queuedSongId: number | null;
  playingAll?: boolean;
  onOpenLyrics?: (songId: number, title: string, format: 'lrc' | 'elrc') => void;
}

export default function PlaylistDetailView({
  playlist,
  currentUser,
  onBack,
  onOpenArtist,
  onOpenAlbum,
  onAddToQueue,
  onPlayAll,
  onOpenAddSongs,
  onOpenEdit,
  onOpenShare,
  onDuplicate,
  onClear,
  onDelete,
  onCoverUpload,
  onCoverRemove,
  onRemoveSong,
  onOpenLyrics,
  onReorderSong,
  queuedSongId,
  playingAll = false,
}: PlaylistDetailViewProps) {
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isOwner = playlist.userId === currentUser?.id;
  const isAdmin = currentUser?.role === 'administrator';
  const canEdit = playlist.canEdit || isOwner || isAdmin;
  const songs = playlist.songs || [];

  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onCoverUpload(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const totalDuration = songs.reduce((acc, s) => acc + (s.duration || 0), 0);
  const formattedTotalTime = totalDuration > 0 ? `${Math.floor(totalDuration / 60)} min` : null;

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto space-y-8 animate-in fade-in duration-200">
      {/* Hidden cover input */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handleFilePicked}
      />

      {/* Back button */}
      <button 
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Library
      </button>

      {/* Hero Header */}
      <div className="flex flex-col md:flex-row items-center md:items-start gap-8 bg-[#141622] p-8 rounded-3xl border border-white/5 shadow-2xl relative overflow-hidden">
        {/* Cover with hover change overlay if canEdit */}
        <div className="relative group shrink-0">
          <div className="w-44 h-44 rounded-2xl bg-gradient-to-br from-[#1E2033] to-[#12131F] flex items-center justify-center border border-white/10 shadow-xl shadow-[#FF4FA3]/10 overflow-hidden">
            {playlist.coverPath || playlist.coverImageUrl ? (
              <img
                src={playlist.coverImageUrl || `/api/playlists/${playlist.id}/cover`}
                alt={playlist.name}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <Music className="w-16 h-16 text-[#FF4FA3]" />
            )}
          </div>

          {canEdit && (
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="absolute inset-0 bg-black/60 backdrop-blur-xs opacity-0 group-hover:opacity-100 rounded-2xl flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-opacity text-white text-xs font-semibold"
            >
              <Upload className="w-6 h-6 text-[#FF4FA3]" />
              <span>Change Cover</span>
            </div>
          )}
        </div>

        {/* Details & Actions */}
        <div className="flex-1 text-center md:text-left min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
            <span className="text-xs uppercase tracking-widest text-[#FF4FA3] font-bold">
              Playlist
            </span>

            {/* Visibility Badge */}
            {playlist.isPublic ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                <Globe className="w-3 h-3" /> Public
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-800 text-zinc-400 border border-white/10">
                <Lock className="w-3 h-3" /> Private
              </span>
            )}

            {/* Permission Badge */}
            {isAdmin ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/25">
                <Shield className="w-3 h-3" /> Administrator
              </span>
            ) : isOwner ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-800 text-zinc-300 border border-white/10">
                Owner
              </span>
            ) : playlist.permission === 'edit' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FF4FA3]/15 text-[#FF4FA3] border border-[#FF4FA3]/25">
                Editor
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-800 text-zinc-400 border border-white/10">
                Viewer
              </span>
            )}
          </div>

          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight break-words">
              {playlist.name}
            </h1>
            {playlist.description && (
              <p className="text-sm text-zinc-300 mt-1 max-w-2xl leading-relaxed">
                {playlist.description}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-center md:justify-start gap-x-3 gap-y-1 text-xs text-zinc-400">
            <span className="font-medium text-zinc-200">
              Created by {isOwner ? 'You' : (playlist.ownerName || 'User')}
            </span>
            <span>•</span>
            <span>{songs.length} Song{songs.length === 1 ? '' : 's'}</span>
            {formattedTotalTime && (
              <>
                <span>•</span>
                <span>{formattedTotalTime}</span>
              </>
            )}
          </div>

          {/* Action Toolbar */}
          <div className="pt-2 flex flex-wrap items-center justify-center md:justify-start gap-3">
            <button
              type="button"
              onClick={() => onPlayAll(playlist)}
              disabled={songs.length === 0 || playingAll}
              className="px-5 py-2.5 bg-[#FF4FA3] hover:bg-[#e0378b] text-white rounded-xl text-xs font-bold shadow-lg shadow-[#FF4FA3]/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all inline-flex items-center gap-2"
            >
              {playingAll ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4 fill-white" />
              )}
              <span>{playingAll ? 'Adding to Room...' : 'Play in Room'}</span>
            </button>

            {canEdit && (
              <button
                type="button"
                onClick={onOpenAddSongs}
                className="px-4 py-2.5 bg-[#1C1E2D] hover:bg-[#25283C] text-white rounded-xl text-xs font-semibold border border-white/10 hover:border-[#FF4FA3]/40 transition-colors inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4 text-[#FF4FA3]" />
                <span>Add Songs</span>
              </button>
            )}

            {canEdit && (
              <button
                type="button"
                onClick={onOpenEdit}
                className="px-4 py-2.5 bg-[#1C1E2D] hover:bg-[#25283C] text-zinc-200 hover:text-white rounded-xl text-xs font-semibold border border-white/10 transition-colors inline-flex items-center gap-1.5"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Edit</span>
              </button>
            )}

            {(isOwner || isAdmin) && (
              <button
                type="button"
                onClick={onOpenShare}
                className="px-4 py-2.5 bg-[#1C1E2D] hover:bg-[#25283C] text-zinc-200 hover:text-white rounded-xl text-xs font-semibold border border-white/10 transition-colors inline-flex items-center gap-1.5"
              >
                <Share2 className="w-3.5 h-3.5 text-[#FF4FA3]" />
                <span>Share</span>
              </button>
            )}

            {/* More Options Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMoreMenuOpen(!moreMenuOpen)}
                className="p-2.5 bg-[#1C1E2D] hover:bg-[#25283C] text-zinc-400 hover:text-white rounded-xl border border-white/10 transition-colors"
                title="More actions"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {moreMenuOpen && (
                <div 
                  className="absolute left-0 md:left-auto md:right-0 top-11 w-52 bg-[#181A28] border border-white/15 rounded-xl shadow-2xl z-30 py-1.5 text-xs text-zinc-300 divide-y divide-white/5"
                  onClick={() => setMoreMenuOpen(false)}
                >
                  <div className="py-1">
                    <button
                      type="button"
                      onClick={onDuplicate}
                      className="w-full px-3.5 py-2 text-left hover:bg-white/5 hover:text-white flex items-center gap-2"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Duplicate Playlist</span>
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full px-3.5 py-2 text-left hover:bg-white/5 hover:text-white flex items-center gap-2"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Change Cover</span>
                      </button>
                    )}
                    {canEdit && playlist.coverPath && (
                      <button
                        type="button"
                        onClick={onCoverRemove}
                        className="w-full px-3.5 py-2 text-left hover:bg-white/5 hover:text-zinc-200 flex items-center gap-2"
                      >
                        <ImageIcon className="w-3.5 h-3.5" />
                        <span>Remove Cover</span>
                      </button>
                    )}
                  </div>

                  {canEdit && songs.length > 0 && (
                    <div className="py-1">
                      <button
                        type="button"
                        onClick={onClear}
                        className="w-full px-3.5 py-2 text-left hover:bg-amber-950/40 text-amber-300 flex items-center gap-2"
                      >
                        <Eraser className="w-3.5 h-3.5" />
                        <span>Clear All Songs</span>
                      </button>
                    </div>
                  )}

                  {(isOwner || isAdmin) && (
                    <div className="py-1">
                      <button
                        type="button"
                        onClick={onDelete}
                        className="w-full px-3.5 py-2 text-left hover:bg-red-950/60 text-red-400 hover:text-red-300 flex items-center gap-2"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete Playlist</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tracklist */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white tracking-tight">Tracks</h2>
          <span className="text-xs text-zinc-400">{songs.length} song{songs.length === 1 ? '' : 's'}</span>
        </div>

        <div className="bg-[#141622] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#0E0F17] text-zinc-400 border-b border-white/5 text-xs font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3.5 w-14">#</th>
                <th className="px-4 py-3.5">Title</th>
                <th className="px-4 py-3.5 hidden sm:table-cell">Artist</th>
                <th className="px-4 py-3.5 hidden md:table-cell">Album</th>
                <th className="px-4 py-3.5">Duration</th>
                <th className="px-4 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {songs.map((song, idx) => {
                const isQueued = queuedSongId === song.id;

                return (
                  <tr key={song.playlistSongId || song.id} className="hover:bg-[#1A1C2C]/60 transition-colors group">
                    {/* Position & Reorder */}
                    <td className="px-4 py-3.5 text-zinc-500 font-mono text-xs">
                      {canEdit ? (
                        <div className="flex items-center gap-1">
                          <span>{idx + 1}</span>
                          <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => onReorderSong(song.playlistSongId, 'up')}
                              className="text-zinc-500 hover:text-white disabled:opacity-20 p-0.5"
                              title="Move up"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === songs.length - 1}
                              onClick={() => onReorderSong(song.playlistSongId, 'down')}
                              className="text-zinc-500 hover:text-white disabled:opacity-20 p-0.5"
                              title="Move down"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <span>{idx + 1}</span>
                      )}
                    </td>

                    {/* Title */}
                    <td className="px-4 py-3.5 font-medium text-white flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center shrink-0 overflow-hidden">
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
                          <Music className="w-4 h-4 text-zinc-400 group-hover:text-[#FF4FA3] transition-colors" />
                        )}
                      </div>

                      <div className="min-w-0 flex items-center gap-2">
                        <span className="truncate block">{song.title}</span>
                        <LyricBadges
                          hasLrc={song.hasLrc}
                          hasElrc={song.hasElrc}
                          onOpenLyrics={(format) => onOpenLyrics?.(song.id, song.title, format)}
                        />
                      </div>
                    </td>

                    {/* Artist */}
                    <td className="px-4 py-3.5 text-zinc-300 text-xs truncate max-w-xs hidden sm:table-cell">
                      {song.artists && Array.isArray(song.artists) && song.artists.length > 0 ? (
                        song.artists.map((a, i) => (
                          <span key={a.id || i}>
                            {a.id ? (
                              <button
                                type="button"
                                onClick={() => onOpenArtist(a.id!)}
                                className="hover:text-[#FF4FA3] hover:underline"
                              >
                                {a.name}
                              </button>
                            ) : (
                              <span>{a.name}</span>
                            )}
                            {i < (song.artists?.length ?? 0) - 1 && ', '}
                          </span>
                        ))
                      ) : (
                        <span>{song.artist}</span>
                      )}
                    </td>

                    {/* Album */}
                    <td className="px-4 py-3.5 text-zinc-400 text-xs truncate max-w-xs hidden md:table-cell">
                      {song.albumId ? (
                        <button
                          type="button"
                          onClick={() => onOpenAlbum(song.albumId!)}
                          className="hover:text-white hover:underline text-left truncate max-w-full"
                        >
                          {song.album}
                        </button>
                      ) : (
                        song.album || '—'
                      )}
                    </td>

                    {/* Duration */}
                    <td className="px-4 py-3.5 text-zinc-400 text-xs font-mono">
                      {formatDuration(song.duration)}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => onAddToQueue(song.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-all ${
                            isQueued
                              ? 'bg-[#FF4FA3] text-white'
                              : 'bg-[#FF4FA3]/15 hover:bg-[#FF4FA3] text-[#FF4FA3] hover:text-white border border-[#FF4FA3]/30'
                          }`}
                          title="Add song to active karaoke room queue"
                        >
                          {isQueued ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                          <span className="hidden sm:inline">{isQueued ? 'Added' : 'Queue'}</span>
                        </button>

                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => onRemoveSong(song.playlistSongId)}
                            className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                            title="Remove song from playlist"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {songs.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-zinc-500">
                    <Music className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                    <p className="text-sm font-medium text-zinc-400">This playlist is currently empty</p>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={onOpenAddSongs}
                        className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 bg-[#FF4FA3]/15 hover:bg-[#FF4FA3] text-[#FF4FA3] hover:text-white rounded-lg text-xs font-semibold border border-[#FF4FA3]/30 transition-all"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add First Song</span>
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
