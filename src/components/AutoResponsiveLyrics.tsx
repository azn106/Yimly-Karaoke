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
  sectionsCount = 2,
  applyTextCase,
  getFontFamilyStyle,
  getAlignmentClass,
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
      
      let maxWidth = 0;
      rows.forEach((node) => {
        const rect = node.getBoundingClientRect();
        maxWidth = Math.max(maxWidth, Math.max(node.offsetWidth, rect.width / appliedScale));
      });
      if (!rows.length) {
        const rect = groupEl.getBoundingClientRect();
        maxWidth = Math.max(groupEl.offsetWidth, rect.width / appliedScale);
      }

      // STABLE LAYOUT: Allocate fixed vertical space per section based on font metrics.
      const baseFontSize = lyricsSettings.highlighted.size || 48;
      const lineSpacing = lyricsSettings.highlighted.lineSpacing || 1.2;
      const singleLineHeight = baseFontSize * lineSpacing;
      
      // Allocate space for 2.5 lines per section to handle wrapping without affecting scale.
      const sectionHeightAllocation = singleLineHeight * 2.5; 
      const gapBase = Math.max(4, Math.round(baseFontSize * 0.2));
      const gaps = Math.max(0, sectionCount - 1);
      const gap = gapBase;
      const projectedHeight = (sectionCount * sectionHeightAllocation) + (gaps * gap);

      let nextScale = 1;
      const scaleY = safeHeight / (projectedHeight || safeHeight);
      const scaleX = safeWidth / (maxWidth || safeWidth);
      
      if (scaleY < 1 || scaleX < 1) {
        nextScale = Math.max(0.15, Math.floor(Math.min(scaleY, scaleX) * 100) / 100);
      }
      
      scaleRef.current = nextScale;
      setScale(nextScale);
      setEffectiveGap(gap);
      setDiagData({
        containerWidth: stageWidth, containerHeight: stageHeight,
        unscaledGroupWidth: maxWidth, unscaledGroupHeight: projectedHeight,
        scale: nextScale, gap,
        currFontSize: baseFontSize,
        unhighFontSize: baseFontSize,
        lineSpacing: lineSpacing,
        windowWidth: typeof window !== 'undefined' ? window.innerWidth : 0,
        windowHeight: typeof window !== 'undefined' ? window.innerHeight : 0,
        dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      });
    });
  }, [lyricsSettings.highlighted.size, lyricsSettings.highlighted.lineSpacing, sectionCount, isPreview]);

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
    if (!line) {
      return (
        <div 
          className="lyric-line-row flex items-center justify-center shrink-0 w-full min-h-[1.2em]" 
          key={`row-${sectionIndex}-${slotIndex}`} 
        />
      );
    }

    const textAlignment = lyricsSettings.alignment || 'center';
    const rowJustify = textAlignment === 'left' ? 'justify-start' : textAlignment === 'right' ? 'justify-end' : 'justify-center';
    
    const highColor = lyricsSettings.highlighted.color || '#F472B6';
    const lowColor = lyricsSettings.unhighlighted.color || '#d4d4d8';
    const highOpacity = lyricsSettings.highlighted.opacity ?? 1;
    const lowOpacity = lyricsSettings.unhighlighted.opacity ?? 0.45;
    const adjustedTime = currentTime + lyricOffset / 1000;
    const displayStyle = lyricsSettings.highlighted;

    // TRANSITION TIMING:
    // Transition starts at the first word's timestamp of the INCOMING line.
    // Duration is hardcoded to 1.5s.
    const transitionStartTime = line.words?.[0]?.start ?? line.time;
    const transitionDuration = 1.5;
    
    // Calculate the delay for the entry animation relative to when this component mounts (scheduling time).
    // If adjustedTime is already past transitionStartTime (e.g. on seek), delay is 0.
    const transitionDelay = Math.max(0, transitionStartTime - adjustedTime);

    const wordNodes = line.words?.length ? line.words.map((word, wordIndex) => {
      // PERMANENT HIGHLIGHTING: Word stays highlighted once its timestamp is passed.
      const wordHighlighted = isHighlighted && (isPreview ? wordIndex <= 1 : adjustedTime >= word.start);
      const wordColor = wordHighlighted ? highColor : lowColor;
      const wordOpacity = wordHighlighted ? highOpacity : lowOpacity;
      
      const glow = wordHighlighted ? `0 0 25px ${highColor}80` : 'none';
      
      return (
        <span 
          key={`word-${wordIndex}-${word.text}`} 
          className="inline-block transition-colors duration-200 text-center select-none"
          style={{ color: wordColor, opacity: wordOpacity, textShadow: glow }}
        >
          {applyTextCase(word.text, wordHighlighted ? lyricsSettings.highlighted.textCase : lyricsSettings.unhighlighted.textCase)}
        </span>
      );
    }) : null;

    return (
      <div className={`lyric-line-row flex h-full items-center ${rowJustify} shrink-0 w-full overflow-visible py-1 px-2 absolute inset-0`} key={`row-${sectionIndex}-${slotIndex}`}>
        <AnimatePresence mode="popLayout">
          <motion.p
            key={`section-${sectionIndex}-slot-${slotIndex}-${line.time}-${line.text}`}
            // Simultaneous Left-to-Right Wipe:
            // The wipereveal/exit happens at transitionStartTime.
            // Before transitionStartTime, the incoming line is scheduled but fully hidden by clipPath.
            initial={{ clipPath: 'inset(0 100% 0 0)', opacity: 0 }}
            animate={{ clipPath: 'inset(0 0% 0 0)', opacity: highOpacity }}
            exit={{ clipPath: 'inset(0 0 0 100%)', opacity: 0 }}
            transition={{ 
              duration: transitionDuration, 
              ease: "linear",
              delay: transitionDelay
            }}
            style={{
              fontFamily: getFontFamilyStyle(displayStyle.font, lyricsSettings.customFontName),
              fontSize: `${displayStyle.size}px`,
              fontWeight: displayStyle.weight,
              color: highColor,
              letterSpacing: `${displayStyle.letterSpacing}px`,
              lineHeight: displayStyle.lineSpacing,
              textAlign: textAlignment,
            }}
            className={`w-full whitespace-normal break-words leading-tight ${getAlignmentClass(textAlignment)}`}
          >
            {wordNodes
              ? <span className={`flex flex-wrap items-center ${rowJustify} gap-x-[0.3em] gap-y-1 w-full`} style={{ textAlign: textAlignment }}>{wordNodes}</span>
              : applyTextCase(line.text || '♪ ♪ ♪', lyricsSettings.highlighted.textCase)}
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
              <div>Font Sizes: <span className="text-zinc-300">Metric {diagData.currFontSize}px</span></div>
              <div>Line Height Multiplier: <span className="text-zinc-300">{diagData.lineSpacing}</span></div>
              <div className="pt-1 border-t border-white/10 text-zinc-400 text-[10px]">Window: {diagData.windowWidth} x {diagData.windowHeight}</div>
            </div>
          )}
        </>
      )}
      <div 
        ref={groupRef} 
        className="w-full max-w-5xl mx-auto flex flex-col justify-center items-center text-center overflow-visible" 
        style={{ 
          gap: `${effectiveGap}px`, 
          transform: scale < 1 ? `scale(${scale})` : 'none', 
          transformOrigin: 'center center', 
          width: '100%',
          height: diagData.unscaledGroupHeight > 0 ? `${diagData.unscaledGroupHeight}px` : 'auto'
        }}
      >
        {Array.from({ length: sectionCount }, (_, sectionIndex) => {
          const vertAlignment = lyricsSettings.verticalAlignment || 'center';
          const sectionAlign = vertAlignment === 'top' ? 'justify-start' : vertAlignment === 'bottom' ? 'justify-end' : 'justify-center';
          
          return (
            <div 
              key={`lyric-section-${sectionIndex}`} 
              className={`w-full flex flex-col ${sectionAlign} items-center overflow-visible flex-1 relative`} 
              style={{ minHeight: 0 }}
            >
              {Array.from({ length: 1 }, (_, slotIndex) => {
                const lineIndex = safeFocusIndex >= sectionIndex
                  ? safeFocusIndex - ((safeFocusIndex - sectionIndex) % sectionCount)
                  : -1;
                return renderLine(lineIndex >= 0 ? lyrics[lineIndex] : undefined, lineIndex, sectionIndex, 0);
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};
