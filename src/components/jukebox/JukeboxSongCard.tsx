import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Play, Pause, Music, Plus, MoreVertical, Heart, ListMusic, RefreshCw, Mic, Trash2 } from 'lucide-react';
import LyricBadges from '../LyricBadges';
import EqualizerIndicator from '../EqualizerIndicator';
import { useSongReplacement } from '../../context/ReplacementContext';
import ReplacementBadge from './ReplacementBadge';

type JukeboxSongCardProps = {
  song: any;
  isCurrent?: boolean;
  isPlaying?: boolean;
  onPlay?: () => void;
  onOpenLyrics?: (format: 'lrc' | 'elrc') => void;
  /** Standard Jukebox Library actions. Karaoke room/toon cards do not use this component. */
  onAddToQueue?: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  onAddToPlaylist?: () => void;
  onReplaceAudio?: () => void;
  onReplaceInstrumental?: () => void;
  onDeleteSong?: () => void;
  children?: React.ReactNode;
  className?: string;
  showAlbum?: boolean;
  showDuration?: boolean;
  unavailable?: boolean;
  leading?: React.ReactNode;
  artworkTrailing?: React.ReactNode;
  artistContent?: React.ReactNode;
  albumContent?: React.ReactNode;
};

export default function JukeboxSongCard({
  song,
  isCurrent = false,
  isPlaying = false,
  onPlay,
  onOpenLyrics,
  onAddToQueue,
  isFavorite = false,
  onToggleFavorite,
  onAddToPlaylist,
  onReplaceAudio,
  onReplaceInstrumental,
  onDeleteSong,
  children,
  className = '',
  showAlbum = true,
  showDuration = true,
  unavailable = false,
  leading,
  artworkTrailing,
  artistContent,
  albumContent,
}: JukeboxSongCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuButtonRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-song-card-menu]')) return;
      setMenuOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menuOpen]);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const { audioJob, instrumentalJob } = useSongReplacement(song?.id);
  const title = song?.title || 'Unknown track';
  const artist = song?.artist || 'Unknown Artist';
  const duration = Number(song?.duration || 0);
  const formattedDuration = duration > 0
    ? `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}`
    : '--:--';
  const hasLibraryActions = !!(onToggleFavorite || onAddToPlaylist || onReplaceAudio || onReplaceInstrumental || onDeleteSong);
  const runAction = (action?: () => void) => {
    setMenuOpen(false);
    action?.();
  };

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
          <img src={`/api/songs/${song.id}/artwork`} alt="" className="h-full w-full object-cover yk-artwork-image" loading="lazy" onError={event => { (event.currentTarget as HTMLImageElement).style.display = 'none'; }} />
        ) : <Music className="h-4 w-4 text-zinc-500" />}
        {onPlay && !unavailable && (
          <span className={`absolute inset-0 flex items-center justify-center bg-black/55 transition-opacity ${isPlaying ? 'opacity-100' : 'opacity-0 group-hover/play:opacity-100'}`}>
            {isPlaying ? <Pause className="h-4 w-4 fill-current text-[#F472B6]" /> : <Play className="ml-0.5 h-4 w-4 fill-current text-white" />}
          </span>
        )}
      </button>
      {artworkTrailing}

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
          <span className={`truncate text-sm font-semibold ${unavailable ? 'italic text-zinc-500' : isCurrent ? 'text-[#F472B6]' : 'text-white'}`} title={title}>{title}</span>
          {isCurrent && <EqualizerIndicator isPlaying={isPlaying} />}
          {!unavailable && (song?.hasLrc || song?.hasElrc) && <LyricBadges hasLrc={song.hasLrc} hasElrc={song.hasElrc} onOpenLyrics={onOpenLyrics} />}
          {audioJob && <ReplacementBadge job={audioJob} />}
          {instrumentalJob && <ReplacementBadge job={instrumentalJob} />}
          {unavailable && <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">Unavailable</span>}
        </div>
        <div className="truncate text-xs text-zinc-400" title={artist}>{artistContent ?? artist}</div>
      </div>

      {showAlbum && song?.album && <span className="hidden max-w-[22%] shrink-0 truncate text-xs text-zinc-500 sm:block">{albumContent ?? song.album}</span>}
      {showDuration && <span className="hidden shrink-0 font-mono text-xs text-zinc-500 md:block">{formattedDuration}</span>}

      {onAddToQueue && (
        <button type="button" onClick={onAddToQueue} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-white" title={`Add ${title} to queue`} aria-label={`Add ${title} to queue`}>
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
      {hasLibraryActions && (
        <div className="relative shrink-0">
          <button type="button" onClick={(event) => {
            event.stopPropagation();
            const nextOpen = !menuOpen;
            if (nextOpen) {
              const rect = menuButtonRef.current?.getBoundingClientRect();
              if (rect) {
                const menuHeight = Math.min(240, window.innerHeight * 0.8);
                const top = rect.bottom + 6 + menuHeight <= window.innerHeight - 8
                  ? rect.bottom + 6
                  : Math.max(8, rect.top - menuHeight - 6);
                const right = Math.min(window.innerWidth - 8, rect.right);
                setMenuPosition({ top, left: Math.max(8, right - 208) });
              }
            }
            setMenuOpen(nextOpen);
          }} ref={menuButtonRef}
            className={`rounded-full p-2 transition-colors ${menuOpen ? 'bg-white/15 text-[#F472B6]' : 'text-zinc-400 hover:bg-white/10 hover:text-white'}`} title="More options" aria-label={`More options for ${title}`} aria-expanded={menuOpen}>
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen && menuPosition && createPortal(
            <div
              style={{ position: 'fixed', top: menuPosition.top, left: menuPosition.left, width: 208, maxHeight: '80vh', overflowY: 'auto' }}
              data-song-card-menu
              className="z-[9999] rounded-xl border border-white/10 bg-[#171926] p-1.5 text-left shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100"
              onClick={event => event.stopPropagation()}
            >
              {onToggleFavorite && <button type="button" onClick={() => runAction(onToggleFavorite)} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-zinc-200 transition-colors hover:bg-white/10 hover:text-white"><Heart className={`h-4 w-4 ${isFavorite ? 'fill-[#F472B6] text-[#F472B6]' : 'text-zinc-400'}`} /><span>{isFavorite ? 'Remove from Favourites' : 'Add to Favourites'}</span></button>}
              {onAddToPlaylist && <button type="button" onClick={() => runAction(onAddToPlaylist)} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-zinc-200 transition-colors hover:bg-white/10 hover:text-white"><ListMusic className="h-4 w-4 text-zinc-400" /><span>Add to Playlist</span></button>}
              {onReplaceAudio && <button type="button" onClick={() => runAction(onReplaceAudio)} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-zinc-200 transition-colors hover:bg-white/10 hover:text-white"><RefreshCw className="h-4 w-4 text-zinc-400" /><span>Replace Audio</span></button>}
              {onReplaceInstrumental && <button type="button" onClick={() => runAction(onReplaceInstrumental)} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-zinc-200 transition-colors hover:bg-white/10 hover:text-white"><Mic className="h-4 w-4 text-zinc-400" /><span>Replace Instrumental</span></button>}
              {onDeleteSong && <><div className="my-1 border-t border-white/5" /><button type="button" onClick={() => runAction(onDeleteSong)} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"><Trash2 className="h-4 w-4 text-red-400" /><span>Delete Song</span></button></>}
            </div>,
            document.body
          )}
        </div>
      )}
      {children && <div className="ml-1 flex shrink-0 items-center gap-1.5">{children}</div>}
    </div>
  );
}
