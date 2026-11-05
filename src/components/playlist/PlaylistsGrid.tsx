import React, { useState, useRef, useEffect } from 'react';
import { MoreVertical, Play, Lock, Globe, Edit3, Share2, Trash2, Copy, Eraser, Image as ImageIcon, Upload, Plus } from 'lucide-react';
import { Playlist } from '../../types';
import JukeboxPlaylistCard from '../jukebox/JukeboxPlaylistCard';

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
  layout?: 'grid' | 'list' | 'carousel';
}

export default function PlaylistsGrid({
  playlists, currentUser, onOpenPlaylist, onCreateNew, onEdit, onShare, onDuplicate, onClear, onDelete,
  onCoverUpload, onCoverRemove, onPlayAll, layout = 'grid',
}: PlaylistsGridProps) {
  const [activeMenuId, setActiveMenuId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPlaylistId, setUploadingPlaylistId] = useState<number | null>(null);
  const isAdmin = currentUser?.role === 'administrator';

  useEffect(() => {
    const close = () => setActiveMenuId(null);
    if (activeMenuId !== null) {
      document.addEventListener('click', close);
      return () => document.removeEventListener('click', close);
    }
  }, [activeMenuId]);

  const triggerUpload = (playlistId: number) => {
    setUploadingPlaylistId(playlistId);
    fileInputRef.current?.click();
  };

  const handleFilePicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && uploadingPlaylistId !== null) onCoverUpload(uploadingPlaylistId, file);
    setUploadingPlaylistId(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const effectiveLayout = layout === 'carousel' ? 'carousel' : viewMode;
  const cardLayout = effectiveLayout === 'carousel' ? 'grid' : effectiveLayout;

  return (
    <div className="space-y-6">
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={handleFilePicked} />
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Playlists</h2>
          <p className="mt-0.5 text-xs text-zinc-400">{playlists.length} playlist{playlists.length === 1 ? '' : 's'} available</p>
        </div>
        <div className="flex items-center gap-2">
          {layout !== 'carousel' && <div className="inline-flex rounded-lg border border-white/10 bg-[#141622] p-1">
            <button type="button" onClick={() => setViewMode('grid')} aria-pressed={viewMode === 'grid'} className={`rounded-md px-3 py-1.5 text-xs ${viewMode === 'grid' ? 'bg-[#F472B6] text-white' : 'text-zinc-400 hover:text-white'}`}>Grid</button>
            <button type="button" onClick={() => setViewMode('list')} aria-pressed={viewMode === 'list'} className={`rounded-md px-3 py-1.5 text-xs ${viewMode === 'list' ? 'bg-[#F472B6] text-white' : 'text-zinc-400 hover:text-white'}`}>List</button>
          </div>}
        <button type="button" onClick={onCreateNew} className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[#F472B6] px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-[#F472B6]/20 transition hover:bg-[#DB2777]">
          <Plus className="h-4 w-4" /><span>New Playlist</span>
        </button>
        </div>
      </div>

      <div className={effectiveLayout === 'carousel' ? 'yk-horizontal-rail flex items-stretch gap-4 overflow-x-auto pb-4 snap-x snap-mandatory' : effectiveLayout === 'list' ? 'flex flex-col gap-2' : 'grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'}>
        {playlists.map(playlist => {
          const isOwner = playlist.userId === currentUser?.id;
          const canEdit = playlist.canEdit || isOwner || isAdmin;
          const isMenuOpen = activeMenuId === playlist.id;
          return (
            <div key={playlist.id} className={effectiveLayout === 'carousel' ? 'w-44 shrink-0 snap-start' : 'min-w-0'}>
              <JukeboxPlaylistCard playlist={playlist} onOpen={() => onOpenPlaylist(playlist.id)} onPlay={() => onPlayAll(playlist)} layout={cardLayout}>
                <div className="relative" onClick={event => event.stopPropagation()}>
                  {playlist.isPublic && <span title="Public playlist" className="mr-1 inline-flex rounded-md bg-black/50 p-1 text-emerald-400"><Globe className="h-3.5 w-3.5" /></span>}
                  {!playlist.isPublic && <span title="Private playlist" className="mr-1 inline-flex rounded-md bg-black/50 p-1 text-zinc-400"><Lock className="h-3.5 w-3.5" /></span>}
                  {playlist.permission === 'edit' && !isOwner && !isAdmin && <span title="Collaborative editor" className="mr-1 rounded-md bg-[#F472B6]/80 px-1.5 py-1 text-[9px] font-bold uppercase text-white">Edit</span>}
                  <button type="button" onClick={event => { event.stopPropagation(); setActiveMenuId(isMenuOpen ? null : playlist.id); }} className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/10 hover:text-white" title="More options" aria-label={`More options for ${playlist.name}`}>
                    <MoreVertical className="h-4 w-4" />
                  </button>
                  {isMenuOpen && (
                    <div className={`absolute right-0 top-8 z-40 w-48 rounded-xl border border-white/15 bg-[#181A28] py-1.5 text-xs text-zinc-300 shadow-2xl ${cardLayout === 'list' ? '' : ''}`}>
                      <button type="button" onClick={() => { setActiveMenuId(null); onPlayAll(playlist); }} className="flex w-full items-center gap-2 px-3.5 py-2 text-left hover:bg-[#F472B6]/15 hover:text-[#F472B6]"><Play className="h-3.5 w-3.5" />Play in Room</button>
                      <button type="button" onClick={() => { setActiveMenuId(null); onOpenPlaylist(playlist.id); }} className="flex w-full items-center gap-2 px-3.5 py-2 text-left hover:bg-white/5 hover:text-white">View Details</button>
                      {canEdit && <>
                        <button type="button" onClick={() => { setActiveMenuId(null); onEdit(playlist); }} className="flex w-full items-center gap-2 px-3.5 py-2 text-left hover:bg-white/5 hover:text-white"><Edit3 className="h-3.5 w-3.5" />Edit Details</button>
                        <button type="button" onClick={() => { setActiveMenuId(null); triggerUpload(playlist.id); }} className="flex w-full items-center gap-2 px-3.5 py-2 text-left hover:bg-white/5 hover:text-white"><Upload className="h-3.5 w-3.5" />{playlist.coverPath ? 'Replace Cover' : 'Upload Cover'}</button>
                        {playlist.coverPath && <button type="button" onClick={() => { setActiveMenuId(null); onCoverRemove(playlist.id); }} className="flex w-full items-center gap-2 px-3.5 py-2 text-left hover:bg-white/5 hover:text-red-300"><ImageIcon className="h-3.5 w-3.5" />Remove Cover</button>}
                      </>}
                      {(isOwner || isAdmin) && <button type="button" onClick={() => { setActiveMenuId(null); onShare(playlist); }} className="flex w-full items-center gap-2 px-3.5 py-2 text-left hover:bg-white/5 hover:text-white"><Share2 className="h-3.5 w-3.5" />Manage Sharing</button>}
                      <button type="button" onClick={() => { setActiveMenuId(null); onDuplicate(playlist); }} className="flex w-full items-center gap-2 px-3.5 py-2 text-left hover:bg-white/5 hover:text-white"><Copy className="h-3.5 w-3.5" />Duplicate Playlist</button>
                      {canEdit && (playlist.songCount || 0) > 0 && <button type="button" onClick={() => { setActiveMenuId(null); onClear(playlist); }} className="flex w-full items-center gap-2 px-3.5 py-2 text-left hover:bg-white/5 hover:text-amber-300"><Eraser className="h-3.5 w-3.5" />Clear All Songs</button>}
                      {(isOwner || isAdmin) && <button type="button" onClick={() => { setActiveMenuId(null); onDelete(playlist); }} className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-red-400 hover:bg-red-950/60"><Trash2 className="h-3.5 w-3.5" />Delete Playlist</button>}
                    </div>
                  )}
                </div>
              </JukeboxPlaylistCard>
            </div>
          );
        })}
        {playlists.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center space-y-4 py-20 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-[#141622] text-[#F472B6]"><Plus className="h-8 w-8" /></div>
            <div><h3 className="text-base font-bold text-white">No playlists found</h3><p className="mt-1 max-w-sm text-xs text-zinc-400">Create a playlist to organize your karaoke songs for sessions, parties, or favorite genres.</p></div>
            <button type="button" onClick={onCreateNew} className="rounded-full bg-[#F472B6] px-4 py-2 text-xs font-semibold text-white hover:bg-[#DB2777]">Create First Playlist</button>
          </div>
        )}
      </div>
    </div>
  );
}
