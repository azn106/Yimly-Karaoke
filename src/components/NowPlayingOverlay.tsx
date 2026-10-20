import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Shuffle, 
  Repeat, 
  Repeat1, 
  ListMusic, 
  Music, 
  X, 
  Trash2,
  ChevronUp,
  ChevronDown,
  Volume2,
  VolumeX,
  Volume1
} from 'lucide-react';
import { usePlayback } from '../context/PlaybackContext';

export default function NowPlayingOverlay() {
  const { 
    currentSong, 
    isPlaying, 
    currentTime, 
    duration, 
    volume,
    isMuted,
    queue, 
    queueIndex, 
    isShuffle, 
    repeatMode, 
    togglePlay, 
    seek, 
    next, 
    previous, 
    setVolume,
    toggleMute,
    toggleShuffle, 
    cycleRepeat, 
    jumpToQueueIndex, 
    removeFromQueue, 
    clearQueue 
  } = usePlayback();

  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'player' | 'queue'>('player');
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekTime, setSeekTime] = useState(0);

  // Touch drag-down tracking for swipe-to-minimize
  const touchStartY = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState<number>(0);

  // Prevent background scrolling while expanded player is open
  useEffect(() => {
    if (isExpanded) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prevOverflow;
      };
    }
  }, [isExpanded]);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isExpanded) {
        setIsExpanded(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded]);

  if (!currentSong && queue.length === 0) return null;

  const trackDuration = duration || currentSong?.duration || 0;
  const activeTime = isSeeking ? seekTime : currentTime;
  const currentProgressPercent = trackDuration > 0 
    ? Math.min(100, Math.max(0, (activeTime / trackDuration) * 100))
    : 0;

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setSeekTime(val);
    if (!isSeeking) {
      seek(val);
    }
  };

  const handleSeekStart = () => {
    setIsSeeking(true);
    setSeekTime(currentTime);
  };

  const handleSeekEnd = () => {
    setIsSeeking(false);
    seek(seekTime);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - touchStartY.current;
    if (diff > 0) {
      setDragOffset(diff);
    }
  };

  const handleTouchEnd = () => {
    if (dragOffset > 70) {
      setIsExpanded(false);
    }
    touchStartY.current = null;
    setDragOffset(0);
  };

  return (
    <>
      {/* ============================================================ */}
      {/* 1. COMPACT BOTTOM PLAYER (Always visible when panel is hidden) */}
      {/* ============================================================ */}
      <div 
        className="fixed bottom-0 left-0 right-0 xl:left-[230px] z-40 bg-[#11121A]/95 backdrop-blur-md border-t border-white/10 shadow-2xl transition-all select-none pb-[max(0.45rem,env(safe-area-inset-bottom))]"
        role="region"
        aria-label="Compact media player"
      >
        {/* Subtle rose-pink progress bar across top edge */}
        <div className="w-full h-[2.5px] bg-white/10 relative overflow-hidden">
          <div 
            className="h-full bg-[#F472B6] transition-all duration-150 ease-linear shadow-sm shadow-[#F472B6]/50"
            style={{ width: `${currentProgressPercent}%` }}
          />
        </div>

        <div className="max-w-4xl mx-auto px-3 sm:px-4 py-2 flex items-center justify-between gap-3">
          {/* Clickable Area: Artwork + Song title + Artist -> Expands player */}
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="flex items-center gap-3 min-w-0 flex-1 text-left group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F472B6] rounded-xl p-1 -m-1"
            aria-label="Expand player to full view"
            title="Click to expand player"
          >
            <div className="relative w-10 h-10 sm:w-11 sm:h-11 rounded-lg bg-zinc-800 border border-white/10 flex items-center justify-center shrink-0 overflow-hidden shadow-sm group-hover:border-[#F472B6]/40 transition-colors">
              <Music className="w-5 h-5 text-zinc-500 absolute" />
              {currentSong?.hasArtwork && (
                <img
                  src={`/api/songs/${currentSong.id}/artwork`}
                  alt={currentSong.title}
                  className={`relative z-10 w-full h-full object-cover yk-artwork-image ${isPlaying ? 'yk-heartbeat-artwork' : ''}`}
                  onError={(e) => {
                    (e.currentTarget as HTMLElement).style.display = 'none';
                  }}
                />
              )}
            </div>
            <div className="min-w-0 flex-1 pr-1">
              <div className="text-sm font-bold text-white truncate leading-snug group-hover:text-[#F472B6] transition-colors" title={currentSong?.title}>
                {currentSong?.title || 'No track selected'}
              </div>
              <div className="text-xs text-zinc-400 truncate mt-0.5" title={currentSong?.artist}>
                {currentSong?.artist || 'Unknown Artist'}
              </div>
            </div>
          </button>

          {/* Quick playback actions */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); previous(); }}
              className="p-2 text-zinc-300 hover:text-white hover:bg-white/5 active:scale-95 transition-all rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F472B6]"
              title="Previous track"
              aria-label="Previous track"
            >
              <SkipBack className="w-4 h-4 sm:w-5 sm:h-5 fill-current" />
            </button>

            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); togglePlay(); }}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#F472B6] hover:bg-[#DB2777] text-white flex items-center justify-center shadow-lg shadow-[#F472B6]/30 hover:scale-105 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#F472B6] shrink-0"
              title={isPlaying ? 'Pause' : 'Play'}
              aria-label={isPlaying ? 'Pause playback' : 'Start playback'}
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 sm:w-5 sm:h-5 fill-current" />
              ) : (
                <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-current ml-0.5" />
              )}
            </button>

            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); next(); }}
              className="p-2 text-zinc-300 hover:text-white hover:bg-white/5 active:scale-95 transition-all rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F472B6]"
              title="Next track"
              aria-label="Next track"
            >
              <SkipForward className="w-4 h-4 sm:w-5 sm:h-5 fill-current" />
            </button>

            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              className="p-2 text-zinc-400 hover:text-white hover:bg-white/5 rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F472B6] ml-1"
              title="Expand player"
              aria-label="Expand player"
            >
              <ChevronUp className="w-5 h-5 text-[#F472B6]" />
            </button>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 2. EXPANDED SLIDE-UP PLAYER SHEET                            */}
      {/* ============================================================ */}
      {/* Backdrop */}
      <div 
        className={`fixed inset-0 z-50 bg-black/75 backdrop-blur-xs transition-opacity duration-300 xl:left-[230px] ${
          isExpanded ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setIsExpanded(false)}
        aria-hidden="true"
      />

      {/* Slide-Up Container */}
      <div
        className={`fixed bottom-0 left-0 right-0 xl:left-[230px] z-50 flex flex-col bg-[#12131D] border-t border-white/10 rounded-t-3xl shadow-2xl overflow-hidden transition-transform duration-300 ease-out motion-reduce:transition-none max-h-[92vh] sm:max-h-[90vh] h-[92vh] sm:h-[88vh] max-w-4xl mx-auto ${
          isExpanded ? 'translate-y-0' : 'translate-y-full pointer-events-none'
        }`}
        style={{
          transform: isExpanded && dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined,
          transition: dragOffset > 0 ? 'none' : undefined
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Now playing expanded player"
      >
        {/* Drag Handle & Touch Listener Area */}
        <div 
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="pt-2.5 pb-1.5 shrink-0 cursor-grab active:cursor-grabbing select-none hover:bg-white/[0.02] transition-colors"
          title="Swipe down to minimize"
        >
          <div className="w-12 h-1.5 bg-white/20 hover:bg-white/30 rounded-full mx-auto transition-colors" />
        </div>

        {/* Header Bar */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-2 border-b border-white/5 shrink-0">
          {/* Minimize Button */}
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            className="p-2 text-zinc-400 hover:text-white hover:bg-white/5 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F472B6]"
            title="Minimize player"
            aria-label="Minimize player"
          >
            <ChevronDown className="w-5 h-5" />
          </button>

          {/* Mobile Tab Switcher (< md) */}
          <div className="flex md:hidden items-center bg-white/5 rounded-xl p-1 border border-white/5">
            <button
              type="button"
              onClick={() => setActiveTab('player')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                activeTab === 'player' 
                  ? 'bg-[#F472B6] text-white shadow-sm' 
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Now Playing
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('queue')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === 'queue' 
                  ? 'bg-[#F472B6] text-white shadow-sm' 
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <span>Queue</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                activeTab === 'queue' ? 'bg-white/20 text-white' : 'bg-white/10 text-zinc-300'
              }`}>
                {queue.length}
              </span>
            </button>
          </div>

          {/* Desktop/Tablet Header Label (>= md) */}
          <div className="hidden md:flex items-center gap-2">
            <span className="text-[11px] font-bold tracking-wider uppercase px-3 py-1 rounded-full bg-[#F472B6]/15 border border-[#F472B6]/30 text-[#F472B6]">
              Now Playing &amp; Queue
            </span>
          </div>

          {/* Close Button */}
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            className="p-2 text-zinc-400 hover:text-white hover:bg-white/5 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F472B6]"
            title="Close"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ============================================================ */}
        {/* MAIN BODY: Split view on >= md, Tabbed view on < md          */}
        {/* ============================================================ */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden pb-[max(0.75rem,env(safe-area-inset-bottom))]">

          {/* LEFT SIDE: Now Playing Artwork & Full Controls */}
          {/* Always shown on >= md, or on < md when activeTab === 'player' */}
          <div className={`md:flex flex-col md:w-[48%] md:border-r border-white/5 p-4 sm:p-6 overflow-y-auto ${
            activeTab === 'player' ? 'flex flex-1' : 'hidden'
          }`}>
            <div className="my-auto flex flex-col items-center max-w-sm mx-auto w-full">
              {/* Large Square Album Artwork */}
              <div className="relative aspect-square w-48 sm:w-56 md:w-64 rounded-2xl bg-[#1B1C25] border border-white/10 flex items-center justify-center overflow-hidden shadow-2xl mb-4 sm:mb-6">
                <Music className="w-16 h-16 text-zinc-600 absolute" />
                {currentSong?.hasArtwork && (
                  <img
                    src={`/api/songs/${currentSong.id}/artwork`}
                    alt={currentSong.title}
                    className={`relative z-10 w-full h-full object-cover yk-artwork-image ${isPlaying ? 'yk-heartbeat-artwork' : ''}`}
                    onError={(e) => {
                      (e.currentTarget as HTMLElement).style.display = 'none';
                    }}
                  />
                )}
              </div>

              {/* Title & Artist */}
              <div className="text-center w-full px-2 mb-4">
                <h2 className="text-lg sm:text-xl font-bold text-white truncate leading-snug" title={currentSong?.title}>
                  {currentSong?.title || 'No track selected'}
                </h2>
                <p className="text-sm text-zinc-400 truncate mt-1" title={currentSong?.artist}>
                  {currentSong?.artist || 'Unknown Artist'}
                </p>
                {currentSong?.album && (
                  <p className="text-xs text-zinc-500 truncate mt-0.5" title={currentSong.album}>
                    {currentSong.album}
                  </p>
                )}
              </div>

              {/* Scrubber Range Bar */}
              <div className="w-full mb-3">
                <div className="relative flex items-center group py-1">
                  <input
                    type="range"
                    min="0"
                    max={trackDuration || 100}
                    step="0.5"
                    value={activeTime}
                    onChange={handleSeekChange}
                    onMouseDown={handleSeekStart}
                    onMouseUp={handleSeekEnd}
                    onTouchStart={handleSeekStart}
                    onTouchEnd={handleSeekEnd}
                    className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#F472B6] group-hover:h-2 transition-all"
                    style={{
                      background: `linear-gradient(to right, #F472B6 0%, #F472B6 ${currentProgressPercent}%, rgba(255,255,255,0.12) ${currentProgressPercent}%, rgba(255,255,255,0.12) 100%)`
                    }}
                    aria-label="Seek track position"
                  />
                </div>
                <div className="flex justify-between text-xs font-mono text-zinc-400 tabular-nums px-0.5 mt-1">
                  <span>{formatTime(activeTime)}</span>
                  <span>{formatTime(trackDuration)}</span>
                </div>
              </div>

              {/* Primary Transport Controls */}
              <div className="flex items-center justify-between w-full px-2 sm:px-4 mb-4">
                {/* Shuffle */}
                <button
                  type="button"
                  onClick={toggleShuffle}
                  className={`p-2.5 rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F472B6] ${
                    isShuffle 
                      ? 'text-[#F472B6] bg-[#F472B6]/15 border border-[#F472B6]/30' 
                      : 'text-zinc-400 hover:text-white bg-white/5 border border-white/5'
                  }`}
                  title={isShuffle ? 'Shuffle: On' : 'Shuffle: Off'}
                  aria-label={isShuffle ? 'Turn shuffle off' : 'Turn shuffle on'}
                  aria-pressed={isShuffle}
                >
                  <Shuffle className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>

                {/* Previous */}
                <button
                  type="button"
                  onClick={previous}
                  className="p-3 text-zinc-200 hover:text-white hover:bg-white/5 active:scale-95 transition-all rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F472B6]"
                  title="Previous track"
                  aria-label="Previous track"
                >
                  <SkipBack className="w-5 h-5 sm:w-6 sm:h-6 fill-current" />
                </button>

                {/* Play / Pause */}
                <button
                  type="button"
                  onClick={togglePlay}
                  className="w-13 h-13 sm:w-14 sm:h-14 rounded-full bg-[#F472B6] hover:bg-[#DB2777] text-white flex items-center justify-center shadow-xl shadow-[#F472B6]/30 hover:scale-105 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#F472B6] shrink-0"
                  title={isPlaying ? 'Pause' : 'Play'}
                  aria-label={isPlaying ? 'Pause playback' : 'Start playback'}
                >
                  {isPlaying ? (
                    <Pause className="w-6 h-6 fill-current" />
                  ) : (
                    <Play className="w-6 h-6 fill-current ml-0.5" />
                  )}
                </button>

                {/* Next */}
                <button
                  type="button"
                  onClick={next}
                  className="p-3 text-zinc-200 hover:text-white hover:bg-white/5 active:scale-95 transition-all rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F472B6]"
                  title="Next track"
                  aria-label="Next track"
                >
                  <SkipForward className="w-5 h-5 sm:w-6 sm:h-6 fill-current" />
                </button>

                {/* Repeat */}
                <button
                  type="button"
                  onClick={cycleRepeat}
                  className={`p-2.5 rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F472B6] ${
                    repeatMode !== 'off' 
                      ? 'text-[#F472B6] bg-[#F472B6]/15 border border-[#F472B6]/30' 
                      : 'text-zinc-400 hover:text-white bg-white/5 border border-white/5'
                  }`}
                  title={
                    repeatMode === 'one' 
                      ? 'Repeat: Current Track' 
                      : repeatMode === 'all' 
                      ? 'Repeat: All Tracks' 
                      : 'Repeat: Off'
                  }
                  aria-label={
                    repeatMode === 'one' 
                      ? 'Repeat current track active' 
                      : repeatMode === 'all' 
                      ? 'Repeat all tracks active' 
                      : 'Repeat off'
                  }
                >
                  {repeatMode === 'one' ? (
                    <Repeat1 className="w-4 h-4 sm:w-5 sm:h-5" />
                  ) : (
                    <Repeat className="w-4 h-4 sm:w-5 sm:h-5" />
                  )}
                </button>
              </div>

              {/* Volume Slider */}
              <div className="w-full flex items-center justify-center gap-3 px-2 sm:px-4 py-1.5 bg-white/[0.03] rounded-xl border border-white/5">
                <button
                  type="button"
                  onClick={toggleMute}
                  className="p-1.5 text-zinc-400 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F472B6] rounded-lg"
                  title={isMuted ? 'Unmute' : 'Mute'}
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-zinc-500" />
                  ) : volume < 0.5 ? (
                    <Volume1 className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="flex-1 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#F472B6]"
                  style={{
                    background: `linear-gradient(to right, #F472B6 0%, #F472B6 ${(isMuted ? 0 : volume) * 100}%, rgba(255,255,255,0.1) ${(isMuted ? 0 : volume) * 100}%, rgba(255,255,255,0.1) 100%)`
                  }}
                  aria-label="Volume level"
                />
              </div>

              {/* Mobile Quick Switch Button to Queue */}
              <div className="flex md:hidden w-full mt-3">
                <button
                  type="button"
                  onClick={() => setActiveTab('queue')}
                  className="w-full py-2.5 px-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-semibold text-zinc-300 hover:text-white transition-all flex items-center justify-center gap-2"
                >
                  <ListMusic className="w-4 h-4 text-[#F472B6]" />
                  <span>View Queue ({queue.length} songs)</span>
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT SIDE: Playlist Queue (Scrolls independently) */}
          {/* Always shown on >= md, or on < md when activeTab === 'queue' */}
          <div className={`md:flex flex-col flex-1 min-h-0 p-4 sm:p-6 overflow-hidden ${
            activeTab === 'queue' ? 'flex flex-1' : 'hidden'
          }`}>
            {/* Queue Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-2.5">
                <ListMusic className="w-5 h-5 text-[#F472B6]" />
                <h3 className="text-base font-bold text-white tracking-tight">Up Next</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-zinc-300 font-mono">
                  {queue.length}
                </span>
              </div>
              {queue.length > 0 && (
                <button
                  type="button"
                  onClick={clearQueue}
                  className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-white/5 rounded-lg transition-colors text-xs flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F472B6]"
                  title="Clear Queue"
                  aria-label="Clear Queue"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear</span>
                </button>
              )}
            </div>

            {/* Scrollable Queue List */}
            <div className="flex-1 overflow-y-auto py-3 space-y-1.5 pr-1">
              {queue.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500">
                  <Music className="w-12 h-12 mb-3 stroke-1 text-zinc-600" />
                  <p className="text-sm font-medium text-white">Your queue is empty</p>
                  <p className="text-xs text-zinc-500 mt-1">Play any song or album from your library.</p>
                </div>
              ) : (
                queue.map((song, idx) => {
                  const isCurrent = idx === queueIndex;
                  return (
                    <div
                      key={`${song.id}-${idx}`}
                      className={`flex items-center justify-between p-2.5 rounded-xl transition-all ${
                        isCurrent 
                          ? 'bg-[#F472B6]/15 border border-[#F472B6]/30 text-white shadow-sm' 
                          : 'bg-[#181A28]/50 hover:bg-[#1E2133] border border-white/5 text-zinc-300'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => jumpToQueueIndex(idx)}
                        className="flex items-center gap-3 min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F472B6] rounded-lg"
                        aria-label={`Play ${song.title} by ${song.artist || 'Unknown Artist'}`}
                      >
                        <div className="relative w-9 h-9 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0 overflow-hidden border border-white/10">
                          <Music className="w-4 h-4 text-zinc-500 absolute" />
                          {song.hasArtwork && (
                            <img
                              src={`/api/songs/${song.id}/artwork`}
                              alt=""
                              className="relative z-10 w-full h-full object-cover yk-artwork-image"
                              onError={(e) => {
                                (e.currentTarget as HTMLElement).style.display = 'none';
                              }}
                            />
                          )}
                          {isCurrent && isPlaying && (
                            <div className="absolute inset-0 z-20 bg-black/40 flex items-center justify-center">
                              <span className="w-2 h-2 rounded-full bg-[#F472B6] animate-ping" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1 pr-1">
                          <p className={`text-sm font-semibold truncate ${isCurrent ? 'text-[#F472B6]' : 'text-white'}`}>
                            {song.title}
                          </p>
                          <p className="text-xs text-zinc-400 truncate">
                            {song.artist || 'Unknown Artist'}
                          </p>
                        </div>
                      </button>

                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        {song.duration ? (
                          <span className="text-xs font-mono text-zinc-500 tabular-nums">
                            {formatTime(song.duration)}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => removeFromQueue(idx)}
                          className="p-1.5 text-zinc-400 hover:text-red-400 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                          title="Remove from queue"
                          aria-label={`Remove ${song.title} from queue`}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Mobile Queue Bottom Sticky Controls */}
            {activeTab === 'queue' && currentSong && (
              <div className="flex md:hidden items-center justify-between pt-2.5 mt-1 border-t border-white/10 shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveTab('player')}
                  className="flex items-center gap-2 min-w-0 flex-1 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-bold text-white truncate block">{currentSong.title}</span>
                    <span className="text-[10px] text-zinc-400 truncate block">{currentSong.artist || 'Unknown Artist'}</span>
                  </div>
                </button>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={previous}
                    className="p-1.5 text-zinc-300 hover:text-white"
                  >
                    <SkipBack className="w-4 h-4 fill-current" />
                  </button>
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="w-8 h-8 rounded-full bg-[#F472B6] text-white flex items-center justify-center shadow-md shadow-[#F472B6]/30"
                  >
                    {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={next}
                    className="p-1.5 text-zinc-300 hover:text-white"
                  >
                    <SkipForward className="w-4 h-4 fill-current" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
