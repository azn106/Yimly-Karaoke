import React, { useState, useRef, useEffect } from 'react';
import { 
  ListMusic, 
  MoreVertical, 
  Play, 
  Lock, 
  Globe, 
  Users, 
  Edit3, 
  Share2, 
  Trash2, 
  Copy, 
  Eraser, 
  Image as ImageIcon, 
  Upload, 
  Plus, 
  Check, 
  Disc,
  Shield
} from 'lucide-react';
import { Playlist } from '../../types';

interface PlaylistsGridProps {
  playlists: Playlist[];
  currentUser: any;
  onOpenPlaylist: (playlistId: number) => void;
  onCreateNew: () => void;
  onEdit: (playlist: Playlist) => void;
  onShare: (playlist: Playlist) => void;
  onDuplicate: (playlist: Playlist) => void;
  onClear: (playlist: Playlist) => void;
  onDelete: (playlist: Playlist) => void;
  onCoverUpload: (playlistId: number, file: File) => void;
  onCoverRemove: (playlistId: number) => void;
  onPlayAll: (playlist: Playlist) => void;
}

export default function PlaylistsGrid({
  playlists,
  currentUser,
  onOpenPlaylist,
  onCreateNew,
  onEdit,
  onShare,
  onDuplicate,
  onClear,
  onDelete,
  onCoverUpload,
  onCoverRemove,
  onPlayAll,
}: PlaylistsGridProps) {
  const [activeMenuId, setActiveMenuId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPlaylistId, setUploadingPlaylistId] = useState<number | null>(null);

  const isAdmin = currentUser?.role === 'administrator';

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = () => setActiveMenuId(null);
    if (activeMenuId !== null) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [activeMenuId]);

  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && uploadingPlaylistId) {
      onCoverUpload(uploadingPlaylistId, file);
      setUploadingPlaylistId(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const triggerUpload = (playlistId: number) => {
    setUploadingPlaylistId(playlistId);
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-6">
      {/* Hidden file input for cover replacement */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handleFilePicked}
      />

      {/* Top Header / Create Action */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Playlists</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            {playlists.length} playlist{playlists.length === 1 ? '' : 's'} available
          </p>
        </div>

        <button
          onClick={onCreateNew}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#FF4FA3] hover:bg-[#e0378b] text-white rounded-full text-xs font-semibold shadow-lg shadow-[#FF4FA3]/20 transition-all shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>New Playlist</span>
        </button>
      </div>

      {/* Playlists Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
        {playlists.map((playlist) => {
          const isOwner = playlist.userId === currentUser?.id;
          const canEdit = playlist.canEdit || isOwner || isAdmin;
          const isMenuOpen = activeMenuId === playlist.id;

          return (
            <div
              key={playlist.id}
              onClick={() => onOpenPlaylist(playlist.id)}
              className="bg-[#141622] hover:bg-[#1A1C2C] p-4 rounded-2xl border border-white/5 hover:border-[#FF4FA3]/30 cursor-pointer transition-all group shadow-lg flex flex-col justify-between relative"
            >
              {/* Artwork / Cover Container */}
              <div className="w-full aspect-square bg-[#1C1E2D] rounded-xl mb-3 flex items-center justify-center border border-white/5 group-hover:border-[#FF4FA3]/30 transition-all relative overflow-hidden shadow-inner">
                {playlist.coverPath || playlist.coverImageUrl ? (
                  <img
                    src={playlist.coverImageUrl || `/api/playlists/${playlist.id}/cover`}
                    alt={playlist.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <ListMusic className="w-12 h-12 text-zinc-500 group-hover:text-[#FF4FA3] transition-colors" />
                )}

                {/* Hover Play button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlayAll(playlist);
                  }}
                  className="absolute bottom-2.5 right-2.5 w-10 h-10 rounded-full bg-[#FF4FA3] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transform translate-y-2 group-hover:translate-y-0 transition-all shadow-lg hover:scale-110 active:scale-95 z-10"
                  title="Queue All Songs into Karaoke Room"
                >
                  <Play className="w-4 h-4 fill-white translate-x-0.5" />
                </button>

                {/* Visibility Badge top-left */}
                <div className="absolute top-2.5 left-2.5 flex items-center gap-1 z-10">
                  {playlist.isPublic ? (
                    <span 
                      className="p-1 rounded-md bg-black/60 backdrop-blur-md text-emerald-400 border border-emerald-500/30"
                      title="Public Playlist"
                    >
                      <Globe className="w-3.5 h-3.5" />
                    </span>
                  ) : (
                    <span 
                      className="p-1 rounded-md bg-black/60 backdrop-blur-md text-zinc-400 border border-white/10"
                      title="Private Playlist"
                    >
                      <Lock className="w-3.5 h-3.5" />
                    </span>
                  )}
                  {playlist.permission === 'edit' && !isOwner && !isAdmin && (
                    <span 
                      className="px-1.5 py-0.5 rounded-md bg-[#FF4FA3]/80 backdrop-blur-md text-white text-[9px] font-bold uppercase tracking-wider"
                      title="Collaborative Editor"
                    >
                      Edit
                    </span>
                  )}
                </div>
              </div>

              {/* Title & Metadata */}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-1">
                  <h3 
                    className="font-semibold text-sm text-white truncate group-hover:text-[#FF4FA3] transition-colors"
                    title={playlist.name}
                  >
                    {playlist.name}
                  </h3>

                  {/* 3-dot More Options Menu Button */}
                  <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuId(isMenuOpen ? null : playlist.id);
                      }}
                      className="p-1 text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                      title="More options"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>

                    {/* Dropdown Menu */}
                    {isMenuOpen && (
                      <div className="absolute right-0 top-7 w-48 bg-[#181A28] border border-white/15 rounded-xl shadow-2xl z-30 py-1.5 text-xs text-zinc-300 divide-y divide-white/5 animate-in fade-in zoom-in-95 duration-100">
                        <div className="py-1">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveMenuId(null);
                              onPlayAll(playlist);
                            }}
                            className="w-full px-3.5 py-2 text-left hover:bg-[#FF4FA3]/15 hover:text-[#FF4FA3] flex items-center gap-2 transition-colors"
                          >
                            <Play className="w-3.5 h-3.5" />
                            <span>Play in Room</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveMenuId(null);
                              onOpenPlaylist(playlist.id);
                            }}
                            className="w-full px-3.5 py-2 text-left hover:bg-white/5 hover:text-white flex items-center gap-2 transition-colors"
                          >
                            <ListMusic className="w-3.5 h-3.5" />
                            <span>View Details</span>
                          </button>
                        </div>

                        {canEdit && (
                          <div className="py-1">
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuId(null);
                                onEdit(playlist);
                              }}
                              className="w-full px-3.5 py-2 text-left hover:bg-white/5 hover:text-white flex items-center gap-2 transition-colors"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              <span>Edit Details</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuId(null);
                                triggerUpload(playlist.id);
                              }}
                              className="w-full px-3.5 py-2 text-left hover:bg-white/5 hover:text-white flex items-center gap-2 transition-colors"
                            >
                              <Upload className="w-3.5 h-3.5" />
                              <span>{playlist.coverPath ? 'Replace Cover' : 'Upload Cover'}</span>
                            </button>
                            {playlist.coverPath && (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  onCoverRemove(playlist.id);
                                }}
                                className="w-full px-3.5 py-2 text-left hover:bg-white/5 hover:text-red-300 flex items-center gap-2 transition-colors"
                              >
                                <ImageIcon className="w-3.5 h-3.5" />
                                <span>Remove Cover</span>
                              </button>
                            )}
                          </div>
                        )}

                        <div className="py-1">
                          {(isOwner || isAdmin) && (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuId(null);
                                onShare(playlist);
                              }}
                              className="w-full px-3.5 py-2 text-left hover:bg-white/5 hover:text-white flex items-center gap-2 transition-colors"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                              <span>Manage Sharing</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setActiveMenuId(null);
                              onDuplicate(playlist);
                            }}
                            className="w-full px-3.5 py-2 text-left hover:bg-white/5 hover:text-white flex items-center gap-2 transition-colors"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span>Duplicate Playlist</span>
                          </button>
                          {canEdit && (playlist.songCount || 0) > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuId(null);
                                onClear(playlist);
                              }}
                              className="w-full px-3.5 py-2 text-left hover:bg-white/5 hover:text-amber-300 flex items-center gap-2 transition-colors"
                            >
                              <Eraser className="w-3.5 h-3.5" />
                              <span>Clear All Songs</span>
                            </button>
                          )}
                        </div>

                        {(isOwner || isAdmin) && (
                          <div className="py-1">
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuId(null);
                                onDelete(playlist);
                              }}
                              className="w-full px-3.5 py-2 text-left hover:bg-red-950/60 text-red-400 hover:text-red-300 flex items-center gap-2 transition-colors"
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

                <p className="text-xs text-zinc-400 truncate mt-0.5">
                  {playlist.songCount || 0} Song{(playlist.songCount || 0) === 1 ? '' : 's'}
                </p>

                <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 mt-1">
                  <span className="truncate">
                    {isOwner ? 'Created by you' : `By ${playlist.ownerName || 'User'}`}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {playlists.length === 0 && (
          <div className="col-span-full py-20 text-center flex flex-col items-center justify-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-[#141622] border border-white/10 flex items-center justify-center text-zinc-500">
              <ListMusic className="w-8 h-8 text-[#FF4FA3]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">No playlists found</h3>
              <p className="text-xs text-zinc-400 mt-1 max-w-sm">
                Create a playlist to organize your karaoke songs for sessions, parties, or favorite genres.
              </p>
            </div>
            <button
              onClick={onCreateNew}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#FF4FA3] hover:bg-[#e0378b] text-white rounded-full text-xs font-semibold shadow-md shadow-[#FF4FA3]/20 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Create First Playlist</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
