import React from 'react';
import { usePlayback } from '../context/PlaybackContext';
import { Play, Pause, Music } from 'lucide-react';

export default function NowPlayingOverlay() {
  const { currentSong, isPlaying, togglePlay } = usePlayback();

  if (!currentSong) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 md:hidden bg-[#11121A] border-t border-white/10 p-3 flex items-center gap-3 z-40">
      <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0 overflow-hidden">
        {currentSong.hasArtwork ? (
          <img src={`/api/songs/${currentSong.id}/artwork`} alt={currentSong.title} className="w-full h-full object-cover" />
        ) : (
          <Music className="w-5 h-5 text-zinc-500" />
        )}
      </div>
      <div className="flex-1 truncate">
        <div className="text-sm font-semibold text-white truncate">{currentSong.title}</div>
        <div className="text-xs text-zinc-400 truncate">{currentSong.artist}</div>
      </div>
      <button 
        onClick={togglePlay}
        className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shrink-0"
      >
        {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
      </button>
    </div>
  );
}
