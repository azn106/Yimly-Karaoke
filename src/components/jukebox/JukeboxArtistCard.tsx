import React from 'react';
import { Mic } from 'lucide-react';

type Props = {
  artist: any;
  onOpen: () => void;
  layout?: 'grid' | 'list';
  artworkVersion?: number;
  artworkError?: boolean;
  onArtworkError?: () => void;
};

export default function JukeboxArtistCard({ artist, onOpen, layout = 'grid', artworkVersion = 0, artworkError = false, onArtworkError }: Props) {
  const artwork = artist?.hasArtwork && !artworkError;
  return (
    <button type="button" onClick={onOpen} aria-label={`Open artist ${artist?.name || 'Unknown Artist'}`}
      className={`group min-w-0 w-full text-left transition hover:border-[#F472B6]/40 hover:bg-[#1A1C2C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F472B6] ${layout === 'list' ? 'flex items-center gap-3 rounded-xl border border-white/5 bg-[#141622] p-2.5' : 'flex flex-col items-center rounded-xl border border-white/5 bg-[#141622] p-2 text-center sm:rounded-2xl sm:p-4'}`}>
      <span className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-[#1A1C2C] ${layout === 'list' ? 'h-14 w-14' : 'mb-2.5 aspect-square w-full max-w-[5rem]'}`}>
        <Mic className="absolute h-7 w-7 text-zinc-500 transition-colors group-hover:text-[#F472B6]" />
        {artwork && <img key={`${artist.id}-${artworkVersion}`} src={`/api/artists/${artist.id}/artwork${artworkVersion ? `?v=${artworkVersion}` : ''}`} alt="" loading="lazy" decoding="async" className="relative z-10 h-full w-full object-cover yk-artwork-image" onError={onArtworkError} />}
      </span>
      <span className={`min-w-0 flex-1 ${layout === 'grid' ? 'w-full' : ''}`}>
        <span className="block truncate text-sm font-semibold text-white transition-colors group-hover:text-[#F472B6]">{artist?.name || 'Unknown Artist'}</span>
        <span className="mt-1 block truncate text-xs text-zinc-400">{artist?.songCount || 0} Songs{artist?.albumCount !== undefined ? ` • ${artist.albumCount} Albums` : ''}</span>
      </span>
    </button>
  );
}
