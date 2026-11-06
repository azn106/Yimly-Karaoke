import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, ListMusic, Music, ChevronUp, ChevronDown, Volume2, VolumeX, Volume1, Captions, LoaderCircle } from 'lucide-react';
import { usePlayback } from '../context/PlaybackContext';
import EqualizerIndicator from './EqualizerIndicator';
import { computeWordIntervals, calculateWordProgress } from '../utils/lyricsProgress';
import { getLyricsSettings } from '../utils/lyricsSettings';

type LyricWord = { text: string; start: number };
type TimedLyricLine = { time: number; text: string; id: string; words?: LyricWord[] };

function parseLrcLyrics(content: string, format: 'lrc' | 'elrc'): TimedLyricLine[] {
  const parsed: TimedLyricLine[] = [];
  const lineTag = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const wordTag = /<\s*(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\s*>/g;
  const toSeconds = (m: RegExpMatchArray) => Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number('0.' + m[3]) : 0);
  content.split(/\r?\n/).forEach((rawLine, lineIndex) => {
    const tags = [...rawLine.matchAll(lineTag)]; if (!tags.length) return;
    const body = rawLine.replace(lineTag, '').trim();
    if (!body || /^\[(?:ar|al|ti|by|re|ve|offset|length|tool|kana):/i.test(body)) return;
    const wordTags = [...body.matchAll(wordTag)];
    for (const tag of tags) {
      if (Number(tag[2]) >= 60) continue;
      let words: LyricWord[] | undefined; let text = body;
      if (format === 'elrc' && wordTags.length) {
        words = wordTags.map((word, i) => {
          const start = (word.index ?? 0) + word[0].length;
          const end = i + 1 < wordTags.length ? (wordTags[i + 1].index ?? body.length) : body.length;
          return { text: body.slice(start, end).replace(/<[^>]*>/g, '').trim(), start: toSeconds(word) };
        }).filter(word => word.text);
        text = words.map(word => word.text).join(' '); if (!words.length) words = undefined;
      }
      if (text) parsed.push({ time: toSeconds(tag), text, id: lineIndex + '-' + tag.index, words });
    }
  });
  return parsed.sort((x, y) => x.time - y.time);
}

export default function NowPlayingOverlay({ mode = 'overlay' }: { mode?: 'overlay' | 'panel' }) {
  const {
    currentSong, isPlaying, currentTime, duration, volume, isMuted, queue, queueIndex,
    isShuffle, repeatMode, togglePlay, seek, next, previous, setVolume, toggleMute,
    toggleShuffle, cycleRepeat, jumpToQueueIndex, bassLevel, transientLevel
  } = usePlayback();

  const [isExpanded, setIsExpanded] = useState(mode === 'panel');
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekTime, setSeekTime] = useState(0);
  const [showLyrics, setShowLyrics] = useState(false);
  const [isLyricsFullscreen, setIsLyricsFullscreen] = useState(false);
  const [fullscreenReturnToLyrics, setFullscreenReturnToLyrics] = useState(false);
  const [lyricsLines, setLyricsLines] = useState<TimedLyricLine[]>([]);
  const [lyricsFormat, setLyricsFormat] = useState<'lrc' | 'elrc'>('lrc');
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsUnavailable, setLyricsUnavailable] = useState(false);
  const [elrcDisplayLeadInMs, setElrcDisplayLeadInMs] = useState<number>(() => getLyricsSettings().elrcDisplayLeadInMs ?? 1500);
  const activeLyricRef = useRef<HTMLDivElement>(null);
  const fullscreenActiveLyricRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef<number | null>(null);
  const isQueueTouch = useRef(false);
  const [dragOffset, setDragOffset] = useState(0);
  const previousTransientRef = useRef(0);
  const pulseRef = useRef(0);
  const smoothPulseRef = useRef(0);
  const pulseFrameRef = useRef<number>(0);
  const pulseLastFrameRef = useRef(0);
  const lastBeatTimeRef = useRef(0);
  const pulseReleaseRef = useRef(285);
  const artworkCardRef = useRef<HTMLDivElement>(null);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const queueScrollRef = useRef<HTMLDivElement>(null);
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isProgrammaticScrollRef = useRef(false);

  const handleQueueScroll = () => {
    if (isProgrammaticScrollRef.current) return;
    setIsBrowsing(true);
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    inactivityTimerRef.current = setTimeout(() => {
      setIsBrowsing(false);
    }, 4000);
  };

  useEffect(() => {
    return () => {
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    };
  }, []);

  const recenterCurrentTrack = () => {
    const container = queueScrollRef.current;
    if (!container) return;
    const activeEl = container.querySelector('[data-queue-active="true"]') as HTMLElement || container.children[queueIndex] as HTMLElement;
    if (!activeEl) return;
    const containerRect = container.getBoundingClientRect();
    const activeRect = activeEl.getBoundingClientRect();
    const relativeTop = activeRect.top - containerRect.top + container.scrollTop;
    const maxScroll = container.scrollHeight - container.clientHeight;
    const targetScrollTop = Math.min(maxScroll, Math.max(0, relativeTop));
    isProgrammaticScrollRef.current = true;
    container.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
    setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, 500);
  };

  useEffect(() => {
    if (!isExpanded) return;
    if (!isBrowsing) {
      recenterCurrentTrack();
    }
  }, [queueIndex, currentSong?.id, isExpanded, isBrowsing]);

  // Audio-Reactive Radar Border: a continuous clockwise conic sweep, with each
  // detected transient launching a brighter, expanding halo ripple.
  useEffect(() => {
    const previousTransient = previousTransientRef.current;
    previousTransientRef.current = transientLevel;

    if (!isPlaying) {
      pulseRef.current = 0;
      smoothPulseRef.current = 0;
      if (pulseFrameRef.current) cancelAnimationFrame(pulseFrameRef.current);
      pulseFrameRef.current = 0;
      pulseLastFrameRef.current = 0;
      lastBeatTimeRef.current = 0;
      pulseReleaseRef.current = 285;
      const card = artworkCardRef.current;
      if (card) {
        card.style.borderColor = 'transparent';
        card.style.borderWidth = '3px';
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
        const targetPulse = Math.max(0, pulseRef.current);
        pulseRef.current *= Math.exp(-elapsed / pulseReleaseRef.current);
        // Ease the visible response so each drum hit blooms rather than flashes.
        const smoothing = 1 - Math.exp(-elapsed / (targetPulse > smoothPulseRef.current ? 58 : 190));
        smoothPulseRef.current += (targetPulse - smoothPulseRef.current) * smoothing;
        const pulse = Math.max(0, smoothPulseRef.current);
        const angle = (timestamp * 0.042) % 360;
        const card = artworkCardRef.current;
        if (card) {
          card.style.borderColor = 'transparent';
          card.style.borderWidth = (3 + pulse * 0.9) + 'px';
          card.style.background = 'conic-gradient(from ' + angle + 'deg, ' +
            'rgba(244,114,182,0.16) 0deg, ' +
            'rgba(244,114,182,0.20) 258deg, ' +
            'rgba(249,168,212,' + (0.42 + pulse * 0.30) + ') 294deg, ' +
            'rgba(255,245,251,' + (0.58 + pulse * 0.30) + ') 316deg, ' +
            'rgba(244,114,182,' + (0.34 + pulse * 0.38) + ') 340deg, ' +
            'rgba(244,114,182,0.16) 360deg)';
          card.style.boxShadow =
            '0 20px 45px rgba(0,0,0,0.32), ' +
            '0 0 ' + (6 + pulse * 16) + 'px rgba(244,114,182,' + (0.07 + pulse * 0.28) + '), ' +
            '0 0 ' + (2 + pulse * 7) + 'px rgba(249,168,212,' + (pulse * 0.30) + ')';
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
    const syncLyricsSettings = () => setElrcDisplayLeadInMs(getLyricsSettings().elrcDisplayLeadInMs ?? 1500);
    window.addEventListener('yimly_lyrics_settings_changed', syncLyricsSettings);
    return () => window.removeEventListener('yimly_lyrics_settings_changed', syncLyricsSettings);
  }, []);

  useEffect(() => {
    // Track changes should refresh lyric data without changing the user's current player view.
    setLyricsLines([]);
    setLyricsUnavailable(false);
  }, [currentSong?.id]);

  useEffect(() => {
    if ((!showLyrics && !isLyricsFullscreen) || !currentSong?.id) return;
    const controller = new AbortController(); setLyricsLoading(true); setLyricsUnavailable(false);
    const loadLyrics = async () => {
      try {
        const response = await fetch('/api/songs/' + currentSong.id + '/lyrics?format=elrc', { signal: controller.signal, credentials: 'same-origin', headers: { Accept: 'text/plain' } });
        if (response.ok) { const parsed = parseLrcLyrics(await response.text(), 'elrc'); if (parsed.length && parsed.some(line => line.words?.length)) { if (controller.signal.aborted) return; setLyricsFormat('elrc'); setLyricsLines(parsed); setLyricsUnavailable(false); return; } }
      } catch { if (controller.signal.aborted) return; }
      try {
        const response = await fetch('/api/songs/' + currentSong.id + '/lyrics?format=lrc', { signal: controller.signal, credentials: 'same-origin', headers: { Accept: 'text/plain' } });
        if (!response.ok) throw new Error('Lyrics unavailable'); const parsed = parseLrcLyrics(await response.text(), 'lrc');
        if (controller.signal.aborted) return; setLyricsFormat('lrc'); setLyricsLines(parsed); setLyricsUnavailable(parsed.length === 0);
      } catch { if (!controller.signal.aborted) { setLyricsLines([]); setLyricsUnavailable(true); } }
    };
    loadLyrics().finally(() => { if (!controller.signal.aborted) setLyricsLoading(false); });
    return () => controller.abort();
  }, [showLyrics, isLyricsFullscreen, currentSong?.id]);

  const lyricStart = (line?: TimedLyricLine) => line?.words?.length ? line.words[0].start : (line?.time ?? Infinity);
  const activeLyricIndex = lyricsLines.reduce((active, line, index) => lyricStart(line) <= currentTime ? index : active, -1);

  // The cover-art focus view is the room renderer's one-section LRC presentation:
  // show only one complete line, introduce the first line 1.5s early, then replace
  // it on each following LRC line timestamp. eLRC word timings are not highlighted here.
  const coverLyricIndex = lyricsLines.reduce((latest, line, index) => {
    const revealAt = index === 0 ? line.time - 1.5 : line.time;
    return currentTime >= revealAt ? index : latest;
  }, -1);

  // Fullscreen lyrics use the room renderer's five independently rotating sections.
  const lyricDisplayLeadInSec = lyricsFormat === 'elrc' ? Math.max(0, elrcDisplayLeadInMs / 1000) : 1.5;
  const lyricEntranceFadeSec = Math.max(0.1, lyricDisplayLeadInSec - 0.5);
  const displayFocusIndex = lyricsLines.reduce((latest, line, index) => (
    currentTime >= lyricStart(line) - lyricDisplayLeadInSec ? index : latest
  ), -1);
  const fullscreenSectionLines = Array.from({ length: 5 }, (_, sectionIndex) => {
    const firstLine = lyricsLines[sectionIndex];
    const firstLineReady = Boolean(firstLine) && currentTime >= lyricStart(firstLine) - lyricDisplayLeadInSec;
    const scheduledLineIndex = displayFocusIndex >= sectionIndex
      ? displayFocusIndex - ((displayFocusIndex - sectionIndex) % 5)
      : sectionIndex;
    let lineIndex = firstLineReady ? sectionIndex : -1;

    for (let nextLineIndex = sectionIndex + 5; nextLineIndex <= scheduledLineIndex; nextLineIndex += 5) {
      const previousLineIndex = nextLineIndex - 5;
      const previousLine = lyricsLines[previousLineIndex];
      const previousIntervals = lyricsFormat === 'elrc' && previousLine?.words?.length
        ? computeWordIntervals(previousLine.words)
        : [];
      const previousLastInterval = previousIntervals[previousIntervals.length - 1];
      const previousLineEnd = previousLastInterval?.end ?? lyricsLines[previousLineIndex + 1]?.time ?? Infinity;
      const nextLineStart = lyricStart(lyricsLines[nextLineIndex]);
      const sectionAdvanceTime = Math.max(previousLineEnd, nextLineStart - lyricDisplayLeadInSec);
      if (currentTime >= sectionAdvanceTime) lineIndex = nextLineIndex;
      else break;
    }
    return { sectionIndex, lineIndex, line: lineIndex >= 0 ? lyricsLines[lineIndex] : undefined };
  });

  useEffect(() => {
    if (mode === 'panel' || !isExpanded) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = oldOverflow; };
  }, [isExpanded, mode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isLyricsFullscreen) setIsLyricsFullscreen(false);
      else if (event.key === 'Escape' && isExpanded) setIsExpanded(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isExpanded, isLyricsFullscreen]);

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
    if ((event.target as HTMLElement).closest('[data-queue-scroll], [data-lyrics-scroll]')) {
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
      {mode === 'overlay' && <div onTouchStart={onCompactTouchStart} onTouchEnd={onCompactTouchEnd} className="fixed bottom-0 left-0 right-0 xl:left-[230px] z-40 bg-[#11121A]/95 backdrop-blur-md border-t border-white/10 shadow-2xl select-none pb-[max(0.45rem,env(safe-area-inset-bottom))] touch-pan-y" role="region" aria-label="Compact media player">
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
      </div>}

      {mode === 'overlay' && <div className={'fixed inset-0 z-50 bg-black/55 backdrop-blur-sm transition-opacity duration-300 xl:left-[230px] ' + (isExpanded ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none')} onClick={() => setIsExpanded(false)} style={{ pointerEvents: isExpanded ? 'auto' : 'none' }} aria-hidden="true" />}

      <div
        className={mode === 'panel' ? 'relative flex flex-col flex-1 min-h-0 h-full w-full overflow-hidden' : 'fixed inset-0 z-50 flex flex-col shadow-2xl overflow-hidden transition-transform duration-300 h-[100dvh] w-full rounded-none border-0 ' + (isExpanded ? 'translate-y-0' : 'translate-y-full pointer-events-none')}
        style={mode === 'panel' ? undefined : { transform: isExpanded ? (dragOffset > 0 ? 'translateY(' + dragOffset + 'px)' : 'translateY(0)') : 'translateY(100%)', pointerEvents: isExpanded ? 'auto' : 'none', transition: dragOffset > 0 ? 'none' : undefined }}
        onTouchStart={mode === 'panel' ? undefined : onExpandedTouchStart} onTouchMove={mode === 'panel' ? undefined : onExpandedTouchMove} onTouchEnd={mode === 'panel' ? undefined : onExpandedTouchEnd}
        aria-hidden={mode === 'panel' ? false : !isExpanded} role={mode === 'panel' ? undefined : 'dialog'} aria-modal={mode === 'panel' ? undefined : true} aria-label="Now playing expanded player"
      >
        {currentSong?.hasArtwork && <img key={currentSong.id} src={'/api/songs/' + currentSong.id + '/artwork'} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover pointer-events-none" style={{ filter: 'none', transform: 'scale(1.10)', opacity: 0.9 }} onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
        {/* Keep the cover artwork visible through a translucent pink tint across the entire player card. */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(180deg, rgba(190,24,93,0.48) 0%, rgba(157,23,77,0.58) 48%, rgba(35,12,29,0.72) 100%)' }} />

        <div className="relative z-10 flex flex-col flex-1 min-h-0">
          <header className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-3 px-4 sm:px-6 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 shrink-0 select-none" title="Swipe down to minimize">
            <div className="flex items-center justify-start">
              <button
                type="button"
                onClick={() => setShowLyrics(value => !value)}
                className={'w-10 h-10 flex items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-200 ' + (showLyrics ? 'bg-white text-[#8A174F]' : 'text-white/85 hover:bg-white/15 hover:text-white')}
                title={showLyrics ? 'Show cover art' : 'Show synced lyrics'}
                aria-label={showLyrics ? 'Show cover art' : 'Show synced lyrics'}
                aria-pressed={showLyrics}
              ><Captions className="w-5 h-5" /></button>
            </div>
            <div className="min-w-0 text-center">
              <h2 className="text-base sm:text-lg font-bold text-white truncate">{currentSong?.title || 'No track selected'}</h2>
              <p className="text-sm text-white/75 truncate">{currentSong?.artist || 'Unknown Artist'}{currentSong?.album ? ' · ' + currentSong.album : ''}</p>
            </div>
            <div className="flex items-center justify-end">
              {mode === 'overlay' && <button type="button" onClick={() => setIsExpanded(false)} className="w-10 h-10 -mr-1 flex items-center justify-center text-white/85 hover:bg-white/15 hover:text-white rounded-full shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-200" title="Minimize player" aria-label="Minimize player"><ChevronDown className="w-6 h-6" /></button>}
            </div>
          </header>

          <section className="shrink-0 px-5 sm:px-8 pb-2">
            <div className="flex justify-center mb-3">
              <div className="yk-now-playing-artwork-size w-[min(58vw,320px)] h-[min(58vw,320px)] sm:w-[min(28vw,300px)] sm:h-[min(28vw,300px)] max-w-[320px] max-h-[320px] min-w-[116px] min-h-[116px]">
                <div
                  ref={artworkCardRef}
                  className="yk-audio-reactive-border relative w-full h-full rounded-2xl overflow-hidden border bg-black/20 will-change-[border-color,background,box-shadow] shadow-xl cursor-zoom-in"
                  onClick={() => { setFullscreenReturnToLyrics(false); setIsLyricsFullscreen(true); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setFullscreenReturnToLyrics(false); setIsLyricsFullscreen(true); } }}
                  aria-label="Open full-screen lyrics"
                  style={{
                    borderColor: 'transparent',
                    borderWidth: '1px',
                    background: 'conic-gradient(from 0deg, rgba(244,114,182,0.20), rgba(244,114,182,0.24), rgba(249,168,212,0.8), rgba(244,114,182,0.20))',
                    boxShadow: '0 20px 45px rgba(0,0,0,0.32), 0 0 7px rgba(244,114,182,0.08)',
                  }}
                >
                  {showLyrics ? (
                    <>
                      <style>{'@keyframes ykLyricsFadeIn { from { opacity: 0; } to { opacity: 1; } } @keyframes ykLyricsFocusIn { from { opacity: 0; } to { opacity: 1; } }'}</style>
                      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden" style={{ animation: 'ykLyricsFadeIn 650ms ease-out both' }}>
                        {currentSong?.hasArtwork && <img key={currentSong.id + '-lyrics-bg'} src={'/api/songs/' + currentSong.id + '/artwork'} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
                        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(190,24,93,0.42) 0%, rgba(157,23,77,0.52) 54%, rgba(35,12,29,0.66) 100%)' }} />
                      </div>
                      <div
                      className="absolute inset-0 z-20 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5 text-center"
                      style={{ animation: 'ykLyricsFadeIn 450ms ease-out both' }}
                      data-lyrics-scroll
                      onClick={(event) => { event.stopPropagation(); setFullscreenReturnToLyrics(true); setIsLyricsFullscreen(true); }}
                      onTouchStart={(event) => { isQueueTouch.current = true; touchStartY.current = null; event.stopPropagation(); }}
                      onTouchMove={(event) => event.stopPropagation()}
                      onTouchEnd={(event) => { event.stopPropagation(); isQueueTouch.current = false; }}
                      onWheel={(event) => event.stopPropagation()}
                    >
                      {lyricsLoading ? (
                        <div className="h-full flex flex-col items-center justify-center gap-3 text-white/80"><LoaderCircle className="w-7 h-7 animate-spin" /><span className="text-sm">Loading synced lyrics…</span></div>
                      ) : lyricsUnavailable ? (
                        <div className="h-full flex flex-col items-center justify-center gap-2 text-white/80"><Captions className="w-8 h-8 text-pink-200/80" /><p className="text-sm font-medium">No synced lyrics available</p><p className="text-xs text-white/55">Add an LRC file to this song’s music folder to display lyrics here.</p></div>
                      ) : (
                        <div className="w-full h-full min-h-0 flex items-center justify-center px-2 text-center" data-lyrics-section="0">
                          {coverLyricIndex >= 0 && lyricsLines[coverLyricIndex] ? (() => {
                            const line = lyricsLines[coverLyricIndex];
                            const active = currentTime >= line.time;
                            return <p
                              key={'cover-focus-' + line.id}
                              ref={active ? activeLyricRef : null}
                              className="w-full text-balance break-words px-1 text-lg sm:text-xl font-bold text-white"
                              aria-current={active ? 'true' : undefined}
                              style={{
                                animation: 'ykLyricsFocusIn 1000ms ease-out both',
                                lineHeight: 1.25,
                                opacity: 1,
                                display: '-webkit-box',
                                WebkitBoxOrient: 'vertical',
                                WebkitLineClamp: 3,
                                overflow: 'hidden',
                              }}
                            >{line.text}</p>;
                          })() : null}
                        </div>
                      )}
                      </div>
                    </>
                  ) : (
                    <>
                      <Music className="absolute inset-0 m-auto w-10 h-10 text-white/45" />
                      {currentSong?.hasArtwork && <img key={currentSong.id} src={'/api/songs/' + currentSong.id + '/artwork'} alt={currentSong.title} className={'relative z-10 w-full h-full object-cover ' + (isPlaying ? 'yk-artwork-image-breathe' : '')} style={{ '--yk-breathe-depth': (0.012 + Math.min(1, bassLevel) * 0.045).toFixed(3) } as React.CSSProperties} onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
                    </>
                  )}
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
            <div ref={queueScrollRef} onScroll={handleQueueScroll} data-queue-scroll className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 sm:px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {visibleQueue.map((song, index) => {
                const isCurrent = (queue.length > 0 && index === queueIndex) || (queue.length === 0 && song.id === currentSong?.id);
                return (
                  <button key={String(song.id) + '-' + index} type="button" data-queue-active={isCurrent ? 'true' : 'false'} onClick={() => { setIsBrowsing(false); if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current); if (queue.length > 0) jumpToQueueIndex(index); }} className={'w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-colors border border-transparent ' + (isCurrent ? 'bg-[#F472B6]/20 border-[#F472B6]/30' : 'hover:bg-white/10')} aria-label={isCurrent ? song.title + ', current track' : 'Play ' + song.title}>
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

      {isExpanded && isLyricsFullscreen && (
        <div className="fixed inset-0 z-[60] h-[100dvh] w-[100vw] max-w-none rounded-none border-0 m-0 overflow-hidden bg-[#190D18]" role="dialog" aria-modal="true" aria-label="Full-screen synced lyrics">
          {currentSong?.hasArtwork && <img key={currentSong.id + '-fullscreen-lyrics'} src={'/api/songs/' + currentSong.id + '/artwork'} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover pointer-events-none" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(180deg, rgba(190,24,93,0.42) 0%, rgba(157,23,77,0.52) 54%, rgba(35,12,29,0.78) 100%)' }} />
          <div className="relative z-10 flex flex-col h-full min-h-0" style={{ animation: 'ykLyricsFadeIn 350ms ease-out both' }}>
            <header className="flex items-center justify-center px-4 sm:px-6 pt-[max(0.75rem,env(safe-area-inset-top))] pb-4 shrink-0">
              <div className="min-w-0 text-center">
                <p className="text-[11px] tracking-[0.22em] font-semibold text-pink-200/90 uppercase">Synced lyrics</p>
                <h2 className="text-lg sm:text-xl font-bold text-white truncate mt-1">{currentSong?.title || 'No track selected'}</h2>
                <p className="text-sm text-white/75 truncate">{currentSong?.artist || 'Unknown Artist'}{currentSong?.album ? ' · ' + currentSong.album : ''}</p>
              </div>
              </div>
            </header>
            <div data-lyrics-scroll className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-10 pb-[max(2rem,env(safe-area-inset-bottom))] text-center" onClick={() => { setShowLyrics(fullscreenReturnToLyrics); setIsLyricsFullscreen(false); }} onTouchStart={(event) => { isQueueTouch.current = true; touchStartY.current = null; event.stopPropagation(); }} onTouchMove={(event) => event.stopPropagation()} onTouchEnd={(event) => { event.stopPropagation(); isQueueTouch.current = false; }} onWheel={(event) => event.stopPropagation()}>
              {lyricsLoading ? (
                <div className="h-full flex flex-col items-center justify-center gap-3 text-white/80"><LoaderCircle className="w-7 h-7 animate-spin" /><span className="text-sm">Loading synced lyrics…</span></div>
              ) : lyricsUnavailable ? (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-white/80"><Captions className="w-8 h-8 text-pink-200/80" /><p className="text-sm font-medium">No synced lyrics available</p><p className="text-xs text-white/55">Add an LRC file to this song’s music folder to display lyrics here.</p></div>
              ) : (
                <div key={'fullscreen-sections-' + (lyricsLines[0]?.id || 'empty')} className="h-full min-h-0 w-full max-w-5xl mx-auto flex flex-col justify-center gap-1 sm:gap-3 py-2" data-lyrics-format={lyricsFormat}>
                  {fullscreenSectionLines.map(({ sectionIndex, lineIndex, line }) => {
                    if (!line || lineIndex < 0) return <div key={'fullscreen-section-' + sectionIndex} data-lyrics-section={sectionIndex} className="flex-1 min-h-0 w-full" />;

                    const wordIntervals = lyricsFormat === 'elrc' && line.words?.length ? computeWordIntervals(line.words) : [];
                    const firstInterval = wordIntervals[0];
                    const lastInterval = wordIntervals[wordIntervals.length - 1];
                    const lineSingingStartTime = firstInterval?.start ?? line.time;
                    const lineSingingEndTime = lastInterval?.end ?? line.time;
                    const nextLrcLineTime = lyricsLines[lineIndex + 1]?.time ?? Infinity;
                    const isLinePast = wordIntervals.length > 0
                      ? currentTime >= lineSingingEndTime
                      : currentTime >= nextLrcLineTime;
                    const isLineActive = wordIntervals.length > 0
                      ? currentTime >= lineSingingStartTime && currentTime < lineSingingEndTime
                      : currentTime >= line.time && currentTime < nextLrcLineTime;
                    const wordProgressList = wordIntervals.length
                      ? calculateWordProgress(line.words || [], wordIntervals, currentTime, isLineActive, isLinePast, false)
                      : [];
                    const fadeStartTime = lyricStart(lyricsLines[lineIndex + 1]);
                    const replacementStartTime = lyricStart(lyricsLines[lineIndex + 5]);
                    const fadeEndTime = Math.max(lineSingingEndTime, replacementStartTime - lyricDisplayLeadInSec);
                    const fadeProgress = Number.isFinite(fadeEndTime)
                      ? Math.max(0, Math.min(1, (currentTime - fadeStartTime) / Math.max(0.001, fadeEndTime - fadeStartTime)))
                      : 0;
                    const lineOpacity = 1 - fadeProgress;
                    const active = lineIndex === activeLyricIndex;
                    const lineText = wordIntervals.length ? (
                      <span className="inline-flex flex-wrap items-center justify-center gap-x-[0.3em] gap-y-1 w-full">
                        {(line.words || []).map((word, wordIndex) => {
                          const fillPercent = wordProgressList[wordIndex] ?? 0;
                          const transformedText = word.text;
                          return <span key={'word-' + wordIndex} className="relative inline-block whitespace-nowrap">
                            <span style={{ color: '#C6B1C4', opacity: 0.9 }}>{transformedText}</span>
                            {fillPercent > 0 && <span aria-hidden="true" className="absolute inset-0 overflow-hidden whitespace-nowrap pointer-events-none" style={{ color: '#F09ACB', textShadow: '0 0 18px rgba(244,114,182,0.45)', clipPath: fillPercent >= 100 ? 'none' : 'inset(0 ' + (100 - fillPercent).toFixed(2) + '% 0 0)' }}>{transformedText}</span>}
                          </span>;
                        })}
                      </span>
                    ) : line.text;

                    return <div
                      key={'fullscreen-section-' + sectionIndex + '-line-' + line.id}
                      ref={active ? fullscreenActiveLyricRef : null}
                      data-lyrics-section={sectionIndex}
                      className="flex-1 min-h-0 w-full flex items-center justify-center text-center px-2 overflow-hidden text-lg sm:text-xl font-bold text-white"
                      style={{ opacity: active ? 1 : lineOpacity, lineHeight: 1.25 }}
                    >
                      <p className="w-full text-balance break-words" style={{ animation: 'ykLyricsFocusIn ' + lyricEntranceFadeSec + 's ease-out both', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: window.matchMedia('(orientation: portrait)').matches ? 2 : 1, overflow: 'hidden' }}>{lineText}</p>
                    </div>;
                  })}
                </div>
              )}
            </div>
            <footer className="shrink-0 px-5 sm:px-8 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-[#190D18]/65 to-transparent">
              <div className="w-full max-w-2xl mx-auto">
                <div className="h-1 rounded-full bg-white/20 overflow-hidden"><div className="h-full rounded-full bg-[#F472B6] transition-all duration-150" style={{ width: progress + '%' }} /></div>
                <div className="flex justify-between text-xs font-mono text-white/70 tabular-nums mt-2"><span>{formatTime(activeTime)}</span><span>{formatTime(trackDuration)}</span></div>
                <div className="flex items-center justify-center gap-8 sm:gap-12 mt-4">
                  <button type="button" onClick={previous} className="p-2 text-white/85 hover:text-white" aria-label="Previous track"><SkipBack className="w-6 h-6 fill-current" /></button>
                  <button type="button" onClick={togglePlay} className="w-14 h-14 rounded-full border-2 border-pink-300 text-white flex items-center justify-center shadow-[0_0_20px_rgba(244,114,182,0.2)] hover:bg-white/10" aria-label={isPlaying ? 'Pause playback' : 'Start playback'}>{isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-0.5" />}</button>
                  <button type="button" onClick={next} className="p-2 text-white/85 hover:text-white" aria-label="Next track"><SkipForward className="w-6 h-6 fill-current" /></button>
                </div>
              </div>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
