import React, { useState, useRef, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Shuffle, 
  Repeat, 
  Repeat1, 
  Volume2, 
  VolumeX, 
  Volume1, 
  ListMusic, 
  Music, 
  X, 
  Trash2,
  AlertCircle,
  Radio
} from 'lucide-react';
import { usePlayback, PlaybackSong } from '../context/PlaybackContext';

export default function PlayerBar() {
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
    playbackError,
    isLeader,
    playSong,
    togglePlay,
    resume,
    seek,
    next,
    previous,
    setVolume,
    toggleMute,
    removeFromQueue,
    clearQueue,
    jumpToQueueIndex,
    toggleShuffle,
    cycleRepeat,
  } = usePlayback();

  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekTime, setSeekTime] = useState(0);
  const queueEndRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcut: Space toggles play/pause when not in input/textarea
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || document.activeElement?.getAttribute('contenteditable') === 'true') {
        return;
      }
      if (e.code === 'Space' && currentSong) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentSong, togglePlay]);

  if (!currentSong && queue.length === 0) {
    return null;
  }

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const currentProgressPercent = duration > 0 ? ((isSeeking ? seekTime : currentTime) / duration) * 100 : 0;

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSeekTime(parseFloat(e.target.value));
  };

  const handleSeekMouseDown = () => {
    setIsSeeking(true);
    setSeekTime(currentTime);
  };

  const handleSeekMouseUp = (e: React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>) => {
    setIsSeeking(false);
    seek(seekTime);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVol = parseFloat(e.target.value);
    setVolume(newVol);
  };

  return (
    <>
      {/* Floating Queue Drawer */}
      {isQueueOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div 
            className="fixed inset-0" 
            onClick={() => setIsQueueOpen(false)} 
          />
          <div className="relative w-full max-w-md bg-[#12141F] border-l border-white/10 h-full flex flex-col z-10 shadow-2xl p-6">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <ListMusic className="w-5 h-5 text-[#F472B6]" />
                <h2 className="text-base font-bold text-white tracking-tight">Jukebox Play Queue</h2>
                <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-zinc-300 font-mono">
                  {queue.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {queue.length > 0 && (
                  <button
                    onClick={clearQueue}
                    className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-white/5 rounded-lg transition-colors text-xs flex items-center gap-1"
                    title="Clear Queue"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Clear</span>
                  </button>
                )}
                <button
                  onClick={() => setIsQueueOpen(false)}
                  className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-2">
              {queue.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500">
                  <Music className="w-12 h-12 mb-3 stroke-1 text-zinc-600" />
                  <p className="text-sm font-medium">Your playback queue is empty</p>
                  <p className="text-xs text-zinc-500 mt-1">Play any song from your Library to begin.</p>
                </div>
              ) : (
                queue.map((song, idx) => {
                  const isCurrent = idx === queueIndex;
                  return (
                    <div
                      key={`${song.id}-${idx}`}
                      className={`flex items-center justify-between p-3 rounded-xl transition-all group ${
                        isCurrent 
                          ? 'bg-[#F472B6]/15 border border-[#F472B6]/30 text-white' 
                          : 'bg-[#181A28]/60 hover:bg-[#1E2133] border border-white/5 text-zinc-300'
                      }`}
                    >
                      <button
                        onClick={() => jumpToQueueIndex(idx)}
                        className="flex items-center gap-3 min-w-0 flex-1 text-left"
                      >
                        <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0 overflow-hidden relative border border-white/10">
                          {song.hasArtwork ? (
                            <img
                              src={`/api/songs/${song.id}/artwork`}
                              alt={song.title}
                              className="w-full h-full object-cover yk-artwork-image yk-artwork-image"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <Music className="w-4 h-4 text-zinc-500" />
                          )}
                          {isCurrent && isPlaying && (
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                              <span className="w-2 h-2 rounded-full bg-[#F472B6] animate-ping" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm font-semibold truncate ${isCurrent ? 'text-[#F472B6]' : 'text-white'}`}>
                            {song.title}
                          </p>
                          <p className="text-xs text-zinc-400 truncate">
                            {song.artist || 'Unknown Artist'}
                          </p>
                        </div>
                      </button>

                      <div className="flex items-center gap-2 shrink-0 ml-3">
                        {song.duration ? (
                          <span className="text-xs font-mono text-zinc-500">
                            {formatTime(song.duration)}
                          </span>
                        ) : null}
                        <button
                          onClick={() => removeFromQueue(idx)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-red-400 transition-opacity rounded"
                          title="Remove from queue"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={queueEndRef} />
            </div>
          </div>
        </div>
      )}

      {/* Persistent Bottom Bar */}
      <div className="w-full bg-[#11121A]/95 backdrop-blur-md border-t border-white/10 px-4 py-2.5 z-40 shrink-0 shadow-2xl transition-all">
        {/* Playback Error Notification Banner */}
        {playbackError && (
          <div className="mb-2 px-3 py-1.5 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{playbackError}</span>
            </div>
            <button 
              onClick={resume}
              className="text-xs font-bold underline hover:text-white ml-2"
            >
              Retry
            </button>
          </div>
        )}

        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          {/* Left: Song Info */}
          <div className="flex items-center gap-3 min-w-0 w-1/4">
            <div className="w-12 h-12 rounded-xl bg-zinc-800 border border-white/10 flex items-center justify-center shrink-0 overflow-hidden shadow-md">
              {currentSong?.hasArtwork ? (
                <img
                  src={`/api/songs/${currentSong.id}/artwork`}
                  alt={currentSong.title}
                  className={`w-full h-full object-cover yk-artwork-image yk-artwork-image yk-artwork-motion ${isPlaying ? 'yk-heartbeat-artwork' : ''}`}
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              ) : (
                <Music className="w-5 h-5 text-zinc-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white truncate leading-snug" title={currentSong?.title}>
                {currentSong?.title || 'No track selected'}
              </p>
              <p className="text-xs text-zinc-400 truncate mt-0.5" title={currentSong?.artist}>
                {currentSong?.artist || 'Unknown Artist'}
              </p>
            </div>
          </div>

          {/* Center: Controls and Scrubber */}
          <div className="flex flex-col items-center flex-1 max-w-xl">
            {/* Buttons Row */}
            <div className="flex items-center gap-4 sm:gap-6 mb-1">
              <button
                onClick={toggleShuffle}
                className={`p-1.5 rounded-lg transition-colors ${
                  isShuffle ? 'text-[#F472B6]' : 'text-zinc-400 hover:text-white'
                }`}
                title={isShuffle ? 'Shuffle On' : 'Shuffle Off'}
              >
                <Shuffle className="w-4 h-4" />
              </button>

              <button
                onClick={previous}
                className="p-1.5 text-zinc-300 hover:text-white hover:scale-105 active:scale-95 transition-all"
                title="Previous track"
              >
                <SkipBack className="w-5 h-5 fill-current" />
              </button>

              <button
                onClick={togglePlay}
                className="w-10 h-10 rounded-full bg-[#F472B6] hover:bg-[#DB2777] text-white flex items-center justify-center shadow-lg shadow-[#F472B6]/30 hover:scale-105 active:scale-95 transition-all"
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5 fill-current" />
                ) : (
                  <Play className="w-5 h-5 fill-current ml-0.5" />
                )}
              </button>

              <button
                onClick={next}
                className="p-1.5 text-zinc-300 hover:text-white hover:scale-105 active:scale-95 transition-all"
                title="Next track"
              >
                <SkipForward className="w-5 h-5 fill-current" />
              </button>

              <button
                onClick={cycleRepeat}
                className={`p-1.5 rounded-lg transition-colors ${
                  repeatMode !== 'off' ? 'text-[#F472B6]' : 'text-zinc-400 hover:text-white'
                }`}
                title={`Repeat: ${repeatMode}`}
              >
                {repeatMode === 'one' ? (
                  <Repeat1 className="w-4 h-4" />
                ) : (
                  <Repeat className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Progress Bar & Timers */}
            <div className="w-full flex items-center gap-2.5">
              <span className="text-[11px] font-mono text-zinc-400 w-9 text-right tabular-nums">
                {formatTime(isSeeking ? seekTime : currentTime)}
              </span>

              <div className="relative flex-1 flex items-center group py-1">
                <input
                  type="range"
                  min="0"
                  max={duration || 100}
                  step="0.5"
                  value={isSeeking ? seekTime : currentTime}
                  onChange={handleSeekChange}
                  onMouseDown={handleSeekMouseDown}
                  onMouseUp={handleSeekMouseUp}
                  onTouchStart={handleSeekMouseDown}
                  onTouchEnd={handleSeekMouseUp}
                  className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#F472B6] group-hover:h-2 transition-all"
                  style={{
                    background: `linear-gradient(to right, #F472B6 0%, #F472B6 ${currentProgressPercent}%, rgba(255,255,255,0.1) ${currentProgressPercent}%, rgba(255,255,255,0.1) 100%)`
                  }}
                />
              </div>

              <span className="text-[11px] font-mono text-zinc-400 w-9 text-left tabular-nums">
                {formatTime(duration)}
              </span>
            </div>
          </div>

          {/* Right: Volume & Queue Toggle */}
          <div className="flex items-center justify-end gap-3 w-1/4">
            {/* Multi-tab status indicator */}
            {!isLeader && (
              <span className="hidden lg:inline-flex items-center gap-1.5 text-[10px] text-zinc-400 px-2 py-1 rounded bg-white/5 border border-white/5">
                <Radio className="w-3 h-3 text-[#F472B6] animate-pulse" />
                <span>Remote tab</span>
              </span>
            )}

            {/* Volume controls */}
            <div className="hidden sm:flex items-center gap-2">
              <button
                onClick={toggleMute}
                className="p-1.5 text-zinc-400 hover:text-white transition-colors"
                title={isMuted ? 'Unmute' : 'Mute'}
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
                onChange={handleVolumeChange}
                className="w-16 md:w-20 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#F472B6]"
                style={{
                  background: `linear-gradient(to right, #F472B6 0%, #F472B6 ${(isMuted ? 0 : volume) * 100}%, rgba(255,255,255,0.1) ${(isMuted ? 0 : volume) * 100}%, rgba(255,255,255,0.1) 100%)`
                }}
              />
            </div>

            {/* Queue Button */}
            <button
              onClick={() => setIsQueueOpen(!isQueueOpen)}
              className={`p-2 rounded-xl transition-all relative ${
                isQueueOpen || queue.length > 0
                  ? 'bg-white/10 text-white border border-white/10'
                  : 'text-zinc-400 hover:text-white hover:bg-white/5'
              }`}
              title="Open Jukebox Queue"
            >
              <ListMusic className="w-4 h-4" />
              {queue.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#F472B6] text-[9px] font-bold text-white flex items-center justify-center">
                  {queue.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
