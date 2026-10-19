import { ListMusic, Music, Pause, Play, SkipForward } from 'lucide-react';
import { usePlayback } from '../context/PlaybackContext';

export default function NowPlayingPanel() {
  const { currentSong, isPlaying, queue, queueIndex, togglePlay, next, jumpToQueueIndex } = usePlayback();
  const upcoming = queue.slice(Math.max(0, queueIndex + 1));

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/5 px-5 py-5">
        <ListMusic className="h-5 w-5 text-[#FF4FA3]" />
        <h2 className="text-sm font-bold text-white">Now Playing</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {currentSong ? (
          <>
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#171824]">
              <div className="aspect-square w-full bg-[#1C1E2D]">
                {currentSong.hasArtwork ? (
                  <img
                    src={`/api/songs/${currentSong.id}/artwork`}
                    alt={currentSong.title}
                    className="h-full w-full object-cover"
                    onError={event => { (event.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <Music className="h-16 w-16 text-zinc-600" />
                  </div>
                )}
              </div>
              <div className="p-4">
                <p className="truncate text-base font-bold text-white" title={currentSong.title}>{currentSong.title}</p>
                <p className="mt-1 truncate text-sm text-zinc-400" title={currentSong.artist}>{currentSong.artist || 'Unknown Artist'}</p>
                {currentSong.album && <p className="mt-1 truncate text-xs text-zinc-500">{currentSong.album}</p>}
                <div className="mt-4 flex items-center gap-2">
                  <button type="button" onClick={togglePlay} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-[#FF4FA3] text-sm font-bold text-white transition hover:bg-[#e0378b]" aria-label={isPlaying ? 'Pause current song' : 'Play current song'}>
                    {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
                    {isPlaying ? 'Pause' : 'Play'}
                  </button>
                  <button type="button" onClick={next} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-zinc-300 transition hover:bg-white/10 hover:text-white" aria-label="Play next song" title="Next song">
                    <SkipForward className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            <section className="mt-7">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">Up Next</h3>
                <span className="text-xs tabular-nums text-zinc-500">{upcoming.length}</span>
              </div>
              {upcoming.length ? (
                <div className="space-y-2">
                  {upcoming.slice(0, 30).map((song, offset) => {
                    const index = Math.max(0, queueIndex + 1) + offset;
                    return (
                      <button type="button" key={`${song.id}-${index}`} onClick={() => jumpToQueueIndex(index)} className="flex w-full min-w-0 items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-2.5 text-left transition hover:border-[#FF4FA3]/30 hover:bg-white/[0.05]">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#1C1E2D]">
                          {song.hasArtwork ? <img src={`/api/songs/${song.id}/artwork`} alt="" className="h-full w-full object-cover" onError={event => { (event.currentTarget as HTMLImageElement).style.display = 'none'; }} /> : <Music className="h-4 w-4 text-zinc-600" />}
                        </div>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-white">{song.title}</span>
                          <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{song.artist || 'Unknown Artist'}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-white/10 p-4 text-center text-xs text-zinc-500">Nothing queued after this track.</p>
              )}
            </section>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
              <Music className="h-8 w-8 text-zinc-600" />
            </div>
            <h3 className="text-sm font-semibold text-white">Nothing playing yet</h3>
            <p className="mt-2 max-w-[220px] text-xs leading-relaxed text-zinc-500">Choose a song from your library and it will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
