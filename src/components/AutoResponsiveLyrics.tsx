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
  prev2Line?: LyricLine | null;
  prev1Line?: LyricLine | null;
  currLine?: LyricLine | null;
  next1Line?: LyricLine | null;
  next2Line?: LyricLine | null;
  visibleLinesCount?: number;
  applyTextCase: (text: string, textCase?: string) => string;
  getFontFamilyStyle: (fontId?: string, customFontName?: string | null) => string;
  getAlignmentClass: (alignment?: string) => string;
  // Optional preview mode flag for Settings screen
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
  prev2Line = null,
  prev1Line = null,
  currLine = null,
  next1Line = null,
  next2Line = null,
  visibleLinesCount = 3,
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
  const gapRef = useRef<number>(12);

  const [scale, setScale] = useState<number>(1);
  const [effectiveGap, setEffectiveGap] = useState<number>(12);

  const isDebugEnabled = Boolean(
    showDebugHUD ||
    (typeof window !== 'undefined' && (() => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.has('debug') || urlParams.has('tvdebug');
      } catch {
        return false;
      }
    })())
  );

  const [showDebug, setShowDebug] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.has('debug') || urlParams.has('tvdebug');
      } catch {
        return false;
      }
    }
    return false;
  });

  const [diagData, setDiagData] = useState<DiagnosticData>({
    containerWidth: 0,
    containerHeight: 0,
    unscaledGroupWidth: 0,
    unscaledGroupHeight: 0,
    scale: 1,
    gap: 12,
    currFontSize: 48,
    unhighFontSize: 20,
    lineSpacing: 1.2,
    windowWidth: 0,
    windowHeight: 0,
    dpr: 1,
  });

  // Auto-Optimization Measurement Algorithm using actual DOM dimensions
  const recalculateLayout = useCallback(() => {
    if (!stageRef.current || !groupRef.current) return;

    // Execute after browser frame layout pass
    requestAnimationFrame(() => {
      if (!stageRef.current || !groupRef.current) return;

      const stageEl = stageRef.current;
      const groupEl = groupRef.current;

      const stageRect = stageEl.getBoundingClientRect();
      const stageWidth = stageRect.width;
      const stageHeight = stageRect.height;

      if (stageWidth <= 0 || stageHeight <= 0) return;

      // Safe area padding (respecting TV safe margins, animation transitions y:-6/y:6, and text-shadow glow)
      const animAndGlowBuffer = isPreview ? 6 : 12;
      const paddingY = isPreview
        ? 8
        : Math.max(12, Math.round(stageHeight * 0.04));
      const paddingX = isPreview
        ? 10
        : Math.max(16, Math.round(stageWidth * 0.04));

      const safeHeight = Math.max(50, stageHeight - (paddingY * 2 + animAndGlowBuffer * 2));
      const safeWidth = Math.max(100, stageWidth - paddingX * 2);

      // Currently applied CSS scale factor (prevents transform measurement feedback loops)
      const currentAppliedScale = scaleRef.current > 0 ? scaleRef.current : 1;

      // Query line row nodes inside the lyric group
      const rowNodes = Array.from(
        groupEl.querySelectorAll('.lyric-line-row')
      ) as HTMLElement[];

      let sumLinesUnscaledHeight = 0;
      let maxLineUnscaledWidth = 0;

      if (rowNodes.length > 0) {
        rowNodes.forEach((node) => {
          const rect = node.getBoundingClientRect();
          // Use layout offsetHeight and rect height / scale to get true unscaled dimensions
          const unscaledH = Math.max(node.offsetHeight, rect.height / currentAppliedScale);
          const unscaledW = Math.max(node.offsetWidth, rect.width / currentAppliedScale);
          sumLinesUnscaledHeight += unscaledH;
          if (unscaledW > maxLineUnscaledWidth) {
            maxLineUnscaledWidth = unscaledW;
          }
        });
      } else {
        // Fallback if rowNodes query selector hasn't populated yet
        const groupRect = groupEl.getBoundingClientRect();
        sumLinesUnscaledHeight = Math.max(groupEl.offsetHeight, groupRect.height / currentAppliedScale);
        maxLineUnscaledWidth = Math.max(groupEl.offsetWidth, groupRect.width / currentAppliedScale);
      }

      const lineCount = rowNodes.length || (visibleLinesCount || 3);
      const numGaps = Math.max(0, lineCount - 1);

      const baseGap = Math.max(
        4,
        Math.round((lyricsSettings.unhighlighted.size || 20) * 0.3)
      );

      let computedGap = baseGap;
      let totalProjectedHeight = sumLinesUnscaledHeight + numGaps * baseGap;

      // Step 1: Reduce dynamic vertical line gap if projected height exceeds safe height
      if (totalProjectedHeight > safeHeight && computedGap > 4 && numGaps > 0) {
        const heightOver = totalProjectedHeight - safeHeight;
        const gapReduction = Math.min(
          computedGap - 4,
          Math.ceil(heightOver / numGaps)
        );
        computedGap = Math.max(4, computedGap - gapReduction);
        totalProjectedHeight = sumLinesUnscaledHeight + numGaps * computedGap;
      }

      // Step 2: Calculate proportional scale factor if height or width exceeds safe bounds
      let computedScale = 1;
      const scaleY = safeHeight / (totalProjectedHeight || safeHeight);
      const scaleX = safeWidth / (maxLineUnscaledWidth || safeWidth);

      if (scaleY < 1 || scaleX < 1) {
        computedScale = Math.min(scaleY, scaleX);
        // Floor to 2 decimal places to prevent sub-pixel animation jitter
        computedScale = Math.max(0.2, Math.floor(computedScale * 100) / 100);
      }

      // Update refs to prevent feedback loops
      scaleRef.current = computedScale;
      gapRef.current = computedGap;

      setScale(computedScale);
      setEffectiveGap(computedGap);

      // Record diagnostic data for TV testing
      setDiagData({
        containerWidth: stageWidth,
        containerHeight: stageHeight,
        unscaledGroupWidth: maxLineUnscaledWidth,
        unscaledGroupHeight: totalProjectedHeight,
        scale: computedScale,
        gap: computedGap,
        currFontSize: isHighlighted
          ? lyricsSettings.highlighted.size
          : lyricsSettings.unhighlighted.size,
        unhighFontSize: lyricsSettings.unhighlighted.size,
        lineSpacing: isHighlighted
          ? lyricsSettings.highlighted.lineSpacing
          : lyricsSettings.unhighlighted.lineSpacing,
        windowWidth: typeof window !== 'undefined' ? window.innerWidth : 0,
        windowHeight: typeof window !== 'undefined' ? window.innerHeight : 0,
        dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      });
    });
  }, [
    lyricsSettings,
    visibleLinesCount,
    isHighlighted,
    isPreview,
  ]);

  useLayoutEffect(() => {
    recalculateLayout();
  }, [
    lyrics,
    focusIndex,
    lyricsSettings,
    visibleLinesCount,
    currLine?.text,
    prev1Line?.text,
    next1Line?.text,
    prev2Line?.text,
    next2Line?.text,
    isHighlighted,
    isPreview,
    recalculateLayout,
  ]);

  useEffect(() => {
    // 1. Re-calculate when web fonts finish loading
    const handleFontLoad = () => {
      recalculateLayout();
    };

    if (typeof document !== 'undefined' && document.fonts) {
      if (document.fonts.ready) {
        document.fonts.ready.then(handleFontLoad).catch(() => {});
      }
      try {
        document.fonts.addEventListener('loadingdone', handleFontLoad);
      } catch (e) {
        // Fallback for older browsers
      }
    }

    const stageEl = stageRef.current;
    const groupEl = groupRef.current;

    const handleResize = () => {
      recalculateLayout();
    };

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      try {
        observer = new ResizeObserver(handleResize);
        if (stageEl) observer.observe(stageEl);
        if (groupEl) observer.observe(groupEl);
      } catch (e) {
        console.warn('[AutoResponsiveLyrics] ResizeObserver failed:', e);
      }
    }

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    document.addEventListener('fullscreenchange', handleResize);
    document.addEventListener('webkitfullscreenchange', handleResize);

    // Initial trigger after mount
    handleResize();
    const rafId = requestAnimationFrame(handleResize);

    return () => {
      if (observer) {
        try {
          observer.disconnect();
        } catch (e) {}
      }
      if (typeof document !== 'undefined' && document.fonts) {
        try {
          document.fonts.removeEventListener('loadingdone', handleFontLoad);
        } catch (e) {}
      }
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      document.removeEventListener('fullscreenchange', handleResize);
      document.removeEventListener('webkitfullscreenchange', handleResize);
      cancelAnimationFrame(rafId);
    };
  }, [recalculateLayout]);

  const alignment = 'center';
  const flexJustifyClass = 'justify-center text-center';

  return (
    <div
      ref={stageRef}
      className="w-full flex-1 h-full min-h-0 flex flex-col justify-center items-center overflow-hidden relative select-none"
    >
      {/* TV Diagnostic Overlay Toggle Button (Dev/Troubleshooting Mode) */}
      {isDebugEnabled && (
        <>
          <button
            type="button"
            onClick={() => setShowDebug((prev) => !prev)}
            className="absolute bottom-2 right-2 z-50 text-[10px] font-mono bg-black/70 hover:bg-black/90 text-zinc-300 border border-white/20 px-2 py-1 rounded-md opacity-60 hover:opacity-100 transition-opacity flex items-center gap-1 cursor-pointer"
            title="Toggle TV Diagnostics HUD"
          >
            <Bug className="w-3 h-3 text-[#FF4FA3]" />
            <span>TV DEBUG</span>
          </button>

          {/* TV Diagnostic Readout HUD */}
          {showDebug && (
            <div className="absolute top-2 right-2 z-50 bg-black/90 border border-[#FF4FA3]/40 text-emerald-400 font-mono text-[11px] p-3 rounded-xl shadow-2xl max-w-xs space-y-1 pointer-events-auto leading-tight text-left backdrop-blur-md">
              <div className="text-white font-bold border-b border-white/20 pb-1 mb-1.5 flex justify-between items-center">
                <span className="flex items-center gap-1 text-[#FF4FA3]">
                  <Tv className="w-3.5 h-3.5" />
                  TV Diagnostics
                </span>
                <span className="text-zinc-400 text-[9px]">{diagData.dpr}x DPR</span>
              </div>
              <div>
                Container:{' '}
                <span className="text-white font-bold">
                  {Math.round(diagData.containerWidth)} x {Math.round(diagData.containerHeight)} px
                </span>
              </div>
              <div>
                Unscaled Group:{' '}
                <span className="text-white font-bold">
                  {Math.round(diagData.unscaledGroupWidth)} x {Math.round(diagData.unscaledGroupHeight)} px
                </span>
              </div>
              <div className="pt-0.5 border-t border-white/10 mt-1">
                Calculated Scale:{' '}
                <span className="text-amber-300 font-bold">{diagData.scale}</span>
              </div>
              <div>
                Calculated Gap:{' '}
                <span className="text-amber-300 font-bold">{diagData.gap}px</span>
              </div>
              <div>
                Font Sizes:{' '}
                <span className="text-zinc-300">
                  Curr {diagData.currFontSize}px / Unhigh {diagData.unhighFontSize}px
                </span>
              </div>
              <div>
                Line Height Multiplier:{' '}
                <span className="text-zinc-300">{diagData.lineSpacing}</span>
              </div>
              <div className="pt-1 border-t border-white/10 text-zinc-400 text-[10px]">
                Window: {diagData.windowWidth} x {diagData.windowHeight}
              </div>
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
        }}
      >
        {/* Line -2 (if 5 lines mode) */}
        {visibleLinesCount === 5 && (
          <div className="lyric-line-row flex items-center justify-center shrink-0 w-full overflow-visible py-0.5 text-center">
            <AnimatePresence mode="wait">
              {prev2Line ? (
                <motion.p
                  key={`prev2-${prev2Line.time}-${prev2Line.text}`}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{
                    opacity: (lyricsSettings.unhighlighted.opacity ?? 0.45) * 0.6,
                    y: 0,
                  }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: animDuration, ease: 'easeOut' }}
                  style={{
                    fontFamily: getFontFamilyStyle(lyricsSettings.unhighlighted.font, lyricsSettings.customFontName),
                    fontSize: `${Math.max(12, lyricsSettings.unhighlighted.size - 2)}px`,
                    fontWeight: lyricsSettings.unhighlighted.weight,
                    color: lyricsSettings.unhighlighted.color || '#d4d4d8',
                    letterSpacing: `${lyricsSettings.unhighlighted.letterSpacing}px`,
                    lineHeight: lyricsSettings.unhighlighted.lineSpacing,
                    textAlign: 'center',
                  }}
                  className="w-full whitespace-normal break-words leading-tight text-center"
                >
                  {applyTextCase(prev2Line.text, lyricsSettings.unhighlighted.textCase)}
                </motion.p>
              ) : (
                <div className="h-4 w-full" />
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Line -1: Previous Lyric */}
        {visibleLinesCount >= 3 && (
          <div className="lyric-line-row flex items-center justify-center shrink-0 w-full overflow-visible py-1 text-center">
            <AnimatePresence mode="wait">
              {prev1Line ? (
                <motion.p
                  key={`prev1-${prev1Line.time}-${prev1Line.text}`}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{
                    opacity: lyricsSettings.unhighlighted.opacity ?? 0.45,
                    y: 0,
                  }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: animDuration, ease: 'easeOut' }}
                  style={{
                    fontFamily: getFontFamilyStyle(lyricsSettings.unhighlighted.font, lyricsSettings.customFontName),
                    fontSize: `${lyricsSettings.unhighlighted.size}px`,
                    fontWeight: lyricsSettings.unhighlighted.weight,
                    color: lyricsSettings.unhighlighted.color || '#d4d4d8',
                    letterSpacing: `${lyricsSettings.unhighlighted.letterSpacing}px`,
                    lineHeight: lyricsSettings.unhighlighted.lineSpacing,
                    textAlign: 'center',
                  }}
                  className="w-full whitespace-normal break-words leading-tight text-center"
                >
                  {applyTextCase(prev1Line.text, lyricsSettings.unhighlighted.textCase)}
                </motion.p>
              ) : (
                <div className="h-5 w-full" />
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Line 0: Current Lyric (Visually dominant and center-aligned) */}
        <div className="lyric-line-row flex items-center justify-center shrink-0 w-full overflow-visible py-1.5 px-2 text-center">
          <AnimatePresence mode="wait">
            {currLine ? (
              <motion.p
                key={`curr-${currLine.time}-${currLine.text}-${isHighlighted}`}
                initial={{ opacity: 0, y: 0 }}
                animate={{
                  opacity: isHighlighted
                    ? lyricsSettings.highlighted.opacity ?? 1.0
                    : lyricsSettings.unhighlighted.opacity ?? 0.45,
                  y: 0,
                }}
                exit={{ opacity: 0, y: 0 }}
                transition={{ duration: animDuration, ease: 'easeOut' }}
                style={{
                  fontFamily: isHighlighted
                    ? getFontFamilyStyle(lyricsSettings.highlighted.font, lyricsSettings.customFontName)
                    : getFontFamilyStyle(lyricsSettings.unhighlighted.font, lyricsSettings.customFontName),
                  fontSize: `${
                    isHighlighted
                      ? lyricsSettings.highlighted.size
                      : lyricsSettings.unhighlighted.size
                  }px`,
                  fontWeight: isHighlighted
                    ? lyricsSettings.highlighted.weight
                    : lyricsSettings.unhighlighted.weight,
                  color: isHighlighted
                    ? lyricsSettings.highlighted.color || '#FF4FA3'
                    : lyricsSettings.unhighlighted.color || '#d4d4d8',
                  letterSpacing: `${
                    isHighlighted
                      ? lyricsSettings.highlighted.letterSpacing
                      : lyricsSettings.unhighlighted.letterSpacing
                  }px`,
                  lineHeight: isHighlighted
                    ? lyricsSettings.highlighted.lineSpacing
                    : lyricsSettings.unhighlighted.lineSpacing,
                  textAlign: 'center',
                  textShadow: isHighlighted
                    ? `0 0 35px ${
                        lyricsSettings.highlighted.color || '#FF4FA3'
                      }75`
                    : 'none',
                }}
                className="w-full whitespace-normal break-words leading-tight text-center"
              >
                {currLine.words && currLine.words.length > 0 ? (
                  <span className="flex flex-wrap items-center justify-center gap-x-[0.3em] gap-y-1 w-full text-center">
                    {currLine.words.map((word, wIdx) => {
                      const adjustedTime = currentTime + (lyricOffset / 1000);
                      const wordStartTime = word.start;
                      const nextWordStartTime = (wIdx + 1 < currLine.words!.length)
                        ? currLine.words![wIdx + 1].start
                        : (next1Line?.time ?? (word.start + 3));
                      const wordDuration = Math.max(0.08, nextWordStartTime - wordStartTime);

                      const rawElrc = lyricsSettings.elrcTransition || lyricsSettings.elrcHighlightMode || 'smooth_sweep';
                      const elrcMode: 'smooth_sweep' | 'karaoke' | 'current_only' | 'instant' =
                        rawElrc === 'progressive_sweeping' ? 'smooth_sweep' : (rawElrc as any);

                      const isWordPast = isHighlighted && (isPreview ? wIdx === 0 : (adjustedTime >= nextWordStartTime));
                      const isWordCurrent = isHighlighted && (isPreview ? wIdx === 1 : (adjustedTime >= wordStartTime && adjustedTime < nextWordStartTime));

                      const highColor = lyricsSettings.highlighted.color || '#FF4FA3';
                      const unhighColor = lyricsSettings.unhighlighted.color || '#d4d4d8';
                      const highOpacity = lyricsSettings.highlighted.opacity ?? 1.0;
                      const unhighOpacity = lyricsSettings.unhighlighted.opacity ?? 0.45;

                      // 1. Smooth Sweep Mode (Continuous left-to-right gradient sweep driven by ELRC timestamps)
                      if (elrcMode === 'smooth_sweep') {
                        let wordStyle: React.CSSProperties = {
                          scale: 1,
                        };

                        if (isWordPast) {
                          wordStyle = {
                            scale: 1,
                            color: highColor,
                            opacity: highOpacity,
                            textShadow: isHighlighted ? `0 0 25px ${highColor}80` : 'none',
                          };
                        } else if (isWordCurrent) {
                          const progress = isPreview
                            ? 60
                            : Math.min(100, Math.max(0, ((adjustedTime - wordStartTime) / wordDuration) * 100));

                          wordStyle = {
                            scale: 1,
                            backgroundImage: `linear-gradient(to right, ${highColor} 0%, ${highColor} ${progress}%, ${unhighColor} ${progress}%, ${unhighColor} 100%)`,
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            opacity: highOpacity,
                            filter: isHighlighted ? `drop-shadow(0 0 8px ${highColor}70)` : 'none',
                          };
                        } else {
                          wordStyle = {
                            scale: 1,
                            color: unhighColor,
                            opacity: unhighOpacity,
                            textShadow: 'none',
                          };
                        }

                        return (
                          <span
                            key={`word-${wIdx}-${word.text}`}
                            className="inline-block relative text-center select-none"
                            style={wordStyle}
                          >
                            {applyTextCase(
                              word.text,
                              isWordPast || isWordCurrent
                                ? lyricsSettings.highlighted.textCase
                                : lyricsSettings.unhighlighted.textCase
                            )}
                          </span>
                        );
                      }

                      // 2. Instant Mode (Immediate full word highlight when timestamp is reached, zero transition)
                      if (elrcMode === 'instant') {
                        const isWordHighlighted = isHighlighted && (
                          isPreview ? wIdx <= 1 : (adjustedTime >= wordStartTime)
                        );

                        return (
                          <span
                            key={`word-${wIdx}-${word.text}`}
                            className="inline-block text-center select-none"
                            style={{
                              scale: 1,
                              color: isWordHighlighted ? highColor : unhighColor,
                              opacity: isWordHighlighted ? highOpacity : unhighOpacity,
                              textShadow: isWordCurrent ? `0 0 25px ${highColor}80` : 'none',
                            }}
                          >
                            {applyTextCase(
                              word.text,
                              isWordHighlighted
                                ? lyricsSettings.highlighted.textCase
                                : lyricsSettings.unhighlighted.textCase
                            )}
                          </span>
                        );
                      }

                      // 3. Current Word Only or Standard Karaoke modes
                      const isWordHighlighted = isHighlighted && (
                        isPreview
                          ? (elrcMode === 'current_only' ? wIdx === 1 : wIdx <= 1)
                          : (elrcMode === 'current_only' ? isWordCurrent : (adjustedTime >= wordStartTime))
                      );

                      const wordColor = isWordHighlighted ? highColor : unhighColor;
                      const wordOpacity = isWordHighlighted ? highOpacity : unhighOpacity;
                      const wordAnimMode = lyricsSettings.wordHighlightAnimation || 'smooth';

                      let activeGlow = 'none';
                      let wordTransition: any = { duration: 0.15, ease: 'easeOut' };
                      let wordClassName = 'inline-block transition-colors text-center select-none';

                      if (wordAnimMode === 'smooth') {
                        activeGlow = isWordCurrent
                          ? `0 0 25px ${highColor}80`
                          : 'none';
                        wordTransition = { duration: 0.15, ease: 'easeOut' };
                        wordClassName = 'inline-block transition-colors text-center select-none';
                      } else if (wordAnimMode === 'instant') {
                        activeGlow = isWordCurrent
                          ? `0 0 25px ${highColor}80`
                          : 'none';
                        wordTransition = { duration: 0 };
                        wordClassName = 'inline-block text-center select-none';
                      } else if (wordAnimMode === 'fade') {
                        activeGlow = isWordCurrent
                          ? `0 0 20px ${highColor}70`
                          : 'none';
                        wordTransition = { duration: 0.25, ease: 'easeInOut' };
                        wordClassName = 'inline-block transition-colors text-center select-none';
                      } else if (wordAnimMode === 'off') {
                        activeGlow = 'none';
                        wordTransition = { duration: 0 };
                        wordClassName = 'inline-block text-center select-none';
                      }

                      return (
                        <motion.span
                          key={`word-${wIdx}-${word.text}`}
                          animate={{
                            scale: 1, // Strictly 1.0 - scale effect removed
                            color: wordColor,
                            opacity: wordOpacity,
                          }}
                          transition={wordTransition}
                          className={wordClassName}
                          style={{
                            textShadow: activeGlow,
                            scale: 1,
                          }}
                        >
                          {applyTextCase(
                            word.text,
                            isWordHighlighted
                              ? lyricsSettings.highlighted.textCase
                              : lyricsSettings.unhighlighted.textCase
                          )}
                        </motion.span>
                      );
                    })}
                  </span>
                ) : (
                  applyTextCase(
                    currLine.text || '♪ ♪ ♪',
                    isHighlighted
                      ? lyricsSettings.highlighted.textCase
                      : lyricsSettings.unhighlighted.textCase
                  )
                )}
              </motion.p>
            ) : (
              <p className="text-zinc-600 text-xl md:text-3xl font-bold w-full text-center">
                ♪ ♪ ♪
              </p>
            )}
          </AnimatePresence>
        </div>

        {/* Line +1: Next Lyric */}
        {visibleLinesCount >= 3 && (
          <div className="lyric-line-row flex items-center justify-center shrink-0 w-full overflow-visible py-1 text-center">
            <AnimatePresence mode="wait">
              {next1Line ? (
                <motion.p
                  key={`next1-${next1Line.time}-${next1Line.text}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{
                    opacity: lyricsSettings.unhighlighted.opacity ?? 0.45,
                    y: 0,
                  }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: animDuration, ease: 'easeOut' }}
                  style={{
                    fontFamily: getFontFamilyStyle(lyricsSettings.unhighlighted.font, lyricsSettings.customFontName),
                    fontSize: `${lyricsSettings.unhighlighted.size}px`,
                    fontWeight: lyricsSettings.unhighlighted.weight,
                    color: lyricsSettings.unhighlighted.color || '#d4d4d8',
                    letterSpacing: `${lyricsSettings.unhighlighted.letterSpacing}px`,
                    lineHeight: lyricsSettings.unhighlighted.lineSpacing,
                    textAlign: 'center',
                  }}
                  className="w-full whitespace-normal break-words leading-tight text-center"
                >
                  {applyTextCase(next1Line.text, lyricsSettings.unhighlighted.textCase)}
                </motion.p>
              ) : (
                <div className="h-5 w-full" />
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Line +2 (if 5 lines mode) */}
        {visibleLinesCount === 5 && (
          <div className="lyric-line-row flex items-center justify-center shrink-0 w-full overflow-visible py-0.5 text-center">
            <AnimatePresence mode="wait">
              {next2Line ? (
                <motion.p
                  key={`next2-${next2Line.time}-${next2Line.text}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{
                    opacity: (lyricsSettings.unhighlighted.opacity ?? 0.45) * 0.6,
                    y: 0,
                  }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: animDuration, ease: 'easeOut' }}
                  style={{
                    fontFamily: getFontFamilyStyle(lyricsSettings.unhighlighted.font, lyricsSettings.customFontName),
                    fontSize: `${Math.max(12, lyricsSettings.unhighlighted.size - 2)}px`,
                    fontWeight: lyricsSettings.unhighlighted.weight,
                    color: lyricsSettings.unhighlighted.color || '#d4d4d8',
                    letterSpacing: `${lyricsSettings.unhighlighted.letterSpacing}px`,
                    lineHeight: lyricsSettings.unhighlighted.lineSpacing,
                    textAlign: 'center',
                  }}
                  className="w-full whitespace-normal break-words leading-tight text-center"
                >
                  {applyTextCase(next2Line.text, lyricsSettings.unhighlighted.textCase)}
                </motion.p>
              ) : (
                <div className="h-4 w-full" />
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
};
