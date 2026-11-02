import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LyricsAppearanceSettings } from '../utils/lyricsSettings';
import { Tv, Bug } from 'lucide-react';
import { computeWordIntervals, calculateWordProgress } from '../utils/lyricsProgress';

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
  lyricsFormat?: 'elrc' | 'lrc';
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
  lyricsFormat,
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef<number>(1);
  const [scale, setScale] = useState<number>(1);
  const [effectiveGap, setEffectiveGap] = useState<number>(12);

  const sectionCount = Math.max(1, Math.min(5, Math.round(sectionsCount || 2)));
  const safeFocusIndex = Math.max(0, Math.min(Math.max(0, lyrics.length - 1), focusIndex));
  const adjustedTime = currentTime + (lyricOffset / 1000);
  // eLRC previews the complete upcoming line 1500ms before its first word;
  // the uniform 1000ms entrance fade finishes 500ms before singing begins.
  const elrcDisplayLeadInSec = lyricsFormat === 'elrc'
    ? Math.max(0, (lyricsSettings.elrcDisplayLeadInMs ?? 1500) / 1000)
    : 0;
  const elrcEntranceFadeSec = Math.max(0.1, elrcDisplayLeadInSec - 0.5);
  const displayFocusIndex = !isPreview && lyricsFormat === 'elrc'
    ? lyrics.reduce((latestIndex, lyric, index) => {
        const firstWordStart = lyric.words?.length && typeof lyric.words[0].start === 'number'
          ? lyric.words[0].start
          : lyric.time;
        return adjustedTime >= firstWordStart - elrcDisplayLeadInSec ? index : latestIndex;
      }, -1)
    : safeFocusIndex;

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
  const baseFontSizeInit = lyricsSettings.highlighted.size || 48;
  const lineSpacingInit = lyricsSettings.highlighted.lineSpacing || 1.2;
  const singleLineHeightInit = baseFontSizeInit * lineSpacingInit;
  // Each section displays one lyric line, with room for up to 3 wrapped rows in portrait.
  const sectionHeightAllocInit = singleLineHeightInit * 3;
  const gapsInit = Math.max(0, sectionCount - 1);
  const initialProjectedHeight = (sectionCount * sectionHeightAllocInit) + (gapsInit * Math.max(4, Math.round(baseFontSizeInit * 0.2)));

  const [diagData, setDiagData] = useState<DiagnosticData>({
    containerWidth: 0, containerHeight: 0, unscaledGroupWidth: 0,
    unscaledGroupHeight: initialProjectedHeight, scale: 1, gap: Math.max(4, Math.round(baseFontSizeInit * 0.2)), currFontSize: baseFontSizeInit,
    unhighFontSize: 20, lineSpacing: lineSpacingInit, windowWidth: 0,
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

      // STABLE LAYOUT: One lyric line per section, with orientation-specific
      // capacity for wrapped rows. The section remains fixed until it rotates.
      const baseFontSize = lyricsSettings.highlighted.size || 48;
      const lineSpacing = lyricsSettings.highlighted.lineSpacing || 1.2;
      const singleLineHeight = baseFontSize * lineSpacing;
      const rowsPerLyric = stageWidth >= stageHeight ? 2 : 3;
      const sectionHeightAllocation = singleLineHeight * rowsPerLyric;
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

  // Recalculate geometry only when stage/layout inputs change, never as playback advances.
  useLayoutEffect(() => {
    recalculateLayout();
  }, [lyricsSettings.highlighted.size, lyricsSettings.highlighted.lineSpacing, sectionCount, isPreview, recalculateLayout]);

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
    const lowOpacity = lyricsSettings.unhighlighted.opacity ?? 0.8;
    const displayStyle = lyricsSettings.highlighted;

    // TRANSITION TIMING:
    // For eLRC lines with word timestamps, use the first word's original timestamp as the authoritative transition target.
    // Fall back to line.time when word timestamps are unavailable.
    // eLRC Fade Duration: controls how long incoming and outgoing line wipes take.
    // eLRC Fade Overlap: controls how early the incoming line starts relative to the outgoing line finishing.
    const isElrcMode = lyricsFormat ? lyricsFormat === 'elrc' : Boolean(line.words && line.words.length > 0);
    const hasWords = Boolean(line.words && line.words.length > 0 && typeof line.words[0].start === 'number');
    const transitionTargetTime = (isElrcMode && hasWords) ? line.words![0].start : line.time;

    const fadeDurationSec = isElrcMode ? (lyricsSettings.elrcFadeDurationMs ?? 1500) / 1000 : 1.5;
    const fadeOverlapSec = isElrcMode ? Math.min(fadeDurationSec, (lyricsSettings.elrcFadeOverlapMs ?? 300) / 1000) : 0;
    // Fade the whole eLRC line in uniformly, completing 500ms before its
    // first word. Word-by-word highlighting remains timestamp-driven below.
    const inDelay = 0;
    const outDelay = 0;
    const transitionDuration = isElrcMode ? elrcEntranceFadeSec : fadeDurationSec;

    // CONTINUOUS LEFT-TO-RIGHT WORD HIGHLIGHTING:
    const wordIntervals = line.words?.length ? computeWordIntervals(line.words) : [];

    // Singing timing boundaries: the line starts at the first word's start, and finishes at the final word's end.
    const firstInterval = wordIntervals[0];
    const lastInterval = wordIntervals[wordIntervals.length - 1];
    const lineSingingStartTime = firstInterval ? firstInterval.start : line.time;
    const lineSingingEndTime = lastInterval ? lastInterval.end : line.time;

    // For eLRC lines, isLinePast is true only once playback time has actually passed the final word's singing end.
    // Display lead time in safeFocusIndex must not prematurely force the final word to 100% while still being sung.
    const nextLrcLineTime = lyrics[lineIndex + 1]?.time ?? Infinity;
    const isLinePast = wordIntervals.length > 0
      ? adjustedTime >= lineSingingEndTime
      : adjustedTime >= nextLrcLineTime;

    const isLineActive = wordIntervals.length > 0
      ? (adjustedTime >= lineSingingStartTime && adjustedTime < lineSingingEndTime)
      : (adjustedTime >= line.time && adjustedTime < nextLrcLineTime);

    const wordProgressList = line.words?.length
      ? calculateWordProgress(line.words, wordIntervals, adjustedTime, isLineActive, isLinePast, isPreview)
      : [];

    // Average fill of this line becomes the outgoing line's fade target when
    // this line replaces it. AnimatePresence supplies the latest value while
    // the previous keyed line is exiting.
    const previousSectionLine = !isElrcMode && lineIndex >= sectionCount
      ? lyrics[lineIndex - sectionCount]
      : undefined;
    const lrcFadeStartTime = (previousSectionLine?.time ?? line.time) + 0.75;
    const lrcFadeDuration = Math.max(0.001, line.time - lrcFadeStartTime);
    const incomingFadeProgress = isElrcMode && wordProgressList.length
      ? wordProgressList.reduce((sum, progress) => sum + progress, 0) / (wordProgressList.length * 100)
      : !isElrcMode
        // Fade the outgoing LRC line 750ms after its highlight begins;
        // reach zero when this incoming line starts highlighting.
        ? Math.max(0, Math.min(1, (adjustedTime - lrcFadeStartTime) / lrcFadeDuration))
        : 0;
    const nextSectionRemainingSec = Math.max(0, lineSingingEndTime - adjustedTime);

    const activeTextCase = lyricsSettings.highlighted.textCase || lyricsSettings.unhighlighted.textCase;

    const wordNodes = line.words?.length ? line.words.map((word, wordIndex) => {
      const fillPercent = wordProgressList[wordIndex] ?? 0;
      const isFullyHighlighted = fillPercent >= 100;
      const hasStarted = fillPercent > 0;
      const transformedText = applyTextCase(word.text, activeTextCase);

      return (
        <span 
          key={`word-${wordIndex}-${word.text}`} 
          className="relative inline-block select-none whitespace-nowrap"
        >
          {/* Base unhighlighted text: defines stable dimensions and unhighlighted appearance */}
          <span 
            className="inline-block"
            style={{ color: lowColor, opacity: lowOpacity, textShadow: 'none' }}
          >
            {transformedText}
          </span>

          {/* Progressive karaoke highlight overlay: clipped left-to-right as sung */}
          {hasStarted && (
            <span
              aria-hidden="true"
              className="absolute inset-0 pointer-events-none select-none inline-block overflow-hidden whitespace-nowrap"
              style={{
                color: highColor,
                opacity: highOpacity,
                textShadow: `0 0 25px ${highColor}80`,
                clipPath: isFullyHighlighted ? 'none' : `inset(0 ${(100 - fillPercent).toFixed(2)}% 0 0)`,
                WebkitClipPath: isFullyHighlighted ? 'none' : `inset(0 ${(100 - fillPercent).toFixed(2)}% 0 0)`,
              }}
            >
              {transformedText}
            </span>
          )}
        </span>
      );
    }) : null;

    const vertAlignment = lyricsSettings.verticalAlignment || 'center';
    const rowAlign = vertAlignment === 'top' ? 'items-start' : vertAlignment === 'bottom' ? 'items-end' : 'items-center';

    const isLineActiveOrPast = isLineActive || isLinePast;
    const standardLrcColor = isLineActiveOrPast ? highColor : lowColor;
    const lrcLineFadeStartTime = line.time + 0.75;
    const lrcLineFadeProgress = Number.isFinite(nextLrcLineTime) && nextLrcLineTime > lrcLineFadeStartTime
      ? Math.max(0, Math.min(1, (adjustedTime - lrcLineFadeStartTime) / (nextLrcLineTime - lrcLineFadeStartTime)))
      : 0;
    const standardLrcOpacity = !isElrcMode && isLineActiveOrPast
      ? highOpacity * (1 - lrcLineFadeProgress)
      : isLineActiveOrPast ? highOpacity : lowOpacity;
    const standardLrcGlow = isLineActiveOrPast ? `0 0 25px ${highColor}80` : 'none';
    // LRC retains its existing previous-line dimming. eLRC opacity is
    // driven by the incoming line's word progress in the exit variant below.

    return (
      <div className={`lyric-line-row relative flex ${rowAlign} ${rowJustify} w-full h-full min-h-0 overflow-hidden py-1 px-2`} key={`row-${sectionIndex}-${slotIndex}`}>
        <AnimatePresence mode="popLayout" custom={incomingFadeProgress}>
          <motion.p
            key={`section-${sectionIndex}-slot-${slotIndex}-${lineIndex}-${line.time}-${line.text}`}
            // Configured Wipe:
            // The incoming line wipes in with inDelay and duration.
            // The outgoing line wipes out with outDelay and duration.
            initial={{ clipPath: 'none', opacity: 0 }}
            animate={{ 
              // Both formats reveal the full line; eLRC uses a uniform opacity fade.
              clipPath: 'none',
              opacity: highOpacity,
              transition: {
                duration: transitionDuration,
                ease: 'linear',
                delay: inDelay
              }
            }}
            variants={{
              exit: (latestIncomingProgress: number) => ({
                clipPath: isElrcMode ? 'inset(0 0 0 100%)' : 'none',
                // eLRC keeps its word-synchronised wipe/fade. LRC fades
                // the complete outgoing line uniformly after the next line highlights.
                opacity: isElrcMode ? 0 : highOpacity * (1 - Math.max(0, Math.min(1, latestIncomingProgress))),
                transition: {
                  // Fade the outgoing eLRC line all the way to zero over the
                  // incoming line's remaining word-highlighting duration.
                  ...(isElrcMode ? {
                    opacity: {
                      duration: Math.max(0.001, nextSectionRemainingSec),
                      ease: 'linear',
                      delay: 0
                    },
                    clipPath: {
                      duration: Math.max(transitionDuration, nextSectionRemainingSec),
                      ease: 'linear',
                      delay: inDelay
                    }
                  } : {
                    opacity: { duration: 0 }
                  })
                }
              })
            }}
            exit="exit"
            style={{
              fontFamily: getFontFamilyStyle(displayStyle.font, lyricsSettings.customFontName),
              fontSize: `${displayStyle.size}px`,
              fontWeight: displayStyle.weight,
              color: wordNodes ? highColor : standardLrcColor,
              letterSpacing: `${displayStyle.letterSpacing}px`,
              lineHeight: displayStyle.lineSpacing,
              textAlign: textAlignment,
            }}
            className={`w-full whitespace-normal break-words leading-tight ${getAlignmentClass(textAlignment)}`}
          >
            {wordNodes
              ? <span className={`flex flex-wrap items-center ${rowJustify} gap-x-[0.3em] gap-y-1 w-full`} style={{ textAlign: textAlignment }}>{wordNodes}</span>
              : <span style={{ opacity: standardLrcOpacity, textShadow: standardLrcGlow }}>{applyTextCase(line.text || '♪ ♪ ♪', lyricsSettings.highlighted.textCase)}</span>}
          </motion.p>
        </AnimatePresence>
      </div>
    );
  };

  // The section group is always centred as one fixed block. Vertical alignment is
  // applied to lyric text inside each fixed slot, not to the group itself.
  const stageAlignmentClass = 'justify-center';

  return (
    <div ref={stageRef} className={`w-full flex-1 h-full min-h-0 flex flex-col ${stageAlignmentClass} items-center overflow-hidden relative select-none`}>
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
          // Do not reveal the first line in any section until its own lyric
          // timestamp. For eLRC, use the first word's timestamp when available.
          // Keep settings previews visible regardless of playback time.
          const firstSectionLine = lyrics[sectionIndex];
          const firstSectionLineTime = lyricsFormat === 'elrc' && firstSectionLine?.words?.length
            ? firstSectionLine.words[0].start
            : firstSectionLine?.time ?? Infinity;
          const firstLineIsReady = isPreview || adjustedTime >= firstSectionLineTime - elrcDisplayLeadInSec;
          const scheduledLineIndex = displayFocusIndex >= sectionIndex
            ? displayFocusIndex - ((displayFocusIndex - sectionIndex) % sectionCount)
            : sectionIndex;
          let currLineIndex = firstLineIsReady ? sectionIndex : -1;

          // Advance this section one line at a time, and only after the line
          // currently occupying it has completed its word highlighting.
          // This prevents a later scheduled line from skipping an unfinished one.
          for (
            let nextLineIndex = sectionIndex + sectionCount;
            nextLineIndex <= scheduledLineIndex;
            nextLineIndex += sectionCount
          ) {
            const previousLineIndex = nextLineIndex - sectionCount;
            const previousLine = lyrics[previousLineIndex];
            const previousIntervals = previousLine?.words?.length
              ? computeWordIntervals(previousLine.words)
              : [];
            const previousLastInterval = previousIntervals[previousIntervals.length - 1];
            const previousLineEnd = previousLastInterval?.end
              ?? lyrics[previousLineIndex + 1]?.time
              ?? Infinity;
            // A section never previews its next LRC line before its timestamp.
            const nextLine = lyrics[nextLineIndex];
            const nextLineStart = nextLine?.words?.length && typeof nextLine.words[0].start === 'number'
              ? nextLine.words[0].start
              : nextLine?.time ?? Infinity;
            const sectionAdvanceTime = Math.max(previousLineEnd, nextLineStart - elrcDisplayLeadInSec);

            if (adjustedTime >= sectionAdvanceTime) {
              currLineIndex = nextLineIndex;
            } else {
              break;
            }
          }

          // Each section holds its line through completion, then replaces it
          // on that section's next turn. This keeps all populated sections visible.
          const currentLine = currLineIndex >= 0 ? lyrics[currLineIndex] : undefined;

          return (
            <div
              key={`lyric-section-${sectionIndex}`}
              data-lyrics-section={sectionIndex}
              className="lyric-section-slot w-full flex flex-col items-center justify-center overflow-hidden flex-1 relative min-h-0"
              data-lyrics-slot="current"
            >
              {currentLine
                ? renderLine(currentLine, currLineIndex, sectionIndex, 0)
                : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
