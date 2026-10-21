import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, ListMusic, Music, ChevronUp, ChevronDown, Volume2, VolumeX, Volume1 } from 'lucide-react';
import { usePlayback } from '../context/PlaybackContext';
import EqualizerIndicator from './EqualizerIndicator';

export default function NowPlayingOverlay() {
  const {
    currentSong, isPlaying, currentTime, duration, volume, isMuted, queue, queueIndex,
    isShuffle, repeatMode, togglePlay, seek, next, previous, setVolume, toggleMute,
    toggleShuffle, cycleRepeat, jumpToQueueIndex, bassLevel, transientLevel
  } = usePlayback();

  const [isExpanded, setIsExpanded] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekTime, setSeekTime] = useState(0);
  const touchStartY = useRef<number | null>(null);
  const isQueueTouch = useRef(false);
  const [dragOffset, setDragOffset] = useState(0);
  const previousTransientRef = useRef(0);
  const pulseRef = useRef(0);
  const pulseFrameRef = useRef<number>(0);
  const pulseLastFrameRef = useRef(0);
  const lastBeatTimeRef = useRef(0);
  const pulseReleaseRef = useRef(285);
  const artworkCardRef = useRef<HTMLDivElement>(null);

  // Audio-Reactive Radar Border: a continuous clockwise conic sweep, with each
  // detected transient launching a brighter, expanding halo ripple.
  useEffect(() => {
    const previousTransient = previousTransientRef.current;
    previousTransientRef.current = transientLevel;

    if (!isPlaying) {
      pulseRef.current = 0;
      if (pulseFrameRef.current) cancelAnimationFrame(pulseFrameRef.current);
      pulseFrameRef.current = 0;
      pulseLastFrameRef.current = 0;
      lastBeatTimeRef.current = 0;
      pulseReleaseRef.current = 285;
      const card = artworkCardRef.current;
      if (card) {
        card.style.borderColor = 'transparent';
        card.style.borderWidth = '1px';
        card.style.background = 'conic-gradient(from 0deg, rgba(244,114,182,0.22), rgba(244,114,182,0.22))';
        card.style.boxShadow = '0 20px 45px rgba(0,0,0,0.32), 0 0 7px rgba(244,114,182,0.08)';
      }
      return;
    }

    const rise = transientLevel - previousTransient;
    if (transientLevel > 0.12 && rise > 0.045) {
      const now = performance.now();
      const beatGap = lastBeatTimeRef.current ? now - lastBeatTimeRef.current : 0;
      lastBeatTimeRef.current = now;
      if (beatGap >= 80 && beatGap <= 1400) {
        pulseReleaseRef.current = Math.max(105, Math.min(520, beatGap * 0.72));
      }
      const hitStrength = Math.min(1, 0.22 + transientLevel * 1.35);
      pulseRef.current = Math.max(pulseRef.current * 0.55, hitStrength);
    }

    // Start only one animation loop. Transient updates feed the running loop via refs.
    if (!pulseFrameRef.current) {
      const animatePulse = (timestamp: number) => {
        const elapsed = pulseLastFrameRef.current ? Math.min(50, timestamp - pulseLastFrameRef.current) : 16;
        pulseLastFrameRef.current = timestamp;
        const pulse = Math.max(0, pulseRef.current);
        pulseRef.current *= Math.exp(-elapsed / pulseReleaseRef.current);
        const angle = (timestamp * 0.055) % 360;
        const card = artworkCardRef.current;
        if (card) {
          card.style.borderColor = 'transparent';
          card.style.borderWidth = (1 + pulse * 2.0) + 'px';
          card.style.background = 'conic-gradient(from ' + angle + 'deg, ' +
            'rgba(244,114,182,0.20) 0deg, ' +
            'rgba(244,114,182,0.24) 250deg, ' +
            'rgba(249,168,212,' + (0.62 + pulse * 0.38) + ') 300deg, ' +
            'rgba(255,255,255,' + (0.78 + pulse * 0.22) + ') 322deg, ' +
            'rgba(244,114,182,' + (0.45 + pulse * 0.55) + ') 342deg, ' +
            'rgba(244,114,182,0.20) 360deg)';
          card.style.boxShadow =
            '0 20px 45px rgba(0,0,0,0.32), ' +
            '0 0 ' + (7 + pulse * 30) + 'px rgba(244,114,182,' + (0.08 + pulse * 0.48) + '), ' +
            '0 0 ' + (2 + pulse * 15) + 'px rgba(249,168,212,' + (pulse * 0.52) + ')';
        }
        pulseFrameRef.current = requestAnimationFrame(animatePulse);
      };
      pulseFrameRef.current = requestAnimationFrame(animatePulse);
    }
  }, [transientLevel, isPlaying]);

  useEffect(() => () => {
    if (pulseFrameRef.current) cancelAnimationFrame(pulseFrameRef.current);
  }, []);

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
  const onExpandedTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-queue-scroll]')) {
      isQueueTouch.current = true;
      touchStartY.current = null;
      return;
    }
    isQueueTouch.current = false;
    touchStartY.current = event.touches[0].clientY;
  };
  const onExpandedTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (isQueueTouch.current || touchStartY.current === null) return;
    const delta = event.touches[0].clientY - touchStartY.current;
    if (delta > 0) setDragOffset(delta);
  };
  const onExpandedTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (isQueueTouch.current) {
      isQueueTouch.current = false;
      return;
    }
    const endY = event.changedTouches[0]?.clientY;
    const delta = touchStartY.current !== null && endY !== undefined ? endY - touchStartY.current : 0;
    if (delta > 70 || dragOffset > 70) setIsExpanded(false);
    touchStartY.current = null;
    setDragOffset(0);
  };
  const onCompactTouchStart = (event: React.TouchEvent) => { touchStartY.current = event.touches[0].clientY; };
  const onCompactTouchEnd = (event: React.TouchEvent) => {
    const endY = event.changedTouches[0]?.clientY;
    const delta = touchStartY.current !== null && endY !== undefined ? endY - touchStartY.current : 0;
    if (delta < -55) setIsExpanded(true);
    touchStartY.current = null;
  };

  return (
    <>
      <div onTouchStart={onCompactTouchStart} onTouchEnd={onCompactTouchEnd} className="fixed bottom-0 left-0 right-0 xl:left-[230px] z-40 bg-[#11121A]/95 backdrop-blur-md border-t border-white/10 shadow-2xl select-none pb-[max(0.45rem,env(safe-area-inset-bottom))] touch-pan-y" role="region" aria-label="Compact media player">
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

      <div className={'fixed inset-0 z-50 bg-black/55 backdrop-blur-sm transition-opacity duration-300 xl:left-[230px] ' + (isExpanded ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none')} onClick={() => setIsExpanded(false)} style={{ pointerEvents: isExpanded ? 'auto' : 'none' }} aria-hidden="true" />

      <div
        className={'fixed inset-0 z-50 flex flex-col shadow-2xl overflow-hidden transition-transform duration-300 h-[100dvh] w-full rounded-none border-0 ' + (isExpanded ? 'translate-y-0' : 'translate-y-full pointer-events-none')}
        style={{ transform: isExpanded ? (dragOffset > 0 ? 'translateY(' + dragOffset + 'px)' : 'translateY(0)') : 'translateY(100%)', pointerEvents: isExpanded ? 'auto' : 'none', transition: dragOffset > 0 ? 'none' : undefined }}
        onTouchStart={onExpandedTouchStart} onTouchMove={onExpandedTouchMove} onTouchEnd={onExpandedTouchEnd}
        aria-hidden={!isExpanded} role="dialog" aria-modal="true" aria-label="Now playing expanded player"
      >
        {currentSong?.hasArtwork && <img key={currentSong.id} src={'/api/songs/' + currentSong.id + '/artwork'} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover pointer-events-none" style={{ filter: 'none', transform: 'scale(1.10)', opacity: 0.9 }} onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
        {/* Keep the cover artwork visible through a translucent pink tint across the entire player card. */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(180deg, rgba(190,24,93,0.48) 0%, rgba(157,23,77,0.58) 48%, rgba(35,12,29,0.72) 100%)' }} />

        <div className="relative z-10 flex flex-col flex-1 min-h-0">
          <header className="flex items-center gap-3 px-4 sm:px-6 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 shrink-0 cursor-grab select-none" title="Swipe down to minimize">
            <div className="min-w-0 flex-1 text-center">
              <h2 className="text-base sm:text-lg font-bold text-white truncate">{currentSong?.title || 'No track selected'}</h2>
              <p className="text-sm text-white/75 truncate">{currentSong?.artist || 'Unknown Artist'}{currentSong?.album ? ' · ' + currentSong.album : ''}</p>
            </div>
            <button type="button" onClick={() => setIsExpanded(false)} className="p-2 -mr-2 text-white/85 hover:text-white rounded-full shrink-0" title="Minimize player" aria-label="Minimize player"><ChevronDown className="w-6 h-6" /></button>
          </header>

          <section className="shrink-0 px-5 sm:px-8 pb-2">
            <div className="flex justify-center mb-3">
              <div className="w-[min(58vw,320px)] h-[min(58vw,320px)] sm:w-[min(28vw,300px)] sm:h-[min(28vw,300px)] max-w-[320px] max-h-[320px] min-w-[116px] min-h-[116px]">
                <div
                  ref={artworkCardRef}
                  className="yk-audio-reactive-border relative w-full h-full rounded-2xl overflow-hidden border bg-black/20 will-change-[border-color,background,box-shadow] shadow-xl"
                  style={{
                    borderColor: 'transparent',
                    borderWidth: '1px',
                    background: 'conic-gradient(from 0deg, rgba(244,114,182,0.20), rgba(244,114,182,0.24), rgba(249,168,212,0.8), rgba(244,114,182,0.20))',
                    boxShadow: '0 20px 45px rgba(0,0,0,0.32), 0 0 7px rgba(244,114,182,0.08)',
                  }}
                >
                  <Music className="absolute inset-0 m-auto w-10 h-10 text-white/45" />
                  {currentSong?.hasArtwork && <img key={currentSong.id} src={'/api/songs/' + currentSong.id + '/artwork'} alt={currentSong.title} className={'relative z-10 w-full h-full object-cover ' + (isPlaying ? 'yk-artwork-image-breathe' : '')} style={{ '--yk-breathe-depth': (0.012 + Math.min(1, bassLevel) * 0.045).toFixed(3) } as React.CSSProperties} onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
                </div>
              </div>
            </div>
            <div className="w-full max-w-lg mx-auto">
              <input type="range" min="0" max={trackDuration || 100} step="0.5" value={activeTime} onChange={onSeekChange} onMouseDown={onSeekStart} onMouseUp={onSeekEnd} onTouchStart={onSeekStart} onTouchEnd={onSeekEnd} className="w-full h-1 rounded-full appearance-none cursor-pointer accent-[#F472B6]" style={{ background: 'linear-gradient(to right, #F472B6 0%, #F472B6 ' + progress + '%, rgba(255,255,255,0.28) ' + progress + '%, rgba(255,255,255,0.28) 100%)' }} aria-label="Seek track position" />
              <div className="flex justify-between text-[10px] font-mono text-white/65 tabular-nums mt-1"><span>{formatTime(activeTime)}</span><span>{formatTime(trackDuration)}</span></div>
              <div className="flex items-center justify-center gap-5 sm:gap-7 mt-2">
                <button type="button" onClick={toggleShuffle} className={'p-1.5 rounded-full transition-colors ' + (isShuffle ? 'text-[#F9A8D4]' : 'text-white/65 hover:text-white')} aria-label={isShuffle ? 'Turn shuffle off' : 'Turn shuffle on'} aria-pressed={isShuffle}><Shuffle className="w-[18px] h-[18px]" /></button>
                <button type="button" onClick={previous} className="p-1.5 text-white/90 hover:text-white rounded-full" aria-label="Previous track"><SkipBack className="w-5 h-5 fill-current" /></button>
                <button type="button" onClick={togglePlay} className="w-12 h-12 rounded-full bg-white text-[#8A174F] flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-transform" aria-label={isPlaying ? 'Pause playback' : 'Start playback'}>{isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}</button>
                <button type="button" onClick={next} className="p-1.5 text-white/90 hover:text-white rounded-full" aria-label="Next track"><SkipForward className="w-5 h-5 fill-current" /></button>
                <button type="button" onClick={cycleRepeat} className={'p-1.5 rounded-full transition-colors ' + (repeatMode !== 'off' ? 'text-[#F9A8D4]' : 'text-white/65 hover:text-white')} aria-label={'Repeat mode ' + repeatMode}>{repeatMode === 'one' ? <Repeat1 className="w-[18px] h-[18px]" /> : <Repeat className="w-[18px] h-[18px]" />}</button>
              </div>
              <div className="flex items-center gap-2 mt-2 px-1 max-w-xs mx-auto">
                <button type="button" onClick={toggleMute} className="p-1 text-white/60 hover:text-white" aria-label={isMuted ? 'Unmute' : 'Mute'}>{isMuted || volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : volume < 0.5 ? <Volume1 className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}</button>
                <input type="range" min="0" max="1" step="0.01" value={isMuted ? 0 : volume} onChange={(event) => setVolume(parseFloat(event.target.value))} className="flex-1 h-1 rounded-full appearance-none cursor-pointer accent-[#F472B6]" aria-label="Volume" />
              </div>
            </div>
          </section>

          <section className="flex-1 min-h-0 flex flex-col border-t border-white/15 bg-[#3A102A]/35 backdrop-blur-[5px]">
            <div className="flex items-center gap-2 px-4 sm:px-6 py-3 shrink-0">
              <ListMusic className="w-5 h-5 text-[#F9A8D4]" />
              <h3 className="text-sm font-bold text-white">Up Next</h3>
              <span className="text-xs text-white/65">{visibleQueue.length}</span>
            </div>
            <div data-queue-scroll className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 sm:px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
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
