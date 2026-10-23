import { Playlist } from '../../types';
import { ListMusic, Plus, Play, Edit2, Share2, Copy } from 'lucide-react';

interface PlaylistsGridProps {
  playlists: Playlist[];
  currentUser?: any;
  onOpenPlaylist: (playlistId: number) => Promise<void>;
  onCreateNew: () => void;
  onEdit: (playlist: Playlist) => void;
  onShare: (playlist: Playlist) => void;
  onDuplicate?: (playlist: Playlist) => void;
  onClear?: () => void;
  layout?: string;
  onSelectPlaylist?: (playlist: Playlist) => void;
  onCreatePlaylist?: () => void;
  onPlayPlaylist?: (playlist: Playlist) => void;
}

export default function PlaylistsGrid({
  playlists,
  onOpenPlaylist,
  onCreateNew,
  onEdit,
  onShare,
  onDuplicate,
  onSelectPlaylist,
  onCreatePlaylist,
  onPlayPlaylist,
}: PlaylistsGridProps) {
  const handleCreate = onCreateNew || onCreatePlaylist || (() => {});
  const handleSelect = onOpenPlaylist ? (p: Playlist) => onOpenPlaylist(p.id) : (onSelectPlaylist || (() => {}));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-zinc-100">Playlists</h2>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>New Playlist</span>
        </button>
      </div>

      {playlists.length === 0 ? (
        <div className="text-center py-16 bg-zinc-900/40 border border-zinc-800 rounded-2xl">
          <ListMusic className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-zinc-300">No playlists yet</h3>
          <p className="text-sm text-zinc-500 mt-1">Create your first playlist to organize your favorite karaoke songs.</p>
          <button
            onClick={handleCreate}
            className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Create Playlist</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
          {playlists.map((p: any) => {
            const title = p.title || p.name || 'Untitled';
            const hasArt = p.artworkPath || p.coverPath;
            return (
              <div
                key={p.id}
                onClick={() => handleSelect(p)}
                className="group relative bg-zinc-900/60 border border-zinc-800/80 hover:border-indigo-500/50 rounded-2xl p-4 cursor-pointer transition-all hover:shadow-xl hover:shadow-indigo-500/10 flex flex-col"
              >
                <div className="relative aspect-square bg-zinc-800 rounded-xl overflow-hidden mb-4 flex items-center justify-center">
                  {hasArt ? (
                    <img
                      src={`/api/playlists/${p.id}/artwork`}
                      alt={title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <ListMusic className="w-12 h-12 text-zinc-600" />
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    {onPlayPlaylist && (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onPlayPlaylist(p);
                        }}
                        className="p-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full shadow-lg transition-transform hover:scale-110"
                      >
                        <Play className="w-5 h-5 fill-current" />
                      </button>
                    )}
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        onEdit(p);
                      }}
                      className="p-2 bg-zinc-800/80 hover:bg-zinc-700 text-white rounded-full shadow-lg transition-transform hover:scale-110"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        onShare(p);
                      }}
                      className="p-2 bg-zinc-800/80 hover:bg-zinc-700 text-white rounded-full shadow-lg transition-transform hover:scale-110"
                    >
                      <Share2 className="w-4 h-4" />
                    </button>
                    {onDuplicate && (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onDuplicate(p);
                        }}
                        className="p-2 bg-zinc-800/80 hover:bg-zinc-700 text-white rounded-full shadow-lg transition-transform hover:scale-110"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
                <h3 className="font-semibold text-zinc-100 truncate mb-1">{title}</h3>
                <p className="text-xs text-zinc-400">{p.songCount || 0} songs</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
