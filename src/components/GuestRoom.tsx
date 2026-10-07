import { useState, useEffect } from 'react';
import { Music, Search, Plus, Check, ArrowLeft, User, ListMusic, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { filterSongs, SearchableSong } from '../lib/search-utils';

interface QueueItem {
  id: number;
  position: number;
  status: string;
  songTitle: string;
  artistName: string;
  userName?: string;
  songId: number;
  artworkPath?: string | null;
}

interface SongItem extends SearchableSong {}

interface GuestRoomProps {
  sessionId: string;
  roomCode: string;
  guestUsername: string;
  controllerId: string;
  queue: QueueItem[];
  onRefreshState: () => void;
  isSessionClosed?: boolean;
}

export default function GuestRoom({
  sessionId,
  roomCode,
  guestUsername,
  controllerId,
  queue,
  onRefreshState,
  isSessionClosed
}: GuestRoomProps) {
  const [showAddSong, setShowAddSong] = useState(false);
  const [availableSongs, setAvailableSongs] = useState<SongItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [librarySearchResults, setLibrarySearchResults] = useState<SongItem[]>([]);
  const [externalSearchResults, setExternalSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addingSongId, setAddingSongId] = useState<number | null>(null);
  const [addedSongId, setAddedSongId] = useState<number | null>(null);
  const [loadingSongs, setLoadingSongs] = useState(false);

  // Format code for header display: "642 370"
  const rawCode = String(roomCode || '').replace(/\s+/g, '');
  const formattedCode = rawCode.length === 6 
    ? `${rawCode.slice(0, 3)} ${rawCode.slice(3)}` 
    : rawCode || '------';

  // Load available song catalog when Add Song screen opens
  useEffect(() => {
    if (showAddSong) {
      setLoadingSongs(true);
      fetch('/api/karaoke/songs')
        .then(async res => {
          if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
            return await res.json();
          }
          return [];
        })
        .then(data => setAvailableSongs(Array.isArray(data) ? data : []))
        .catch(err => console.error('Failed to load song catalog:', err))
        .finally(() => setLoadingSongs(false));
    }
  }, [showAddSong]);

  // Debounced search for library and external songs
  useEffect(() => {
    if (!searchQuery.trim()) {
      setLibrarySearchResults([]);
      setExternalSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const handler = setTimeout(() => {
      fetch(`/api/karaoke/search?q=${encodeURIComponent(searchQuery)}`)
        .then(async res => {
          if (res.ok) {
            return await res.json();
          }
          return { library: [], external: [] };
        })
        .then(data => {
          setLibrarySearchResults(data.library || []);
          setExternalSearchResults(data.external || []);
        })
        .catch(err => console.error('Failed to search songs:', err))
        .finally(() => setIsSearching(false));
    }, 400);

    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Handle adding song to queue
  const handleAddSong = async (songId: number) => {
    if (!sessionId) return;
    try {
      setAddingSongId(songId);
      const res = await fetch(`/api/karaoke/sessions/${sessionId}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          songId,
          controllerId
        })
      });

      if (res.ok) {
        setAddedSongId(songId);
        onRefreshState();
        setTimeout(() => {
          setAddedSongId(null);
          setShowAddSong(false);
          setSearchQuery('');
        }, 600);
      } else {
        alert('Failed to add song to queue.');
      }
    } catch (e) {
      console.error('Add song error:', e);
      alert('Failed to add song to queue.');
    } finally {
      setAddingSongId(null);
    }
  };

  const handleAddTrack = async (track: any) => {
    if (!sessionId) return;
    try {
      const trackId = `dl_${track.title}_${track.artist}`;
      setAddingSongId(trackId as any);
      const res = await fetch(`/api/karaoke/sessions/${sessionId}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          track,
          controllerId
        })
      });

      if (res.ok) {
        setAddedSongId(trackId as any);
        onRefreshState();
        setTimeout(() => {
          setAddedSongId(null);
          setShowAddSong(false);
          setSearchQuery('');
        }, 600);
      } else {
        alert('Failed to add song to queue.');
      }
    } catch (e) {
      console.error('Add track error:', e);
      alert('Failed to add song to queue.');
    } finally {
      setAddingSongId(null);
    }
  };

  const filteredSongs = filterSongs(availableSongs, searchQuery);

  // -------------------------------------------------------------
  // Render: Session Ended State
  // -------------------------------------------------------------
  if (isSessionClosed) {
    return (
      <div className="min-h-screen bg-[#08090E] text-white flex flex-col items-center justify-center p-6 font-sans select-none relative overflow-hidden">
        {/* Ambient Glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-red-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="w-full max-w-sm bg-[#12131D] border border-white/10 rounded-3xl p-8 shadow-2xl text-center relative z-10">
          <div className="w-16 h-16 rounded-2xl bg-red-950/50 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-red-950/50">
            <Music className="w-8 h-8 opacity-60" />
          </div>

          <div className="text-[11px] font-black uppercase tracking-widest text-zinc-500 mb-2">
            YIMLY
          </div>

          <h2 className="text-2xl font-black text-white mb-2 tracking-tight">
            SESSION ENDED
          </h2>

          <p className="text-xs text-zinc-400 leading-relaxed max-w-xs mx-auto">
            This room is no longer available.
          </p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // Render: Main Guest Controller Interface
  // -------------------------------------------------------------
  return (
    <div className="min-h-screen bg-[#08090E] text-white flex flex-col font-sans select-none relative pb-28">
      {/* 1. Header Bar */}
      <header className="sticky top-0 z-30 px-4 py-3 bg-[#0D0E17]/95 backdrop-blur-md border-b border-white/10 flex items-center justify-between shrink-0">
        {/* Left: YIMLY Brand */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 flex items-center justify-center text-[#FF4FA3]">
            <Music className="w-4 h-4" />
          </div>
          <span className="font-black tracking-widest text-sm text-white">YIMLY</span>
        </div>

        {/* Center: Session Room Code */}
        <div className="px-3 py-1 bg-[#08090E] border border-white/10 rounded-xl shadow-inner">
          <span className="font-mono font-black text-sm tracking-widest text-white">
            {formattedCode}
          </span>
        </div>

        {/* Right: Guest Username */}
        <div className="flex items-center gap-1.5 px-3 py-1 bg-white/5 border border-white/10 rounded-full text-xs font-bold text-zinc-200">
          <User className="w-3.5 h-3.5 text-[#FF4FA3]" />
          <span className="truncate max-w-[90px]">{guestUsername || 'Guest'}</span>
        </div>
      </header>

      {/* 2. Main Content: Queue First */}
      <main className="flex-1 p-4 max-w-md mx-auto w-full flex flex-col">
        {/* Queue Section Title */}
        <div className="flex items-center justify-between mb-4 px-1">
          <div className="flex items-center gap-2">
            <ListMusic className="w-4 h-4 text-[#FF4FA3]" />
            <h2 className="text-xs font-black uppercase tracking-widest text-zinc-300">
              ♫ UP NEXT
            </h2>
          </div>
          {queue.length > 0 && (
            <span className="px-2.5 py-0.5 bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 text-[#FF4FA3] rounded-full text-[10px] font-bold">
              {queue.length} {queue.length === 1 ? 'song' : 'songs'}
            </span>
          )}
        </div>

        {/* Queue Items List or Empty Queue State */}
        {queue.length === 0 ? (
          /* Empty Queue View */
          <div className="flex-1 flex flex-col items-center justify-center text-center py-16 px-4 my-auto">
            <div className="w-20 h-20 rounded-3xl bg-[#12131D] border border-white/10 flex items-center justify-center text-[#FF4FA3] mb-5 shadow-2xl shadow-[#FF4FA3]/10 relative">
              <div className="absolute inset-0 bg-[#FF4FA3]/10 rounded-3xl blur-xl" />
              <Music className="w-10 h-10 relative z-10" />
            </div>

            <h3 className="text-lg font-black tracking-tight text-white mb-1">
              QUEUE IS EMPTY
            </h3>
            <p className="text-xs text-zinc-400 mb-6 max-w-xs leading-relaxed">
              Add a song to get started
            </p>

            <button
              onClick={() => setShowAddSong(true)}
              className="px-6 py-3.5 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white font-bold text-sm rounded-2xl transition-all shadow-lg shadow-[#FF4FA3]/25 flex items-center justify-center gap-2 active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>ADD SONG</span>
            </button>
          </div>
        ) : (
          /* Current Queue List */
          <div className="space-y-2.5">
            {queue.map((item, index) => {
              const isPlaying = index === 0;
              const addedBy = item.userName || 'Guest';
              const isDownloading = (item as any).songId === null && (item as any).downloadStatus === 'downloading';
              const isFailed = (item as any).songId === null && (item as any).downloadStatus === 'failed';

              return (
                <div
                  key={item.id}
                  className={`p-3.5 rounded-2xl border flex items-center gap-3 transition-all ${
                    isPlaying
                      ? 'bg-[#151726] border-[#FF4FA3]/40 shadow-lg shadow-[#FF4FA3]/10'
                      : 'bg-[#12131D] border-white/5 hover:border-white/10'
                  }`}
                >
                  {/* Position Badge / Playing Indicator */}
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-black shrink-0 ${
                      isPlaying
                        ? 'bg-[#FF4FA3] text-white shadow-md shadow-[#FF4FA3]/30'
                        : 'bg-white/5 text-zinc-400 border border-white/10'
                    }`}
                  >
                    {isPlaying ? <Music className="w-4 h-4 animate-bounce" /> : index + 1}
                  </div>

                  {/* Song & Guest Info */}
                  <div className="min-w-0 flex-1">
                    <h4 className="font-bold text-sm text-white truncate leading-snug">
                      {item.songTitle}
                    </h4>
                    <div className="flex items-center gap-1.5 text-xs text-zinc-400 truncate mt-0.5">
                      <span className="truncate">{item.artistName}</span>
                      <span className="text-zinc-600">•</span>
                      <span className="text-[#FF4FA3] font-semibold truncate">{addedBy}</span>
                    </div>
                  </div>

                  {/* Status Badge */}
                  {isPlaying && (
                    <span className="px-2 py-0.5 bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 text-[#FF4FA3] rounded-full text-[10px] font-extrabold uppercase tracking-wider shrink-0">
                      NOW PLAYING
                    </span>
                  )}
                  {isDownloading && (
                    <span className="px-2 py-0.5 bg-yellow-500/10 border border-yellow-500/30 text-yellow-500 rounded-full text-[10px] font-extrabold uppercase tracking-wider shrink-0">
                      DOWNLOADING
                    </span>
                  )}
                  {isFailed && (
                    <span className="px-2 py-0.5 bg-red-500/10 border border-red-500/30 text-red-500 rounded-full text-[10px] font-extrabold uppercase tracking-wider shrink-0">
                      FAILED
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* 3. Sticky Bottom Action: ADD SONG Button */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-[#08090E] via-[#08090E]/90 to-transparent backdrop-blur-sm z-20 flex justify-center">
        <button
          onClick={() => setShowAddSong(true)}
          className="w-full max-w-md py-4 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white font-extrabold text-base rounded-2xl transition-all shadow-xl shadow-[#FF4FA3]/30 flex items-center justify-center gap-2 active:scale-95 border border-white/10"
        >
          <Plus className="w-5 h-5 stroke-[2.5]" />
          <span className="tracking-wide">ADD SONG</span>
        </button>
      </div>

      {/* 4. Add Song Screen / Sheet */}
      <AnimatePresence>
        {showAddSong && (
          <motion.div
            initial={{ opacity: 0, y: '100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-0 z-50 bg-[#08090E] flex flex-col font-sans select-none overflow-hidden"
          >
            {/* Sheet Header */}
            <div className="p-4 bg-[#0D0E17] border-b border-white/10 flex items-center justify-between shrink-0">
              <button
                onClick={() => {
                  setShowAddSong(false);
                  setSearchQuery('');
                }}
                className="p-2 text-zinc-400 hover:text-white bg-white/5 rounded-xl transition-colors flex items-center gap-1.5 text-xs font-semibold"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>

              <h3 className="text-base font-black tracking-wide text-white uppercase">
                ADD A SONG
              </h3>

              <button
                onClick={() => {
                  setShowAddSong(false);
                  setSearchQuery('');
                }}
                className="p-2 text-zinc-400 hover:text-white bg-white/5 rounded-xl transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search Input */}
            <div className="p-4 bg-[#0F101A] border-b border-white/10 shrink-0">
              <div className="relative max-w-md mx-auto">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search songs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                  className="w-full bg-[#08090E] border border-white/15 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-[#FF4FA3] focus:ring-2 focus:ring-[#FF4FA3]/30 transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Song Catalog List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5 max-w-md mx-auto w-full">
              {loadingSongs ? (
                <div className="py-20 text-center text-zinc-400">
                  <div className="w-8 h-8 border-2 border-[#FF4FA3] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-xs font-semibold">Loading song catalog...</p>
                </div>
              ) : !searchQuery.trim() ? (
                availableSongs.map((song) => {
                  const isAdding = addingSongId === song.id;
                  const isAdded = addedSongId === song.id;

                  return (
                    <div
                      key={song.id}
                      className="p-3.5 bg-[#12131D] hover:bg-[#1A1C2C] border border-white/5 rounded-2xl flex items-center justify-between gap-3 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-xl bg-[#181926] border border-white/5 flex items-center justify-center shrink-0 text-[#FF4FA3]">
                          <Music className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-bold text-sm text-white truncate">
                            {song.title}
                          </h4>
                          <p className="text-xs text-zinc-400 truncate mt-0.5">
                            {song.artist || 'Unknown Artist'}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={() => handleAddSong(song.id)}
                        disabled={isAdding || isAdded}
                        className={`w-10 h-10 rounded-xl font-bold flex items-center justify-center transition-all shrink-0 active:scale-95 ${
                          isAdded
                            ? 'bg-[#FF4FA3] text-white shadow-lg shadow-[#FF4FA3]/30'
                            : 'bg-[#FF4FA3]/15 hover:bg-[#FF4FA3] text-[#FF4FA3] hover:text-white border border-[#FF4FA3]/30'
                        }`}
                        title="Add to queue"
                      >
                        {isAdded ? (
                          <Check className="w-5 h-5" />
                        ) : (
                          <Plus className="w-5 h-5" />
                        )}
                      </button>
                    </div>
                  );
                })
              ) : (
                <>
                  {librarySearchResults.length > 0 && (
                    <div className="text-xs font-bold text-[#FF4FA3] uppercase tracking-wider mb-2 mt-2 px-1">
                      In Library ({librarySearchResults.length})
                    </div>
                  )}
                  {librarySearchResults.map((song) => {
                    const isAdding = addingSongId === song.id;
                    const isAdded = addedSongId === song.id;

                    return (
                      <div
                        key={`lib-${song.id}`}
                        className="p-3.5 bg-[#12131D] hover:bg-[#1A1C2C] border border-white/5 rounded-2xl flex items-center justify-between gap-3 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-10 h-10 rounded-xl bg-[#181926] border border-white/5 flex items-center justify-center shrink-0 text-[#FF4FA3]">
                            <Music className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-bold text-sm text-white truncate">
                              {song.title}
                            </h4>
                            <p className="text-xs text-zinc-400 truncate mt-0.5">
                              {song.artist || 'Unknown Artist'}
                            </p>
                          </div>
                        </div>

                        <button
                          onClick={() => handleAddSong(song.id)}
                          disabled={isAdding || isAdded}
                          className={`w-10 h-10 rounded-xl font-bold flex items-center justify-center transition-all shrink-0 active:scale-95 ${
                            isAdded
                              ? 'bg-[#FF4FA3] text-white shadow-lg shadow-[#FF4FA3]/30'
                              : 'bg-[#FF4FA3]/15 hover:bg-[#FF4FA3] text-[#FF4FA3] hover:text-white border border-[#FF4FA3]/30'
                          }`}
                          title="Add to queue"
                        >
                          {isAdded ? (
                            <Check className="w-5 h-5" />
                          ) : (
                            <Plus className="w-5 h-5" />
                          )}
                        </button>
                      </div>
                    );
                  })}

                  {externalSearchResults.length > 0 && (
                    <div className="text-xs font-bold text-[#FF4FA3] uppercase tracking-wider mb-2 mt-4 px-1">
                      Available for Download ({externalSearchResults.length})
                    </div>
                  )}
                  {externalSearchResults.map((track) => {
                    const trackId = `dl_${track.title}_${track.artist}`;
                    const isAdding = addingSongId === (trackId as any);
                    const isAdded = addedSongId === (trackId as any);

                    return (
                      <div
                        key={trackId}
                        className="p-3.5 bg-[#12131D] hover:bg-[#1A1C2C] border border-white/5 rounded-2xl flex items-center justify-between gap-3 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-10 h-10 rounded-xl bg-[#181926] border border-white/5 overflow-hidden flex items-center justify-center shrink-0">
                            {track.artworkUrl ? (
                              <img src={track.artworkUrl} className="w-full h-full object-cover" alt="" />
                            ) : (
                              <Music className="w-5 h-5 text-zinc-400" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-bold text-sm text-white truncate">
                              {track.title}
                            </h4>
                            <p className="text-xs text-zinc-400 truncate mt-0.5">
                              {track.artist || 'Unknown Artist'}
                            </p>
                          </div>
                        </div>

                        <button
                          onClick={() => handleAddTrack(track)}
                          disabled={isAdding || isAdded}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center justify-center transition-all shrink-0 active:scale-95 ${
                            isAdded
                              ? 'bg-[#FF4FA3] text-white shadow-lg shadow-[#FF4FA3]/30'
                              : 'bg-[#FF4FA3]/15 hover:bg-[#FF4FA3] text-[#FF4FA3] hover:text-white border border-[#FF4FA3]/30'
                          }`}
                          title="Download and queue"
                        >
                          {isAdded ? (
                            <Check className="w-4 h-4" />
                          ) : isAdding ? (
                            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          ) : (
                            'DL & Queue'
                          )}
                        </button>
                      </div>
                    );
                  })}

                  {isSearching && (
                    <div className="py-8 text-center text-zinc-400">
                      <div className="w-6 h-6 border-2 border-[#FF4FA3] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                      <p className="text-xs">Searching...</p>
                    </div>
                  )}

                  {!isSearching && librarySearchResults.length === 0 && externalSearchResults.length === 0 && (
                    <div className="py-20 text-center text-zinc-500">
                      <Music className="w-10 h-10 mx-auto mb-3 opacity-30 text-[#FF4FA3]" />
                      <p className="text-sm font-bold text-zinc-300">No songs found</p>
                      <p className="text-xs text-zinc-500 mt-1">Try a different search term</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
