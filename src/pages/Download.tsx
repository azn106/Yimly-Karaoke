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
  title?: string;
  artist?: string;
  artworkUrl?: string;
  query?: string;
  tracks: ResolvedTrack[];
  message?: string;
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
  const [startingDownload, setStartingDownload] = useState(false);

  // Fetch libraries & default settings on mount
  useEffect(() => {
    if (user?.role === 'administrator') {
      fetchLibraries();
      fetchDownloaderSettings();
    }
  }, [user]);

  // Poll active job status if present
  useEffect(() => {
    if (!activeJobId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/downloader/jobs/${activeJobId}`);
        if (res.ok) {
          const data: ActiveJob = await res.json();
          setActiveJob(data);
          if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
            clearInterval(interval);
          }
        }
      } catch (e) {
        console.error('Failed to poll job status', e);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [activeJobId]);

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
        body: JSON.stringify({ urlOrQuery: inputVal.trim() }),
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
      // Fetch initial job state immediately
      const jobRes = await fetch(`/api/downloader/jobs/${data.jobId}`);
      if (jobRes.ok && jobRes.headers.get('content-type')?.includes('application/json')) {
        setActiveJob(await jobRes.json());
      }
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
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 text-[#FF4FA3] text-xs font-semibold uppercase tracking-wider mb-2">
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
          <SettingsIcon className="w-4 h-4 text-[#FF4FA3]" />
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
                className="w-full bg-[#08090E] border border-white/10 focus:border-[#FF4FA3] focus:ring-1 focus:ring-[#FF4FA3] rounded-2xl pl-12 pr-4 py-3.5 text-sm text-white placeholder-zinc-600 focus:outline-none transition-all font-mono"
              />
            </div>

            <button
              type="submit"
              disabled={resolving || !inputVal.trim()}
              className="px-6 py-3.5 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white text-sm font-bold rounded-2xl transition-all shadow-lg shadow-[#FF4FA3]/25 flex items-center justify-center gap-2 disabled:opacity-50 shrink-0"
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
                <Disc className="w-10 h-10 text-[#FF4FA3]" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#FF4FA3]/20 text-[#FF4FA3] border border-[#FF4FA3]/30 inline-block mb-1.5">
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
                  className="bg-[#141622] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#FF4FA3]"
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
                  className="bg-[#141622] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#FF4FA3] font-mono"
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
                  className="bg-[#141622] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#FF4FA3] font-mono"
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
                    className="w-4 h-4 rounded bg-[#08090E] border-white/20 text-[#FF4FA3] focus:ring-[#FF4FA3] accent-[#FF4FA3]"
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
              className="px-6 py-3 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white text-xs font-bold rounded-xl transition-all shadow-lg shadow-[#FF4FA3]/25 flex items-center gap-2 disabled:opacity-50"
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
                className="text-[#FF4FA3] font-bold hover:underline flex items-center gap-1.5"
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
                      isSelected ? 'bg-[#FF4FA3]/10 hover:bg-[#FF4FA3]/15' : 'hover:bg-white/5 opacity-60'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectIndex(idx)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 rounded bg-[#141622] border-white/20 text-[#FF4FA3] focus:ring-[#FF4FA3] accent-[#FF4FA3]"
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
          </div>
        </div>
      )}

      {/* Active Download Progress Monitor */}
      {activeJob && (
        <div className="bg-[#141622] border border-[#FF4FA3]/30 rounded-3xl p-6 md:p-8 shadow-2xl space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-[#FF4FA3] animate-pulse" />
                <h3 className="text-lg font-extrabold text-white">Active Download Progress</h3>
              </div>
              <p className="text-xs text-zinc-400 mt-1 font-mono">
                Job ID: {activeJob.id} • Library Path: {activeJob.libraryPath}
              </p>
            </div>

            <div className="flex items-center gap-3">
              {activeJob.tracks.some(t => t.status === 'failed') && (
                <button
                  type="button"
                  onClick={handleRetryFailed}
                  className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-semibold rounded-xl border border-amber-500/30 transition-colors flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry Failed ({activeJob.tracks.filter(t => t.status === 'failed').length})</span>
                </button>
              )}

              {activeJob.status === 'downloading' || activeJob.status === 'queued' ? (
                <button
                  type="button"
                  onClick={handleCancelJob}
                  className="px-3 py-1.5 bg-red-950/60 hover:bg-red-900 text-red-300 text-xs font-semibold rounded-xl border border-red-500/30 transition-colors"
                >
                  Cancel Job
                </button>
              ) : (
                <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-[#FF4FA3]/20 text-[#FF4FA3] border border-[#FF4FA3]/30">
                  {activeJob.status}
                </span>
              )}
            </div>
          </div>

          {/* Stats Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="bg-[#08090E] border border-white/5 rounded-xl p-2.5 text-center">
              <span className="text-[10px] uppercase font-bold text-zinc-500 block">Total</span>
              <span className="text-base font-extrabold text-white font-mono">{activeJob.totalCount}</span>
            </div>
            <div className="bg-[#08090E] border border-emerald-500/10 rounded-xl p-2.5 text-center">
              <span className="text-[10px] uppercase font-bold text-emerald-400 block">Completed</span>
              <span className="text-base font-extrabold text-emerald-400 font-mono">{activeJob.completedCount}</span>
            </div>
            <div className="bg-[#08090E] border border-[#FF4FA3]/10 rounded-xl p-2.5 text-center">
              <span className="text-[10px] uppercase font-bold text-[#FF4FA3] block">In Progress / Queued</span>
              <span className="text-base font-extrabold text-[#FF4FA3] font-mono">
                {activeJob.tracks.filter(t => t.status === 'queued' || t.status === 'searching' || t.status === 'downloading' || t.status === 'tagging').length}
              </span>
            </div>
            <div className="bg-[#08090E] border border-red-500/10 rounded-xl p-2.5 text-center">
              <span className="text-[10px] uppercase font-bold text-red-400 block">Failed</span>
              <span className="text-base font-extrabold text-red-400 font-mono">
                {activeJob.tracks.filter(t => t.status === 'failed').length}
              </span>
            </div>
          </div>

          {/* Summary Progress Bar */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-bold text-white">Overall Completion</span>
              <span className="font-mono text-[#FF4FA3] font-bold">
                {activeJob.completedCount} of {activeJob.totalCount} tracks finished (
                {Math.round((activeJob.completedCount / (activeJob.totalCount || 1)) * 100)}%)
              </span>
            </div>

            <div className="w-full h-3 bg-[#08090E] rounded-full overflow-hidden p-0.5 border border-white/10">
              <div
                style={{ width: `${(activeJob.completedCount / (activeJob.totalCount || 1)) * 100}%` }}
                className="h-full bg-gradient-to-r from-[#FF4FA3] to-[#ff7ebd] rounded-full transition-all duration-300 shadow-md shadow-[#FF4FA3]/30"
              />
            </div>
          </div>

          {/* Individual Tracks Processing List */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Tracks Processing</h4>

            <div className="bg-[#08090E] border border-white/5 rounded-2xl divide-y divide-white/5">
              {activeJob.tracks.map((tr) => (
                <div key={tr.id} className="p-3.5 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <StatusIcon status={tr.status} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-white truncate">{tr.title}</div>
                      <div className="text-[11px] text-zinc-400 truncate">{tr.artist}</div>
                      {tr.error && <div className="text-[10px] text-red-400 mt-0.5">{tr.error}</div>}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[11px] font-mono capitalize text-zinc-400">{tr.status}</span>
                    <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        style={{ width: `${tr.progress}%` }}
                        className={`h-full transition-all ${
                          tr.status === 'completed'
                            ? 'bg-emerald-400'
                            : tr.status === 'failed'
                            ? 'bg-red-500'
                            : 'bg-[#FF4FA3]'
                        }`}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {activeJob.status === 'completed' && (
            <div className="p-4 bg-emerald-950/40 border border-emerald-500/30 rounded-2xl text-emerald-300 text-xs flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <div className="font-bold">Music Download Complete!</div>
                  <p className="text-[11px] text-emerald-400/80 mt-0.5">
                    Newly downloaded tracks have been saved to your Yimly media directory and auto-rescanned into your music catalog.
                  </p>
                </div>
              </div>

              <Link
                to="/library"
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-xs rounded-xl transition-colors shrink-0"
              >
                View in Library
              </Link>
            </div>
          )}
        </div>
      )}
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
      return <RefreshCw className="w-4 h-4 text-[#FF4FA3] animate-spin shrink-0" />;
    default:
      return <Music className="w-4 h-4 text-zinc-500 shrink-0" />;
  }
}
