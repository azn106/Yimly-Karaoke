import { useState, useEffect, FormEvent } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { 
  Download, Search, Sparkles, Music, Disc, RefreshCw, CheckCircle2, 
  XCircle, AlertCircle, Settings as SettingsIcon, Play, HardDrive, 
  ListMusic, Radio, ArrowRight, ShieldCheck, Check, Layers, Shield
} from 'lucide-react';

interface ResolvedTrack {
  title: string;
  artist: string;
  album: string;
  trackNumber?: number;
  discNumber?: number;
  releaseYear?: number;
  artworkUrl?: string;
  duration?: number;
  sourceUrl?: string;
}

interface ResolvedResult {
  type: 'track' | 'album' | 'playlist' | 'search';
  id?: string;
  spotifyId?: string;
  title?: string;
  artist?: string;
  artworkUrl?: string;
  query?: string;
  tracks: ResolvedTrack[];
  message?: string;
  hasMore?: boolean;
  nextOffset?: number;
}

interface ActiveTrackJob {
  id: string;
  title: string;
  artist: string;
  album: string;
  trackNumber?: number;
  status: 'queued' | 'searching' | 'downloading' | 'tagging' | 'completed' | 'failed';
  progress: number;
  error?: string;
}

interface ActiveJob {
  id: string;
  playlistName?: string | null;
  status: 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  tracks: ActiveTrackJob[];
  libraryId: number;
  libraryPath: string;
  format: string;
  quality: string;
  completedCount: number;
  totalCount: number;
}

