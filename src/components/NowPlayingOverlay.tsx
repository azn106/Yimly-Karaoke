import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, ListMusic, Music, ChevronUp, ChevronDown, Volume2, VolumeX, Volume1 } from 'lucide-react';
import { usePlayback } from '../context/PlaybackContext';
import EqualizerIndicator from './EqualizerIndicator';

export default function NowPlayingOverlay() {
  const {
    currentSong, isPlaying, currentTime, duration, volume, isMuted, queue, queueIndex,
    isShuffle, repeatMode, togglePlay, seek, next, previous, setVolume, toggleMute,
    toggleShuffle, cycleRepeat, jumpToQueueIndex
  } = usePlayback();

  const [isExpanded, setIsExpanded] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekTime, setSeekTime] = useState(0);
  const touchStartY = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  useEffect(() => {
    if (!isExpanded) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = oldOverflow; };
  }, [isExpanded]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isExpanded) setIsExpanded(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isExpanded]);

  if (!currentSong && queue.length === 0) return null;

  const trackDuration = duration || currentSong?.duration || 0;
  const activeTime = isSeeking ? seekTime : currentTime;
  const progress = trackDuration > 0 ? Math.min(100, Math.max(0, activeTime / trackDuration * 100)) : 0;
  const visibleQueue = queue.length > 0 ? queue : (currentSong ? [currentSong] : []);
  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
  };
  const onSeekChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(event.target.value);
    setSeekTime(value);
    if (!isSeeking) seek(value);
  };
  const onSeekStart = () => { setIsSeeking(true); setSeekTime(currentTime); };
  const onSeekEnd = () => { setIsSeeking(false); seek(seekTime); };
  const onTouchStart = (event: React.TouchEvent) => { touchStartY.current = event.touches[0].clientY; };
  const onTouchMove = (event: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const delta = event.touches[0].clientY - touchStartY.current;
    if (delta > 0) setDragOffset(delta);
  };
  const onTouchEnd = () => {
    if (dragOffset > 70) setIsExpanded(false);
    touchStartY.current = null;
    setDragOffset(0);
  };

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 xl:left-[230px] z-40 bg-[#11121A]/95 backdrop-blur-md border-t border-white/10 shadow-2xl select-none pb-[max(0.45rem,env(safe-area-inset-bottom))]" role="region" aria-label="Compact media player">
        <div className="w-full h-[2.5px] bg-white/10 relative overflow-hidden">
          <div className="h-full bg-[#F472B6] transition-all duration-150" style={{ width: progress + '%' }} />
        </div>
        <div className="max-w-4xl mx-auto px-3 sm:px-4 py-2 flex items-center justify-between gap-3">
          <button type="button" onClick={() => setIsExpanded(true)} className="flex items-center gap-3 min-w-0 flex-1 text-left rounded-xl p-1">
            <div className="relative w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0 overflow-hidden">
              <Music className="w-5 h-5 text-zinc-500 absolute" />
              {currentSong?.hasArtwork && <img src={'/api/songs/' + currentSong.id + '/artwork'} alt={currentSong.title} className="relative z-10 w-full h-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-white truncate">{currentSong?.title || 'No track selected'}</div>
              <div className="text-xs text-zinc-400 truncate">{currentSong?.artist || 'Unknown Artist'}</div>
            </div>
          </button>
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" onClick={previous} className="p-2 text-zinc-300" aria-label="Previous track"><SkipBack className="w-5 h-5 fill-current" /></button>
            <button type="button" onClick={togglePlay} className="w-10 h-10 rounded-full bg-[#F472B6] text-white flex items-center justify-center" aria-label={isPlaying ? 'Pause playback' : 'Start playback'}>
              {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
            </button>
            <button type="button" onClick={next} className="p-2 text-zinc-300" aria-label="Next track"><SkipForward className="w-5 h-5 fill-current" /></button>
            <button type="button" onClick={() => setIsExpanded(true)} className="p-2 text-[#F472B6]" aria-label="Expand player"><ChevronUp className="w-5 h-5" /></button>
          </div>
        </div>
      </div>

      <div className={'fixed inset-0 z-50 bg-black/65 backdrop-blur-sm transition-opacity duration-300 xl:left-[230px] ' + (isExpanded ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none')} onClick={() => setIsExpanded(false)} style={{ pointerEvents: isExpanded ? 'auto' : 'none' }} aria-hidden="true" />

      <div
        className={'fixed bottom-0 left-0 right-0 xl:left-[230px] z-50 flex flex-col rounded-t-3xl shadow-2xl overflow-hidden transition-transform duration-300 max-h-[92vh] max-h-[92dvh] h-[92vh] h-[92dvh] sm:max-h-[90vh] sm:max-h-[90dvh] sm:h-[88vh] sm:h-[88dvh] max-w-4xl mx-auto ' + (isExpanded ? 'translate-y-0' : 'translate-y-full pointer-events-none')}
        style={{ transform: isExpanded ? (dragOffset > 0 ? 'translateY(' + dragOffset + 'px)' : 'translateY(0)') : 'translateY(100%)', pointerEvents: isExpanded ? 'auto' : 'none', transition: dragOffset > 0 ? 'none' : undefined }}
        aria-hidden={!isExpanded} role="dialog" aria-modal="true" aria-label="Now playing expanded player"
      >
        {currentSong?.hasArtwork && <img key={currentSong.id} src={'/api/songs/' + currentSong.id + '/artwork'} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover pointer-events-none" style={{ filter: 'blur(20px)', transform: 'scale(1.12)', opacity: 0.9 }} onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(180deg, rgba(190,24,93,0.70) 0%, rgba(131,24,67,0.78) 38%, rgba(18,13,27,0.96) 100%)' }} />
        <div className="absolute inset-0 bg-[#17121F]/25 pointer-events-none" />

        <div className="relative z-10 flex flex-col flex-1 min-h-0">
          <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} className="pt-2.5 pb-1 shrink-0 cursor-grab select-none" title="Swipe down to minimize">
            <div className="w-12 h-1.5 bg-white/40 rounded-full mx-auto" />
          </div>

          <header className="flex items-center gap-3 px-4 sm:px-6 pt-1 pb-3 shrink-0">
            <button type="button" onClick={() => setIsExpanded(false)} className="p-2 -ml-2 text-white/85 hover:text-white rounded-full" title="Minimize player" aria-label="Minimize player"><ChevronDown className="w-6 h-6" /></button>
            <div className="min-w-0 flex-1 text-center">
              <h2 className="text-base sm:text-lg font-bold text-white truncate">{currentSong?.title || 'No track selected'}</h2>
              <p className="text-sm text-white/75 truncate">{currentSong?.artist || 'Unknown Artist'}{currentSong?.album ? ' · ' + currentSong.album : ''}</p>
            </div>
            <div className="w-10 shrink-0" aria-hidden="true" />
          </header>

          <section className="shrink-0 px-5 sm:px-8 pb-4">
            <div className="flex justify-center mb-4">
              <div className="relative w-[min(42vw,220px)] h-[min(42vw,220px)] sm:w-[min(34vw,260px)] sm:h-[min(34vw,260px)] max-w-[260px] max-h-[260px] min-w-[132px] min-h-[132px] rounded-2xl overflow-hidden border border-white/20 shadow-2xl bg-black/20">
                <Music className="absolute inset-0 m-auto w-12 h-12 text-white/45" />
                {currentSong?.hasArtwork && <img key={currentSong.id} src={'/api/songs/' + currentSong.id + '/artwork'} alt={currentSong.title} className="relative z-10 w-full h-full object-cover" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
              </div>
            </div>
            <div className="w-full max-w-xl mx-auto">
              <input type="range" min="0" max={trackDuration || 100} step="0.5" value={activeTime} onChange={onSeekChange} onMouseDown={onSeekStart} onMouseUp={onSeekEnd} onTouchStart={onSeekStart} onTouchEnd={onSeekEnd} className="w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-[#F472B6]" style={{ background: 'linear-gradient(to right, #F472B6 0%, #F472B6 ' + progress + '%, rgba(255,255,255,0.35) ' + progress + '%, rgba(255,255,255,0.35) 100%)' }} aria-label="Seek track position" />
              <div className="flex justify-between text-xs font-mono text-white/75 tabular-nums mt-1"><span>{formatTime(activeTime)}</span><span>{formatTime(trackDuration)}</span></div>
              <div className="flex items-center justify-between gap-2 mt-3">
                <button type="button" onClick={toggleShuffle} className={'p-2 rounded-full ' + (isShuffle ? 'text-[#F9A8D4] bg-white/15' : 'text-white/75')} aria-label={isShuffle ? 'Turn shuffle off' : 'Turn shuffle on'}><Shuffle className="w-5 h-5" /></button>
                <button type="button" onClick={previous} className="p-2 text-white rounded-full" aria-label="Previous track"><SkipBack className="w-6 h-6 fill-current" /></button>
                <button type="button" onClick={togglePlay} className="w-14 h-14 rounded-full bg-white text-[#8A174F] flex items-center justify-center shadow-xl" aria-label={isPlaying ? 'Pause playback' : 'Start playback'}>{isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-0.5" />}</button>
                <button type="button" onClick={next} className="p-2 text-white rounded-full" aria-label="Next track"><SkipForward className="w-6 h-6 fill-current" /></button>
                <button type="button" onClick={cycleRepeat} className={'p-2 rounded-full ' + (repeatMode !== 'off' ? 'text-[#F9A8D4] bg-white/15' : 'text-white/75')} aria-label={'Repeat mode ' + repeatMode}>{repeatMode === 'one' ? <Repeat1 className="w-5 h-5" /> : <Repeat className="w-5 h-5" />}</button>
              </div>
              <div className="flex items-center gap-3 mt-2 px-1">
                <button type="button" onClick={toggleMute} className="p-1 text-white/75" aria-label={isMuted ? 'Unmute' : 'Mute'}>{isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : volume < 0.5 ? <Volume1 className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}</button>
                <input type="range" min="0" max="1" step="0.01" value={isMuted ? 0 : volume} onChange={(event) => setVolume(parseFloat(event.target.value))} className="flex-1 h-1 rounded-lg appearance-none cursor-pointer accent-[#F472B6]" aria-label="Volume" />
              </div>
            </div>
          </section>

          <section className="flex-1 min-h-0 flex flex-col border-t border-white/15 bg-[#17121F]/45">
            <div className="flex items-center gap-2 px-4 sm:px-6 py-3 shrink-0">
              <ListMusic className="w-5 h-5 text-[#F9A8D4]" />
              <h3 className="text-sm font-bold text-white">Up Next</h3>
              <span className="text-xs text-white/65">{visibleQueue.length}</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 sm:px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {visibleQueue.map((song, index) => {
                const isCurrent = (queue.length > 0 && index === queueIndex) || (queue.length === 0 && song.id === currentSong?.id);
                return (
                  <button key={String(song.id) + '-' + index} type="button" onClick={() => { if (queue.length > 0) jumpToQueueIndex(index); }} className={'w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-colors border border-transparent ' + (isCurrent ? 'bg-[#F472B6]/20 border-[#F472B6]/30' : 'hover:bg-white/10')} aria-label={isCurrent ? song.title + ', current track' : 'Play ' + song.title}>
                    <div className="w-10 h-10 rounded-lg bg-black/20 flex items-center justify-center shrink-0 overflow-hidden">
                      {isCurrent ? <EqualizerIndicator isPlaying={isPlaying} className="scale-150" /> : song.hasArtwork ? <img src={'/api/songs/' + song.id + '/artwork'} alt="" className="w-full h-full object-cover" onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : <Music className="w-4 h-4 text-white/40" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={'text-sm font-semibold truncate ' + (isCurrent ? 'text-[#F9A8D4]' : 'text-white')}>{song.title}</p>
                      <p className="text-xs text-white/65 truncate">{song.artist || 'Unknown Artist'}</p>
                    </div>
                    {song.duration ? <span className="text-xs font-mono text-white/55 tabular-nums">{formatTime(song.duration)}</span> : null}
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
