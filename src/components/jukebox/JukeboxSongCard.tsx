import React from 'react';
import { Play, Pause, Music } from 'lucide-react';
import LyricBadges from '../LyricBadges';
import EqualizerIndicator from '../EqualizerIndicator';

type JukeboxSongCardProps = {
  song: any;
  isCurrent?: boolean;
  isPlaying?: boolean;
  onPlay?: () => void;
  onOpenLyrics?: (format: 'lrc' | 'elrc') => void;
  children?: React.ReactNode;
  className?: string;
  showAlbum?: boolean;
  showDuration?: boolean;
  unavailable?: boolean;
  leading?: React.ReactNode;
  artistContent?: React.ReactNode;
  albumContent?: React.ReactNode;
};

/**
 * Shared Jukebox song row. Catalogue views supply their own trailing actions,
 * while the artwork, title/artist, playback state and lyric badges stay consistent.
 * Karaoke Toons deliberately does not use this component.
 */
export default function JukeboxSongCard({
  song,
  isCurrent = false,
  isPlaying = false,
  onPlay,
  onOpenLyrics,
  children,
  className = '',
  showAlbum = true,
  showDuration = true,
  unavailable = false,
  leading,
  artistContent,
  albumContent,
}: JukeboxSongCardProps) {
  const title = song?.title || 'Unknown track';
  const artist = song?.artist || 'Unknown Artist';
  const duration = Number(song?.duration || 0);
  const formattedDuration = duration > 0
    ? `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}`
    : '--:--';

  return (
    <div className={`flex min-w-0 items-center gap-2.5 py-2 transition-colors ${isCurrent ? 'bg-[#F472B6]/[0.04]' : ''} ${className}`}>
      {leading}
      <button
        type="button"
        onClick={onPlay}
        disabled={!onPlay || unavailable}
        className="group/play relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#1C1E2D] disabled:cursor-not-allowed disabled:opacity-50"
        title={unavailable ? 'Track unavailable' : isPlaying ? 'Pause in Jukebox' : 'Play in Jukebox'}
        aria-label={`${isPlaying ? 'Pause' : 'Play'} ${title} in Jukebox`}
      >
        {song?.hasArtwork ? (
          <img
            src={`/api/songs/${song.id}/artwork`}
            alt=""
            className="h-full w-full object-cover yk-artwork-image"
            loading="lazy"
            onError={event => { (event.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <Music className="h-4 w-4 text-zinc-500" />
        )}
        {onPlay && !unavailable && (
          <span className={`absolute inset-0 flex items-center justify-center bg-black/55 transition-opacity ${isPlaying ? 'opacity-100' : 'opacity-0 group-hover/play:opacity-100'}`}>
            {isPlaying
              ? <Pause className="h-4 w-4 fill-current text-[#F472B6]" />
              : <Play className="ml-0.5 h-4 w-4 fill-current text-white" />}
          </span>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`truncate text-sm font-semibold ${unavailable ? 'italic text-zinc-500' : isCurrent ? 'text-[#F472B6]' : 'text-white'}`} title={title}>
            {title}
          </span>
          {isCurrent && <EqualizerIndicator isPlaying={isPlaying} />}
          {!unavailable && (song?.hasLrc || song?.hasElrc) && (
            <LyricBadges hasLrc={song.hasLrc} hasElrc={song.hasElrc} onOpenLyrics={onOpenLyrics} />
          )}
          {unavailable && <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">Unavailable</span>}
        </div>
        <div className="truncate text-xs text-zinc-400" title={artist}>{artistContent ?? artist}</div>
      </div>

      {showAlbum && song?.album && (
        <span className="hidden max-w-[22%] shrink-0 truncate text-xs text-zinc-500 sm:block">{song.album}</span>
      )}
      {showDuration && (
        <span className="hidden shrink-0 font-mono text-xs text-zinc-500 md:block">{formattedDuration}</span>
      )}
      {children && <div className="ml-1 flex shrink-0 items-center gap-1.5">{children}</div>}
    </div>
  );
}