export default function DownloadMusic() {
  const { user } = useOutletContext<{ user: any }>() || {};
  const [inputVal, setInputVal] = useState('');
  const [resolving, setResolving] = useState(false);
  const [loadingMoreResults, setLoadingMoreResults] = useState(false);
  const [resolveError, setResolveError] = useState('');
  const [result, setResult] = useState<ResolvedResult | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

  // Settings & Libraries
  const [libraries, setLibraries] = useState<any[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState<number | string>('');
  const [format, setFormat] = useState('mp3');
  const [quality, setQuality] = useState('320k');
  const [downloadLyrics, setDownloadLyrics] = useState(true);

  // Active Job state
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [queueJobs, setQueueJobs] = useState<ActiveJob[]>([]);
  const [queueSummary, setQueueSummary] = useState({ workers: 0, queued: 0, completed: 0, failed: 0, maxWorkers: 1 });
  const [clearingFinished, setClearingFinished] = useState(false);
  const [startingDownload, setStartingDownload] = useState(false);

  // Fetch libraries & default settings on mount
  useEffect(() => {
    if (user?.role === 'administrator') {
      fetchLibraries();
      fetchDownloaderSettings();
    }
  }, [user]);

  const refreshQueue = async () => {
    try {
      const res = await fetch('/api/downloader/queue');
      if (!res.ok) return;
      const data = await res.json();
      setQueueJobs(Array.isArray(data.jobs) ? data.jobs : []);
      if (data.summary) setQueueSummary(data.summary);
    } catch (error) {
      console.error('Failed to refresh download queue', error);
    }
  };

  useEffect(() => {
    if (user?.role !== 'administrator') return;
    refreshQueue();
    const interval = setInterval(refreshQueue, 1500);
    return () => clearInterval(interval);
  }, [user]);

  const handleClearFinished = async () => {
    if (!window.confirm('Clear all finished download entries? Queued and currently processing downloads will not be affected.')) return;
    setClearingFinished(true);
    try {
      const res = await fetch('/api/downloader/queue/clear-finished', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to clear finished downloads');
      await refreshQueue();
    } catch (error) {
      console.error('Clear finished downloads failed', error);
      alert('Could not clear finished downloads. Please try again.');
    } finally {
      setClearingFinished(false);
    }
  };

  const fetchLibraries = async () => {
    try {
      const res = await fetch('/api/libraries');
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const libs = await res.json();
        setLibraries(libs);
        if (libs.length > 0 && !selectedLibraryId) {
          setSelectedLibraryId(libs[0].id);
        }
      }
    } catch (e) {
      console.error('Error fetching libraries', e);
    }
  };

  const fetchDownloaderSettings = async () => {
    try {
      const res = await fetch('/api/downloader/settings');
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const settings = await res.json();
        if (settings.libraryId) setSelectedLibraryId(settings.libraryId);
        if (settings.format) setFormat(settings.format);
        if (settings.quality) setQuality(settings.quality);
        if (settings.downloadLyrics !== undefined) setDownloadLyrics(Boolean(settings.downloadLyrics));
      }
    } catch (e) {
      console.error('Error fetching downloader settings', e);
    }
  };

  const handleResolve = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!inputVal.trim()) return;

    setResolving(true);
    setResolveError('');
    setResult(null);

    try {
      const res = await fetch('/api/downloader/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urlOrQuery: inputVal.trim(), offset: 0 }),
      });

      let data: any = {};
      if (res.headers.get('content-type')?.includes('application/json')) {
        try {
          data = await res.json();
        } catch (e) {
          console.error('JSON parse error:', e);
        }
      }

      if (!res.ok) {
        throw new Error(data.error || 'Failed to resolve link or search music');
      }

      setResult(data);
      if (data.tracks && data.tracks.length > 0) {
        // Select all by default
        const indices = new Set<number>(data.tracks.map((_: any, i: number) => i));
        setSelectedIndices(indices);
      }
    } catch (err: any) {
      console.error('Resolve error:', err);
      setResolveError(err.message || 'Failed to resolve input. Please check the URL or search term.');
    } finally {
      setResolving(false);
    }
  };

  const handleLoadMoreResults = async () => {
    if (!result || result.type !== 'search' || !result.hasMore || loadingMoreResults) return;

    setLoadingMoreResults(true);
    setResolveError('');
    try {
      const res = await fetch('/api/downloader/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urlOrQuery: result.query || inputVal.trim(), offset: result.nextOffset ?? result.tracks.length }),
      });

      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load more search results');

      const existingKeys = new Set(result.tracks.map((track) => `${track.title.trim().toLowerCase()}|${track.artist.trim().toLowerCase()}`));
      const newTracks: ResolvedTrack[] = (Array.isArray(data.tracks) ? data.tracks : []).filter((track: ResolvedTrack) => {
        const key = `${(track.title || '').trim().toLowerCase()}|${(track.artist || '').trim().toLowerCase()}`;
        if (existingKeys.has(key)) return false;
        existingKeys.add(key);
        return true;
      });

      setSelectedIndices((previous) => {
        const next = new Set(previous);
        newTracks.forEach((_, index) => next.add(result.tracks.length + index));
        return next;
      });
      setResult((previous) => previous ? {
        ...previous,
        tracks: [...previous.tracks, ...newTracks],
        hasMore: Boolean(data.hasMore),
        nextOffset: typeof data.nextOffset === 'number' ? data.nextOffset : (previous.nextOffset ?? previous.tracks.length) + 20,
      } : previous);
    } catch (err: any) {
      setResolveError(err.message || 'Failed to load more search results');
    } finally {
      setLoadingMoreResults(false);
    }
  };

  const toggleSelectAll = () => {
    if (!result || !result.tracks) return;
    if (selectedIndices.size === result.tracks.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(result.tracks.map((_, i) => i)));
    }
  };

  const toggleSelectIndex = (idx: number) => {
    const next = new Set(selectedIndices);
    if (next.has(idx)) {
      next.delete(idx);
    } else {
      next.add(idx);
    }
    setSelectedIndices(next);
  };

  const handleStartDownload = async () => {
    if (!result || selectedIndices.size === 0) return;
    setStartingDownload(true);

    const chosenTracks = Array.from(selectedIndices).map((idx) => result.tracks[idx]);

    try {
      const res = await fetch('/api/downloader/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          libraryId: selectedLibraryId,
          format,
          quality,
          downloadLyrics,
          playlistName: result.title,
          playlistCoverUrl: result.artworkUrl,
          spotifyPlaylistId: result.spotifyId || result.id,
          sourceType: result.type,
          tracks: chosenTracks,
        }),
      });

      let data: any = {};
      if (res.headers.get('content-type')?.includes('application/json')) {
        try {
          data = await res.json();
        } catch (e) {
          console.error('JSON parse error:', e);
        }
      }

      if (!res.ok) {
        throw new Error(data.error || 'Failed to start download process');
      }

      setActiveJobId(data.jobId);
      const jobRes = await fetch(`/api/downloader/jobs/${data.jobId}`);
      if (jobRes.ok) setActiveJob(await jobRes.json());
      await refreshQueue();
    } catch (err: any) {
      alert(err.message || 'Error starting download.');
    } finally {
      setStartingDownload(false);
    }
  };

  const handleCancelJob = async () => {
    if (!activeJobId) return;
    try {
      await fetch(`/api/downloader/cancel/${activeJobId}`, { method: 'POST' });
    } catch (e) {
      console.error('Cancel error', e);
    }
  };

  const handleRetryFailed = async () => {
    if (!activeJobId) return;
    try {
      await fetch(`/api/downloader/jobs/${activeJobId}/retry-failed`, { method: 'POST' });
      // Fetch latest state immediately
      const res = await fetch(`/api/downloader/jobs/${activeJobId}`);
      if (res.ok) {
        setActiveJob(await res.json());
      }
    } catch (e) {
      console.error('Retry error', e);
    }
  };

  if (user?.role !== 'administrator') {
    return (
      <div className="p-10 flex flex-col items-center justify-center min-h-[50vh] text-center">
        <Shield className="w-12 h-12 text-rose-500 mb-3" />
        <h2 className="text-xl font-bold text-white mb-1">Access Restricted</h2>
        <p className="text-sm text-zinc-400">Only system administrators can access the music downloader and server import tools.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-10 max-w-6xl mx-auto space-y-8 font-sans select-none">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#F472B6]/15 border border-[#F472B6]/30 text-[#F472B6] text-xs font-semibold uppercase tracking-wider mb-2">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Integrated Music Downloader</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight">Download Music</h1>
          <p className="text-xs md:text-sm text-zinc-400 mt-1">
            Search or paste Spotify, YouTube, or YouTube Music URLs to download songs directly into your Yimly library.
          </p>
        </div>

        <Link
          to="/settings"
          className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white text-xs font-semibold rounded-xl border border-white/10 transition-colors flex items-center gap-2 shrink-0 self-start md:self-auto"
        >
          <SettingsIcon className="w-4 h-4 text-[#F472B6]" />
          <span>Downloader Settings</span>
        </Link>
      </div>

      {/* Input / Search Bar Card */}
      <div className="bg-[#141622] border border-white/10 rounded-3xl p-6 md:p-8 shadow-2xl space-y-4">
        <form onSubmit={handleResolve} className="space-y-4">
          <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider">
            Spotify / YouTube URL or Song Search
          </label>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-5 h-5 text-zinc-500 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                placeholder="Paste Spotify track/album/playlist URL, YouTube URL, or type song name..."
                className="w-full bg-[#08090E] border border-white/10 focus:border-[#F472B6] focus:ring-1 focus:ring-[#F472B6] rounded-2xl pl-12 pr-4 py-3.5 text-sm text-white placeholder-zinc-600 focus:outline-none transition-all font-mono"
              />
            </div>

            <button
              type="submit"
              disabled={resolving || !inputVal.trim()}
              className="px-6 py-3.5 bg-[#F472B6] hover:bg-[#DB2777] text-white text-sm font-bold rounded-2xl transition-all shadow-lg shadow-[#F472B6]/25 flex items-center justify-center gap-2 disabled:opacity-50 shrink-0"
            >
              {resolving ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Fetching Metadata...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Fetch Music</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Quick Example Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/5">
          <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mr-1">Supported:</span>
          <button
            type="button"
            onClick={() => setInputVal('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT')}
            className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white text-xs border border-white/5 transition-colors font-mono"
          >
            Spotify Track
          </button>
          <button
            type="button"
            onClick={() => setInputVal('https://www.youtube.com/watch?v=dQw4w9WgXcQ')}
            className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white text-xs border border-white/5 transition-colors font-mono"
          >
            YouTube Video
          </button>
          <button
            type="button"
            onClick={() => setInputVal('Ed Sheeran Shape of You')}
            className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white text-xs border border-white/5 transition-colors"
          >
            Direct Search
          </button>
        </div>

        {/* Error message if resolve failed */}
        {resolveError && (
          <div className="p-4 bg-red-950/60 border border-red-500/30 rounded-2xl text-red-300 text-xs flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{resolveError}</span>
          </div>
        )}
      </div>

      {/* Resolved Results & Track List */}
      {result && (
        <div className="bg-[#141622] border border-white/10 rounded-3xl p-6 md:p-8 shadow-2xl space-y-6 animate-in fade-in zoom-in-98 duration-200">
          {/* Collection / Metadata Banner */}
          <div className="flex items-start gap-4 p-4 bg-[#0A0B10] border border-white/5 rounded-2xl">
            <div className="w-20 h-20 md:w-24 md:h-24 rounded-xl bg-[#1C1E2D] border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
              {result.artworkUrl ? (
                <img src={result.artworkUrl} alt={result.title || 'Cover'} className="w-full h-full object-cover" />
              ) : (
                <Disc className="w-10 h-10 text-[#F472B6]" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#F472B6]/20 text-[#F472B6] border border-[#F472B6]/30 inline-block mb-1.5">
                {result.type}
              </span>
              <h2 className="text-xl font-bold text-white truncate">{result.title || result.query || 'Music Result'}</h2>
              {result.artist && <p className="text-xs text-zinc-400 mt-0.5">{result.artist}</p>}
              <p className="text-xs text-zinc-500 mt-2">
                {result.tracks?.length || 0} track{(result.tracks?.length || 0) === 1 ? '' : 's'} ready for processing
              </p>
            </div>
          </div>

          {result.message && (
            <div className="p-3 bg-amber-950/40 border border-amber-500/30 rounded-xl text-amber-300 text-xs">
              {result.message}
            </div>
          )}

          {/* Controls & Options Bar */}
          <div className="p-4 bg-[#0A0B10] border border-white/5 rounded-2xl flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4 text-xs">
              {/* Library Destination */}
              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">
                  Target Library
                </label>
                <select
                  value={selectedLibraryId}
                  onChange={(e) => setSelectedLibraryId(e.target.value)}
                  className="bg-[#141622] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F472B6]"
                >
                  {libraries.map((lib) => (
                    <option key={lib.id} value={lib.id}>
                      {lib.name} ({lib.path})
                    </option>
                  ))}
                  {libraries.length === 0 && <option value="">No library configured</option>}
                </select>
              </div>

              {/* Format */}
              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Format</label>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  className="bg-[#141622] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F472B6] font-mono"
                >
                  <option value="mp3">MP3</option>
                  <option value="m4a">M4A</option>
                  <option value="flac">FLAC</option>
                  <option value="wav">WAV</option>
                  <option value="opus">OPUS</option>
                </select>
              </div>

              {/* Quality */}
              <div>
                <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Bitrate</label>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                  className="bg-[#141622] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#F472B6] font-mono"
                >
                  <option value="320k">320kbps (Best)</option>
                  <option value="256k">256kbps</option>
                  <option value="192k">192kbps</option>
                  <option value="128k">128kbps</option>
                </select>
              </div>

              {/* Lyrics Toggle */}
              <div className="flex flex-col justify-end">
                <label className="flex items-center gap-2 px-3 py-2 bg-[#141622] border border-white/10 rounded-xl cursor-pointer hover:border-white/20 transition-colors">
                  <input
                    type="checkbox"
                    checked={downloadLyrics}
                    onChange={(e) => setDownloadLyrics(e.target.checked)}
                    className="w-4 h-4 rounded bg-[#08090E] border-white/20 text-[#F472B6] focus:ring-[#F472B6] accent-[#F472B6]"
                  />
                  <span className="text-xs font-semibold text-zinc-200">.lrc Lyrics</span>
                </label>
              </div>
            </div>

            {/* Action Download Button */}
            <button
              type="button"
              onClick={handleStartDownload}
              disabled={selectedIndices.size === 0 || startingDownload || libraries.length === 0}
              className="px-6 py-3 bg-[#F472B6] hover:bg-[#DB2777] text-white text-xs font-bold rounded-xl transition-all shadow-lg shadow-[#F472B6]/25 flex items-center gap-2 disabled:opacity-50"
            >
              {startingDownload ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Starting Download...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Download Selected ({selectedIndices.size})</span>
                </>
              )}
            </button>
          </div>

          {/* Tracks Selection Table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs px-2">
              <button
                type="button"
                onClick={toggleSelectAll}
                className="text-[#F472B6] font-bold hover:underline flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                <span>
                  {selectedIndices.size === result.tracks.length ? 'Deselect All' : 'Select All Tracks'}
                </span>
              </button>
              <span className="text-zinc-500">
                {selectedIndices.size} of {result.tracks.length} selected
              </span>
            </div>

            <div className="bg-[#08090E] border border-white/5 rounded-2xl overflow-hidden divide-y divide-white/5">
              {result.tracks.map((track, idx) => {
                const isSelected = selectedIndices.has(idx);
                return (
                  <div
                    key={idx}
                    onClick={() => toggleSelectIndex(idx)}
                    className={`p-3.5 flex items-center gap-3 transition-colors cursor-pointer ${
                      isSelected ? 'bg-[#F472B6]/10 hover:bg-[#F472B6]/15' : 'hover:bg-white/5 opacity-60'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectIndex(idx)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 rounded bg-[#141622] border-white/20 text-[#F472B6] focus:ring-[#F472B6] accent-[#F472B6]"
                    />

                    <span className="w-6 text-center text-xs font-mono text-zinc-500">{idx + 1}</span>

                    <div className="w-10 h-10 rounded-lg bg-[#141622] border border-white/10 overflow-hidden shrink-0 flex items-center justify-center">
                      {track.artworkUrl ? (
                        <img src={track.artworkUrl} alt={track.title} className="w-full h-full object-cover" />
                      ) : (
                        <Music className="w-5 h-5 text-zinc-600" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{track.title}</div>
                      <div className="text-xs text-zinc-400 truncate">
                        {track.artist} {track.album ? `• ${track.album}` : ''}
                      </div>
                    </div>

                    {track.duration && (
                      <span className="text-xs font-mono text-zinc-500">
                        {Math.floor(track.duration / 60)}:{String(track.duration % 60).padStart(2, '0')}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {result.type === 'search' && result.hasMore && (
              <div className="flex justify-center pt-3">
                <button
                  type="button"
                  onClick={handleLoadMoreResults}
                  disabled={loadingMoreResults || resolving}
                  className="px-5 py-3 rounded-xl border border-[#F472B6]/40 bg-[#F472B6]/10 hover:bg-[#F472B6]/20 text-[#F472B6] text-sm font-bold transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loadingMoreResults ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" /><span>Loading More Results...</span></>
                  ) : (
                    <><ArrowRight className="w-4 h-4" /><span>More Results</span></>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Permanent shared Download Queue Monitor */}
      <section className="bg-[#141622] border border-[#F472B6]/30 rounded-3xl p-6 md:p-8 shadow-2xl space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-[#F472B6]" />
              <h3 className="text-lg font-extrabold text-white">Download Queue Monitor</h3>
              <span className="text-[10px] px-2 py-1 rounded-full bg-[#F472B6]/15 text-[#F472B6] border border-[#F472B6]/25">LIVE</span>
            </div>
            <p className="text-xs text-zinc-400 mt-1">Shared queue • live updates • finished entries retained for 24 hours</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={refreshQueue} className="px-3 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 text-xs rounded-xl border border-white/10 flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
            <button type="button" onClick={handleClearFinished} disabled={clearingFinished || !queueJobs.some(job => ['completed', 'failed', 'cancelled'].includes(job.status))} className="px-3 py-2 bg-red-950/50 hover:bg-red-900/70 text-red-300 text-xs rounded-xl border border-red-500/30 disabled:opacity-40">
              {clearingFinished ? 'Clearing…' : 'Clear All Finished'}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[
            ['Active', queueSummary.workers, 'text-[#F472B6]'],
            ['Queued', queueSummary.queued, 'text-zinc-200'],
            ['Completed', queueSummary.completed, 'text-emerald-400'],
            ['Failed', queueSummary.failed, 'text-red-400'],
            ['Worker limit', queueSummary.maxWorkers, 'text-zinc-300'],
          ].map(([label, value, color]) => (
            <div key={String(label)} className="bg-[#08090E] border border-white/5 rounded-xl p-3 text-center">
              <span className="text-[10px] uppercase font-bold text-zinc-500 block">{label}</span>
              <span className={`text-lg font-extrabold font-mono ${color}`}>{value}</span>
            </div>
          ))}
        </div>
        {queueJobs.length === 0 ? (
          <div className="bg-[#08090E] border border-white/5 rounded-2xl p-8 text-center">
            <Music className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
            <p className="text-sm font-semibold text-zinc-300">The download queue is empty</p>
            <p className="text-xs text-zinc-500 mt-1">Admin Downloader and Karaoke room jobs will appear here automatically.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {queueJobs.map(job => (
              <div key={job.id} className="bg-[#08090E] border border-white/5 rounded-2xl p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-white truncate">{job.playlistName || 'Download job'}</div>
                    <div className="text-[10px] text-zinc-500 font-mono truncate">Job {job.id} · {job.tracks.length} tracks</div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${job.status === 'completed' ? 'bg-emerald-500/15 text-emerald-400' : job.status === 'failed' || job.status === 'cancelled' ? 'bg-red-500/15 text-red-400' : 'bg-[#F472B6]/15 text-[#F472B6]'}`}>{job.status}</span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-[#F472B6] to-[#ff7ebd]" style={{ width: `${Math.round((job.completedCount / (job.totalCount || 1)) * 100)}%` }} />
                </div>
                <div className="flex flex-wrap gap-3 text-[10px] text-zinc-400">
                  <span>{job.completedCount}/{job.totalCount} completed</span>
                  <span>{job.tracks.filter(t => t.status === 'queued').length} queued</span>
                  <span>{job.tracks.filter(t => ['searching', 'downloading'].includes(t.status)).length} downloading</span>
                  <span>{job.tracks.filter(t => t.status === 'tagging').length} finalising / processing</span>
                  <span>{job.tracks.filter(t => t.status === 'failed').length} failed</span>
                </div>
                {job.tracks.map(track => (
                  <div key={track.id} className="flex items-center gap-3 border-t border-white/5 pt-2">
                    <StatusIcon status={track.status} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-white truncate">{track.title}</div>
                      <div className="text-[10px] text-zinc-500 truncate">{track.artist}{track.error ? ` · ${track.error}` : ''}</div>
                    </div>
                    <span className="text-[10px] text-zinc-400 capitalize shrink-0">{track.status === 'tagging' ? 'Finalising' : track.status}</span>
                    <div className="w-14 h-1.5 bg-white/10 rounded-full overflow-hidden shrink-0"><div className={`h-full ${track.status === 'completed' ? 'bg-emerald-400' : track.status === 'failed' ? 'bg-red-500' : 'bg-[#F472B6]'}`} style={{ width: `${track.progress}%` }} /></div>
                  </div>
                ))}
                {job.tracks.some(t => t.status === 'failed') && (
                  <button type="button" onClick={async () => { await fetch(`/api/downloader/jobs/${job.id}/retry-failed`, { method: 'POST' }); await refreshQueue(); }} className="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs rounded-lg border border-amber-500/25">
                    <RefreshCw className="w-3 h-3 inline mr-1" /> Retry Failed ({job.tracks.filter(t => t.status === 'failed').length})
                  </button>
                )}
                {['queued', 'downloading'].includes(job.status) && (
                  <button type="button" onClick={async () => { await fetch(`/api/downloader/cancel/${job.id}`, { method: 'POST' }); await refreshQueue(); }} className="px-3 py-1.5 bg-red-950/50 hover:bg-red-900/70 text-red-300 text-xs rounded-lg border border-red-500/25">Cancel Job</button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatusIcon({ status }: { status: ActiveTrackJob['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-400 shrink-0" />;
    case 'downloading':
    case 'searching':
    case 'tagging':
      return <RefreshCw className="w-4 h-4 text-[#F472B6] animate-spin shrink-0" />;
    default:
      return <Music className="w-4 h-4 text-zinc-500 shrink-0" />;
  }
}
