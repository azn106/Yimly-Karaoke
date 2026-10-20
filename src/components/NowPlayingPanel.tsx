import {
  ListMusic,
  Music,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { usePlayback } from '../context/PlaybackContext';

export default function NowPlayingPanel() {
  const {
    currentSong,
    isPlaying,
    currentTime,
    duration,
    queue,
    queueIndex,
    isShuffle,
    repeatMode,
    playbackError,
    togglePlay,
    previous,
    next,
    seek,
    toggleShuffle,
    cycleRepeat,
    jumpToQueueIndex,
  } = usePlayback();

  const upcoming = queue.slice(Math.max(0, queueIndex + 1));
  const trackDuration = duration || currentSong?.duration || 0;
  const progress = trackDuration > 0
    ? Math.min(100, Math.max(0, (currentTime / trackDuration) * 100))
    : 0;

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col bg-[#111217]">
      <header className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <ListMusic className="h-[18px] w-[18px] text-[#F472B6]" />
          <h2 className="text-sm font-semibold tracking-tight text-white">Now Playing</h2>
        </div>
        {queue.length > 0 && (
          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium tabular-nums text-zinc-400">
            {queue.length} tracks
          </span>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-5">
        {currentSong ? (
          <>
            <section aria-label="Current track">
              <div className="group relative aspect-square w-full overflow-hidden rounded-xl bg-[#1B1C25] shadow-xl shadow-black/20">
                <div className="absolute inset-0 flex items-center justify-center">
                  <Music className="h-16 w-16 text-white/15" />
                </div>
                {currentSong.hasArtwork && (
                  <img
                    src={`/api/songs/${currentSong.id}/artwork`}
                    alt={`Artwork for ${currentSong.title}`}
                    className="absolute inset-0 h-full w-full object-cover yk-artwork-image"
                    onError={event => { event.currentTarget.style.display = 'none'; }}
                  />
                )}
              </div>

              <div className="mt-4 flex min-w-0 items-center gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-base font-bold leading-snug text-white" title={currentSong.title}>
                    {currentSong.title}
                  </h3>
                  <p className="mt-1 truncate text-sm text-zinc-400" title={currentSong.artist}>
                    {currentSong.artist || 'Unknown Artist'}
                  </p>
                  {currentSong.album && (
                    <p className="mt-1 truncate text-xs text-zinc-500" title={currentSong.album}>
                      {currentSong.album}
                    </p>
                  )}
                </div>
              </div>

              {playbackError && (
                <p role="status" className="mt-3 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs leading-relaxed text-red-300">
                  {playbackError}
                </p>
              )}

              <div className="mt-5">
                <label htmlFor="now-playing-seek" className="sr-only">Seek within current song</label>
                <input
                  id="now-playing-seek"
                  type="range"
                  min={0}
                  max={trackDuration || 1}
                  step={1}
                  value={Math.min(currentTime, trackDuration || currentTime)}
                  onChange={event => seek(Number(event.currentTarget.value))}
                  disabled={!trackDuration}
                  aria-label="Seek within current song"
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full accent-[#F472B6] disabled:cursor-default disabled:opacity-40"
                  style={{
                    background: `linear-gradient(to right, #F472B6 0%, #F472B6 ${progress}%, rgba(255,255,255,0.12) ${progress}%, rgba(255,255,255,0.12) 100%)`,
                  }}
                />
                <div className="mt-1.5 flex justify-between text-[10px] font-medium tabular-nums text-zinc-500">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(trackDuration)}</span>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between px-1">
                <button
                  type="button"
                  onClick={toggleShuffle}
                  aria-label={isShuffle ? 'Turn shuffle off' : 'Turn shuffle on'}
                  aria-pressed={isShuffle}
                  title={isShuffle ? 'Shuffle on' : 'Shuffle off'}
                  className={`rounded-lg p-2 transition-colors hover:bg-white/[0.06] ${isShuffle ? 'text-[#F472B6]' : 'text-zinc-500 hover:text-white'}`}
                >
                  <Shuffle className="h-[18px] w-[18px]" />
                </button>
                <button
                  type="button"
                  onClick={previous}
                  aria-label="Play previous song"
                  title="Previous"
                  className="rounded-lg p-2 text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  <SkipBack className="h-5 w-5 fill-current" />
                </button>
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={isPlaying ? 'Pause current song' : 'Play current song'}
                  title={isPlaying ? 'Pause' : 'Play'}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F472B6] text-white shadow-lg shadow-[#F472B6]/20 transition hover:scale-[1.04] hover:bg-[#DB2777] active:scale-95"
                >
                  {isPlaying
                    ? <Pause className="h-5 w-5 fill-current" />
                    : <Play className="ml-0.5 h-5 w-5 fill-current" />}
                </button>
                <button
                  type="button"
                  onClick={next}
                  aria-label="Play next song"
                  title="Next"
                  className="rounded-lg p-2 text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  <SkipForward className="h-5 w-5 fill-current" />
                </button>
                <button
                  type="button"
                  onClick={cycleRepeat}
                  aria-label={`Repeat mode: ${repeatMode}`}
                  aria-pressed={repeatMode !== 'off'}
                  title={`Repeat: ${repeatMode}`}
                  className={`rounded-lg p-2 transition-colors hover:bg-white/[0.06] ${repeatMode !== 'off' ? 'text-[#F472B6]' : 'text-zinc-500 hover:text-white'}`}
                >
                  {repeatMode === 'one'
                    ? <Repeat1 className="h-[18px] w-[18px]" />
                    : <Repeat className="h-[18px] w-[18px]" />}
                </button>
              </div>
            </section>

            <section className="mt-7 border-t border-white/[0.07] pt-5" aria-label="Upcoming songs">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Up Next</h3>
                <span className="text-xs tabular-nums text-zinc-500">{upcoming.length}</span>
              </div>

              {upcoming.length > 0 ? (
                <div className="space-y-1">
                  {upcoming.slice(0, 30).map((song, offset) => {
                    const index = Math.max(0, queueIndex + 1) + offset;
                    return (
                      <button
                        type="button"
                        key={`${song.id}-${index}`}
                        onClick={() => jumpToQueueIndex(index)}
                        className="group flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.05]"
                        title={`Play ${song.title}`}
                      >
                        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-[#1B1C25]">
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Music className="h-4 w-4 text-zinc-600" />
                          </div>
                          {song.hasArtwork && (
                            <img
                              src={`/api/songs/${song.id}/artwork`}
                              alt=""
                              className="absolute inset-0 h-full w-full object-cover yk-artwork-image"
                              onError={event => { event.currentTarget.style.display = 'none'; }}
                            />
                          )}
                        </div>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-zinc-200 group-hover:text-white">
                            {song.title}
                          </span>
                          <span className="mt-1 block truncate text-[11px] text-zinc-500">
                            {song.artist || 'Unknown Artist'}
                          </span>
                        </span>
                        <span className="shrink-0 text-zinc-500 opacity-0 transition-opacity group-hover:opacity-100">
                          <Play className="h-3.5 w-3.5 fill-current" />
                        </span>
                      </button>
                    );
                  })}
                  {upcoming.length > 30 && (
                    <p className="px-2 pt-2 text-[11px] text-zinc-500">
                      And {upcoming.length - 30} more in the queue
                    </p>
                  )}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-xs leading-relaxed text-zinc-500">
                  Nothing queued after this track.
                </p>
              )}
            </section>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-3 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03]">
              <Music className="h-8 w-8 text-zinc-600" />
            </div>
            <h3 className="text-sm font-semibold text-white">Nothing playing yet</h3>
            <p className="mt-2 max-w-[220px] text-xs leading-relaxed text-zinc-500">
              Choose a song from your library and it will appear here.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
