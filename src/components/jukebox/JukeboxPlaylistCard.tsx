import React from 'react';
import { ListMusic } from 'lucide-react';
import { Playlist } from '../../types';

type Props = { playlist: Playlist; onOpen: () => void; onPlay?: () => void; layout?: 'grid' | 'list'; children?: React.ReactNode };

export default function JukeboxPlaylistCard({ playlist, onOpen, onPlay, layout = 'grid', children }: Props) {
  const cover = playlist.coverImageUrl && /^(https?:|data:)/i.test(playlist.coverImageUrl) ? playlist.coverImageUrl : `/api/playlists/${playlist.id}/cover`;
  return (
    <div className={`group relative min-w-0 overflow-hidden border border-white/5 bg-[#141622] transition hover:border-[#F472B6]/40 hover:bg-[#1A1C2C] ${layout === 'list' ? 'flex items-center gap-3 rounded-xl p-2.5' : 'flex flex-col rounded-2xl p-3'}`}>
      <button type="button" onClick={onOpen} aria-label={`Open playlist ${playlist.name}`} className={`min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#F472B6] ${layout === 'list' ? 'flex flex-1 items-center gap-3' : 'w-full'}`}>
        <span className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/5 bg-[#1C1E2D] ${layout === 'list' ? 'h-14 w-14' : 'mb-3 aspect-square w-full'}`}>
          {playlist.coverPath || playlist.coverImageUrl ? <img src={cover} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover yk-artwork-image" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} /> : <ListMusic className="h-10 w-10 text-zinc-500" />}
        </span>
        <span className={`min-w-0 ${layout === 'grid' ? 'block w-full' : 'flex-1'}`}>
          <span className="block truncate text-sm font-semibold text-white group-hover:text-[#F472B6]">{playlist.name}</span>
          <span className="mt-0.5 block truncate text-xs text-zinc-400">{playlist.songCount || playlist.songs?.length || 0} songs</span>
          <span className="mt-1 block truncate text-[11px] text-zinc-500">{playlist.ownerName || 'Your playlist'}</span>
        </span>
      </button>
      {onPlay && <button type="button" onClick={onPlay} aria-label={`Play playlist ${playlist.name}`} title="Play in Room" className={`absolute flex h-8 w-8 items-center justify-center rounded-full bg-[#F472B6] text-white shadow-lg transition hover:scale-105 ${layout === 'list' ? 'right-16 top-1/2 -translate-y-1/2' : 'bottom-16 right-5'}`}><span className="ml-0.5">▶</span></button>}
      {children && <div className={`shrink-0 ${layout === 'list' ? 'ml-auto' : 'absolute right-2 top-2'}`}>{children}</div>}
    </div>
  );
}
