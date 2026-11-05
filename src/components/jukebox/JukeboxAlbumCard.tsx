import React from 'react';
import { Disc } from 'lucide-react';

type Props = { album: any; onOpen: () => void; layout?: 'grid' | 'list' };

export default function JukeboxAlbumCard({ album, onOpen, layout = 'grid' }: Props) {
  return (
    <button type="button" onClick={onOpen} aria-label={`Open album ${album?.title || 'Unknown Album'}`}
      className={`group min-w-0 w-full text-left transition hover:border-[#F472B6]/40 hover:bg-[#1A1C2C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F472B6] ${layout === 'list' ? 'flex items-center gap-3 rounded-xl border border-white/5 bg-[#141622] p-2.5' : 'flex flex-col rounded-xl p-2 hover:bg-white/[0.04] sm:p-3'}`}>
      <span className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/5 bg-[#1A1C2C] ${layout === 'list' ? 'h-14 w-14' : 'mb-3 aspect-square w-full'}`}>
        {album?.hasArtwork ? <img src={`/api/albums/${album.id}/artwork`} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover yk-artwork-image" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} /> : <Disc className="h-10 w-10 text-zinc-500 transition-colors group-hover:text-[#F472B6]" />}
      </span>
      <span className={`min-w-0 flex-1 ${layout === 'grid' ? 'w-full' : ''}`}>
        <span className="block truncate text-sm font-semibold text-white transition-colors group-hover:text-[#F472B6]">{album?.title || 'Unknown Album'}</span>
        <span className="mt-0.5 block truncate text-xs text-zinc-400">{album?.artist || 'Unknown Artist'}</span>
        <span className="mt-1 block truncate text-[11px] text-zinc-500">{album?.year || 'Album'} • {album?.songCount || album?.songs?.length || 0} Tracks</span>
      </span>
    </button>
  );
}
