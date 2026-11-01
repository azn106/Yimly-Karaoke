import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LyricsAppearanceSettings } from '../utils/lyricsSettings';
import { Tv, Bug } from 'lucide-react';

export interface LyricWord {
  text: string;
  start: number;
}

export interface LyricLine {
  time: number;
  text: string;
  words?: LyricWord[];
}

interface AutoResponsiveLyricsProps {
  lyrics: LyricLine[];
  focusIndex: number;
  lyricsSettings: LyricsAppearanceSettings;
  isHighlighted: boolean;
  animDuration?: number;
  sectionsCount?: number;
  applyTextCase: (text: string, textCase?: string) => string;
  getFontFamilyStyle: (fontId?: string, customFontName?: string | null) => string;
  getAlignmentClass: (alignment?: string) => string;
  isPreview?: boolean;
  currentTime?: number;
  lyricOffset?: number;
  showDebugHUD?: boolean;
}

interface DiagnosticData {
  containerWidth: number;
  containerHeight: number;
  unscaledGroupWidth: number;
  unscaledGroupHeight: number;
  scale: number;
  gap: number;
  currFontSize: number;
  unhighFontSize: number;
  lineSpacing: number;
  windowWidth: number;
  windowHeight: number;
  dpr: number;
}

export const AutoResponsiveLyrics: React.FC<AutoResponsiveLyricsProps> = ({
  lyrics,
  focusIndex,
  lyricsSettings,
  isHighlighted,
  animDuration = 0.25,
  sectionsCount = 2,
  applyTextCase,
  getFontFamilyStyle,
  isPreview = false,
  currentTime = 0,
  lyricOffset = 0,
  showDebugHUD,
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef<number>(1);
  const [scale, setScale] = useState<number>(1);
  const [effectiveGap, setEffectiveGap] = useState<number>(12);

  const sectionCount = Math.max(1, Math.min(5, Math.round(sectionsCount || 2)));
  const safeFocusIndex = Math.max(0, Math.min(Math.max(0, lyrics.length - 1), focusIndex));
  // Keep each group of N consecutive lyric lines visible together, one line per section.
  const groupStartIndex = Math.floor(safeFocusIndex / sectionCount) * sectionCount;
  const transitionStyle = lyricsSettings.lineTransition || 'fade';

  const isDebugEnabled = Boolean(
    showDebugHUD ||
    (typeof window !== 'undefined' && (() => {
      try {
        const params = new URLSearchParams(window.location.search);
        return params.has('debug') || params.has('tvdebug');
      } catch {
        return false;
      }
    })())
  );
  const [showDebug, setShowDebug] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      const params = new URLSearchParams(window.location.search);
      return params.has('debug') || params.has('tvdebug');
    } catch {
      return false;
    }
  });
  const [diagData, setDiagData] = useState<DiagnosticData>({
    containerWidth: 0, containerHeight: 0, unscaledGroupWidth: 0,
    unscaledGroupHeight: 0, scale: 1, gap: 12, currFontSize: 48,
    unhighFontSize: 20, lineSpacing: 1.2, windowWidth: 0,
    windowHeight: 0, dpr: 1,
  });

  const recalculateLayout = useCallback(() => {
    if (!stageRef.current || !groupRef.current) return;
    requestAnimationFrame(() => {
      if (!stageRef.current || !groupRef.current) return;
      const stageEl = stageRef.current;
      const groupEl = groupRef.current;
      const stageRect = stageEl.getBoundingClientRect();
      const stageWidth = stageRect.width;
      const stageHeight = stageRect.height;
      if (stageWidth <= 0 || stageHeight <= 0) return;

      const buffer = isPreview ? 12 : 24;
      const paddingY = isPreview ? 8 : Math.max(12, Math.round(stageHeight * 0.04));
      const paddingX = isPreview ? 10 : Math.max(16, Math.round(stageWidth * 0.04));
      const safeHeight = Math.max(50, stageHeight - (paddingY * 2 + buffer));
      const safeWidth = Math.max(100, stageWidth - paddingX * 2);
      const appliedScale = scaleRef.current > 0 ? scaleRef.current : 1;
      const rows = Array.from(groupEl.querySelectorAll('.lyric-line-row')) as HTMLElement[];
      let totalHeight = 0;
      let maxWidth = 0;
      rows.forEach((node) => {
        const rect = node.getBoundingClientRect();
        totalHeight += Math.max(node.offsetHeight, rect.height / appliedScale);
        maxWidth = Math.max(maxWidth, Math.max(node.offsetWidth, rect.width / appliedScale));
      });
      if (!rows.length) {
        const rect = groupEl.getBoundingClientRect();
        totalHeight = Math.max(groupEl.offsetHeight, rect.height / appliedScale);
        maxWidth = Math.max(groupEl.offsetWidth, rect.width / appliedScale);
      }

      const gapBase = Math.max(4, Math.round((lyricsSettings.unhighlighted.size || 20) * 0.3));
      const gaps = Math.max(0, rows.length - 1);
      let gap = gapBase;
      let projectedHeight = totalHeight + gaps * gap;
      if (projectedHeight > safeHeight && gap > 4 && gaps > 0) {
        gap = Math.max(4, gap - Math.min(gap - 4, Math.ceil((projectedHeight - safeHeight) / gaps)));
        projectedHeight = totalHeight + gaps * gap;
      }
      let nextScale = 1;
      const scaleY = safeHeight / (projectedHeight || safeHeight);
      const scaleX = safeWidth / (maxWidth || safeWidth);
      if (scaleY < 1 || scaleX < 1) {
        nextScale = Math.max(0.2, Math.floor(Math.min(scaleY, scaleX) * 100) / 100);
      }
      scaleRef.current = nextScale;
      setScale(nextScale);
      setEffectiveGap(gap);
      setDiagData({
        containerWidth: stageWidth, containerHeight: stageHeight,
        unscaledGroupWidth: maxWidth, unscaledGroupHeight: projectedHeight,
        scale: nextScale, gap,
        currFontSize: isHighlighted ? lyricsSettings.highlighted.size : lyricsSettings.unhighlighted.size,
        unhighFontSize: lyricsSettings.unhighlighted.size,
        lineSpacing: isHighlighted ? lyricsSettings.highlighted.lineSpacing : lyricsSettings.unhighlighted.lineSpacing,
        windowWidth: typeof window !== 'undefined' ? window.innerWidth : 0,
        windowHeight: typeof window !== 'undefined' ? window.innerHeight : 0,
        dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      });
    });
  }, [lyricsSettings, sectionCount, isHighlighted, isPreview]);

  useLayoutEffect(() => {
    recalculateLayout();
  }, [lyrics, focusIndex, lyricsSettings, sectionCount, isHighlighted, isPreview, recalculateLayout]);

  useEffect(() => {
    const handleFontLoad = () => recalculateLayout();
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.ready.then(handleFontLoad).catch(() => {});
      try { document.fonts.addEventListener('loadingdone', handleFontLoad); } catch {}
    }
    const stageEl = stageRef.current;
    const groupEl = groupRef.current;
    const handleResize = () => recalculateLayout();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      try {
        observer = new ResizeObserver(handleResize);
        if (stageEl) observer.observe(stageEl);
        if (groupEl) observer.observe(groupEl);
      } catch (error) {
        console.warn('[AutoResponsiveLyrics] ResizeObserver failed:', error);
      }
    }
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    document.addEventListener('fullscreenchange', handleResize);
    document.addEventListener('webkitfullscreenchange', handleResize);
    handleResize();
    const rafId = requestAnimationFrame(handleResize);
    return () => {
      observer?.disconnect();
      try { document.fonts?.removeEventListener('loadingdone', handleFontLoad); } catch {}
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      document.removeEventListener('fullscreenchange', handleResize);
      document.removeEventListener('webkitfullscreenchange', handleResize);
      cancelAnimationFrame(rafId);
    };
  }, [recalculateLayout]);

  const renderLine = (line: LyricLine | undefined, lineIndex: number, sectionIndex: number, slotIndex: number) => {
    const active = Boolean(line) && lineIndex === safeFocusIndex;
    const highlighted = active && isHighlighted && lyricsSettings.highlightCurrentLine !== false;
    const style = highlighted ? lyricsSettings.highlighted : lyricsSettings.unhighlighted;
    const direction = sectionIndex < (sectionCount - 1) / 2 ? -1 : sectionIndex > (sectionCount - 1) / 2 ? 1 : 0;
    const motionOffset = transitionStyle === 'slide' ? direction * 14 : 0;
    const duration = transitionStyle === 'instant' ? 0 : animDuration;

    if (!line) {
      return <div className="lyric-line-row flex items-center justify-center shrink-0 w-full min-h-[1.2em]" key={`row-${sectionIndex}-${slotIndex}`} />;
    }

    const highColor = lyricsSettings.highlighted.color || '#F472B6';
    const lowColor = lyricsSettings.unhighlighted.color || '#d4d4d8';
    const highOpacity = lyricsSettings.highlighted.opacity ?? 1;
    const lowOpacity = lyricsSettings.unhighlighted.opacity ?? 0.45;
    const adjustedTime = currentTime + lyricOffset / 1000;
    const nextLineTime = lyrics[lineIndex + 1]?.time ?? (line.time + 3);

    const wordNodes = line.words?.length ? line.words.map((word, wordIndex) => {
      const nextWordTime = line.words?.[wordIndex + 1]?.start ?? nextLineTime;
      const wordDuration = Math.max(0.08, nextWordTime - word.start);
      const rawMode = lyricsSettings.elrcTransition || lyricsSettings.elrcHighlightMode || 'smooth_sweep';
      const mode = rawMode === 'progressive_sweeping' ? 'smooth_sweep' : rawMode;
      const past = highlighted && (isPreview ? wordIndex === 0 : adjustedTime >= nextWordTime);
      const current = highlighted && (isPreview ? wordIndex === 1 : adjustedTime >= word.start && adjustedTime < nextWordTime);

      if (mode === 'smooth_sweep') {
        let wordStyle: React.CSSProperties;
        if (past) {
          wordStyle = { color: highColor, opacity: highOpacity, textShadow: `0 0 25px ${highColor}80` };
        } else if (current) {
          const progress = isPreview ? 60 : Math.min(100, Math.max(0, ((adjustedTime - word.start) / wordDuration) * 100));
          wordStyle = {
            backgroundImage: `linear-gradient(to right, ${highColor} 0%, ${highColor} ${progress}%, ${lowColor} ${progress}%, ${lowColor} 100%)`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            opacity: highOpacity,
            filter: `drop-shadow(0 0 8px ${highColor}70)`,
          };
        } else {
          wordStyle = { color: lowColor, opacity: lowOpacity };
        }
        return <span key={`word-${wordIndex}-${word.text}`} className="inline-block relative text-center select-none" style={wordStyle}>{applyTextCase(word.text, past || current ? lyricsSettings.highlighted.textCase : lyricsSettings.unhighlighted.textCase)}</span>;
      }

      if (mode === 'instant') {
        const wordHighlighted = highlighted && (isPreview ? wordIndex <= 1 : adjustedTime >= word.start);
        return <span key={`word-${wordIndex}-${word.text}`} className="inline-block text-center select-none" style={{ color: wordHighlighted ? highColor : lowColor, opacity: wordHighlighted ? highOpacity : lowOpacity, textShadow: current ? `0 0 25px ${highColor}80` : 'none' }}>{applyTextCase(word.text, wordHighlighted ? lyricsSettings.highlighted.textCase : lyricsSettings.unhighlighted.textCase)}</span>;
      }

      const wordHighlighted = highlighted && (isPreview
        ? (mode === 'current_only' ? wordIndex === 1 : wordIndex <= 1)
        : (mode === 'current_only' ? current : adjustedTime >= word.start));
      const wordColor = wordHighlighted ? highColor : lowColor;
      const wordOpacity = wordHighlighted ? highOpacity : lowOpacity;
      const animation = lyricsSettings.wordHighlightAnimation || 'smooth';
      const wordTransition = animation === 'instant' || animation === 'off'
        ? { duration: 0 }
        : animation === 'fade'
          ? { duration: 0.25, ease: 'easeInOut' as const }
          : { duration: 0.15, ease: 'easeOut' as const };
      const glow = animation === 'off' ? 'none' : current ? `0 0 25px ${highColor}80` : 'none';
      return <motion.span key={`word-${wordIndex}-${word.text}`} animate={{ scale: 1, color: wordColor, opacity: wordOpacity }} transition={wordTransition} className={animation === 'instant' || animation === 'off' ? 'inline-block text-center select-none' : 'inline-block transition-colors text-center select-none'} style={{ textShadow: glow, scale: 1 }}>{applyTextCase(word.text, wordHighlighted ? lyricsSettings.highlighted.textCase : lyricsSettings.unhighlighted.textCase)}</motion.span>;
    }) : null;

    return (
      <div className="lyric-line-row flex items-center justify-center shrink-0 w-full overflow-visible py-1 px-2 text-center" key={`row-${sectionIndex}-${slotIndex}`}>
        <AnimatePresence mode="wait">
          <motion.p
            key={`section-${sectionIndex}-slot-${slotIndex}-${line.time}-${line.text}`}
            initial={{ opacity: transitionStyle === 'instant' ? 1 : 0, y: motionOffset }}
            animate={{ opacity: style.opacity ?? (highlighted ? 1 : 0.45), y: 0 }}
            exit={{ opacity: 0, y: -motionOffset }}
            transition={{ duration, ease: 'easeOut' }}
            style={{
              fontFamily: getFontFamilyStyle(style.font, lyricsSettings.customFontName),
              fontSize: `${style.size}px`,
              fontWeight: style.weight,
              color: style.color || (highlighted ? highColor : lowColor),
              letterSpacing: `${style.letterSpacing}px`,
              lineHeight: style.lineSpacing,
              textAlign: 'center',
              textShadow: highlighted ? `0 0 35px ${highColor}75` : 'none',
            }}
            className="w-full whitespace-normal break-words leading-tight text-center"
          >
            {wordNodes
              ? <span className="flex flex-wrap items-center justify-center gap-x-[0.3em] gap-y-1 w-full text-center">{wordNodes}</span>
              : applyTextCase(line.text || '♪ ♪ ♪', style.textCase)}
          </motion.p>
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div ref={stageRef} className="w-full flex-1 h-full min-h-0 flex flex-col justify-center items-center overflow-hidden relative select-none">
      {isDebugEnabled && (
        <>
          <button type="button" onClick={() => setShowDebug((prev) => !prev)} className="absolute bottom-2 right-2 z-50 text-[10px] font-mono bg-black/70 hover:bg-black/90 text-zinc-300 border border-white/20 px-2 py-1 rounded-md opacity-60 hover:opacity-100 transition-opacity flex items-center gap-1 cursor-pointer" title="Toggle TV Diagnostics HUD">
            <Bug className="w-3 h-3 text-[#F472B6]" /><span>TV DEBUG</span>
          </button>
          {showDebug && (
            <div className="absolute top-2 right-2 z-50 bg-black/90 border border-[#F472B6]/40 text-emerald-400 font-mono text-[11px] p-3 rounded-xl shadow-2xl max-w-xs space-y-1 pointer-events-auto leading-tight text-left backdrop-blur-md">
              <div className="text-white font-bold border-b border-white/20 pb-1 mb-1.5 flex justify-between items-center"><span className="flex items-center gap-1 text-[#F472B6]"><Tv className="w-3.5 h-3.5" />TV Diagnostics</span><span className="text-zinc-400 text-[9px]">{diagData.dpr}x DPR</span></div>
              <div>Container: <span className="text-white font-bold">{Math.round(diagData.containerWidth)} x {Math.round(diagData.containerHeight)} px</span></div>
              <div>Unscaled Group: <span className="text-white font-bold">{Math.round(diagData.unscaledGroupWidth)} x {Math.round(diagData.unscaledGroupHeight)} px</span></div>
              <div>Calculated Scale: <span className="text-amber-300 font-bold">{diagData.scale}</span></div>
              <div>Calculated Gap: <span className="text-amber-300 font-bold">{diagData.gap}px</span></div>
              <div>Font Sizes: <span className="text-zinc-300">Curr {diagData.currFontSize}px / Unhigh {diagData.unhighFontSize}px</span></div>
              <div>Line Height Multiplier: <span className="text-zinc-300">{diagData.lineSpacing}</span></div>
              <div className="pt-1 border-t border-white/10 text-zinc-400 text-[10px]">Window: {diagData.windowWidth} x {diagData.windowHeight}</div>
            </div>
          )}
        </>
      )}
      <div ref={groupRef} className="w-full max-w-5xl mx-auto flex flex-col justify-center items-center text-center overflow-visible" style={{ gap: `${effectiveGap}px`, transform: scale < 1 ? `scale(${scale})` : 'none', transformOrigin: 'center center', width: '100%' }}>
        {Array.from({ length: sectionCount }, (_, sectionIndex) => (
          <div key={`lyric-section-${sectionIndex}`} className="w-full flex flex-col justify-center items-center overflow-visible" style={{ gap: `${effectiveGap}px` }}>
            {Array.from({ length: 3 }, (_, slotIndex) => {
              const lineIndex = groupStartIndex + sectionIndex + (slotIndex * sectionCount);
              return renderLine(lyrics[lineIndex], lineIndex, sectionIndex, slotIndex);
            })}
          </div>
        ))}
      </div>
    </div>
  );
};
