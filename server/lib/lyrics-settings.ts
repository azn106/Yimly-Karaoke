export interface LyricStyleSettings {
  font: string;
  size: number;
  weight: string;
  letterSpacing: number;
  lineSpacing: number;
  textCase: 'original' | 'lowercase' | 'uppercase' | 'titlecase';
  opacity?: number;
  color?: string;
}

export type ElrcTransition = 'smooth_sweep' | 'karaoke' | 'current_only' | 'instant';

export interface LyricsAppearanceSettings {
  highlighted: LyricStyleSettings;
  unhighlighted: LyricStyleSettings;
  alignment: 'left' | 'center' | 'right';
  visibleLines: number;
  highlightCurrentLine: boolean;
  animationDuration: number;
  elrcTransition?: ElrcTransition;
  elrcHighlightMode?: ElrcTransition | 'progressive_sweeping';
  wordHighlightAnimation?: 'smooth' | 'instant' | 'fade' | 'off';
  customFontName?: string | null;
  customFontFileName?: string | null;
  customFontId?: string | null;
  customFontUrl?: string | null;
  customFontMime?: string | null;
  customFontUpdatedAt?: number | null;
}

export const DEFAULT_LYRICS_SETTINGS: LyricsAppearanceSettings = {
  highlighted: {
    font: 'manrope',
    size: 48,
    weight: '800',
    letterSpacing: -1,
    lineSpacing: 1.2,
    textCase: 'original',
    opacity: 1.0,
    color: '#FF4FA3'
  },
  unhighlighted: {
    font: 'manrope',
    size: 20,
    weight: '500',
    opacity: 0.45,
    letterSpacing: 0,
    lineSpacing: 1.4,
    textCase: 'original',
    color: '#d4d4d8'
  },
  alignment: 'center',
  visibleLines: 3,
  highlightCurrentLine: true,
  animationDuration: 0.25,
  elrcTransition: 'smooth_sweep',
  elrcHighlightMode: 'smooth_sweep',
  wordHighlightAnimation: 'smooth',
  customFontName: null,
  customFontFileName: null,
  customFontId: null,
  customFontUrl: null,
  customFontMime: null,
  customFontUpdatedAt: null
};

export function sanitizeLyricsFont(fontVal: any): string {
  if (typeof fontVal !== 'string' || !fontVal.trim()) {
    return 'manrope';
  }
  const norm = fontVal.toLowerCase().trim().replace(/_/g, '-').replace(/\s+/g, '-');
  if (norm === 'custom') return 'custom';
  if (norm === 'manrope') return 'manrope';
  if (norm === 'sora') return 'sora';
  if (norm === 'plus-jakarta-sans' || norm === 'plusjakartasans') return 'plus-jakarta-sans';
  if (norm === 'instrument-serif' || norm === 'instrumentserif') return 'instrument-serif';
  if (norm === 'urbanist') return 'urbanist';
  if (norm === 'cormorant-garamond' || norm === 'cormorantgaramond') return 'cormorant-garamond';
  if (norm === 'lobster') return 'lobster';
  if (norm === 'super-sale' || norm === 'supersale') return 'super-sale';
  if (norm === 'huggable') return 'huggable';
  // Obsolete built-in font (e.g. system, sans, serif, mono, display, rounded) or unknown -> fallback to manrope
  return 'manrope';
}

export function resolveLyricsSettings(raw?: any): LyricsAppearanceSettings {
  const parsed = (raw && typeof raw === 'object') ? raw : {};
  const high = (parsed.highlighted && typeof parsed.highlighted === 'object') ? parsed.highlighted : {};
  const unhigh = (parsed.unhighlighted && typeof parsed.unhighlighted === 'object') ? parsed.unhighlighted : {};

  const validTextCases = ['original', 'lowercase', 'uppercase', 'titlecase'] as const;
  const validAlignments = ['left', 'center', 'right'] as const;

  return {
    highlighted: {
      font: sanitizeLyricsFont(high.font),
      size: typeof high.size === 'number' && !isNaN(high.size) ? high.size : DEFAULT_LYRICS_SETTINGS.highlighted.size,
      weight: high.weight ? String(high.weight) : DEFAULT_LYRICS_SETTINGS.highlighted.weight,
      letterSpacing: typeof high.letterSpacing === 'number' && !isNaN(high.letterSpacing) ? high.letterSpacing : DEFAULT_LYRICS_SETTINGS.highlighted.letterSpacing,
      lineSpacing: typeof high.lineSpacing === 'number' && !isNaN(high.lineSpacing) ? high.lineSpacing : DEFAULT_LYRICS_SETTINGS.highlighted.lineSpacing,
      textCase: validTextCases.includes(high.textCase) ? high.textCase : DEFAULT_LYRICS_SETTINGS.highlighted.textCase,
      opacity: typeof high.opacity === 'number' && !isNaN(high.opacity) ? high.opacity : DEFAULT_LYRICS_SETTINGS.highlighted.opacity,
      color: typeof high.color === 'string' && high.color.trim() ? high.color.trim() : DEFAULT_LYRICS_SETTINGS.highlighted.color
    },
    unhighlighted: {
      font: sanitizeLyricsFont(unhigh.font),
      size: typeof unhigh.size === 'number' && !isNaN(unhigh.size) ? unhigh.size : DEFAULT_LYRICS_SETTINGS.unhighlighted.size,
      weight: unhigh.weight ? String(unhigh.weight) : DEFAULT_LYRICS_SETTINGS.unhighlighted.weight,
      letterSpacing: typeof unhigh.letterSpacing === 'number' && !isNaN(unhigh.letterSpacing) ? unhigh.letterSpacing : DEFAULT_LYRICS_SETTINGS.unhighlighted.letterSpacing,
      lineSpacing: typeof unhigh.lineSpacing === 'number' && !isNaN(unhigh.lineSpacing) ? unhigh.lineSpacing : DEFAULT_LYRICS_SETTINGS.unhighlighted.lineSpacing,
      textCase: validTextCases.includes(unhigh.textCase) ? unhigh.textCase : DEFAULT_LYRICS_SETTINGS.unhighlighted.textCase,
      opacity: typeof unhigh.opacity === 'number' && !isNaN(unhigh.opacity) ? unhigh.opacity : DEFAULT_LYRICS_SETTINGS.unhighlighted.opacity,
      color: typeof unhigh.color === 'string' && unhigh.color.trim() ? unhigh.color.trim() : DEFAULT_LYRICS_SETTINGS.unhighlighted.color
    },
    alignment: validAlignments.includes(parsed.alignment) ? parsed.alignment : DEFAULT_LYRICS_SETTINGS.alignment,
    visibleLines: [1, 3, 5].includes(parsed.visibleLines) ? parsed.visibleLines : DEFAULT_LYRICS_SETTINGS.visibleLines,
    highlightCurrentLine: typeof parsed.highlightCurrentLine === 'boolean' ? parsed.highlightCurrentLine : DEFAULT_LYRICS_SETTINGS.highlightCurrentLine,
    animationDuration: typeof parsed.animationDuration === 'number' && !isNaN(parsed.animationDuration) ? parsed.animationDuration : DEFAULT_LYRICS_SETTINGS.animationDuration,
    elrcTransition: (() => {
      const rawMode = parsed.elrcTransition || parsed.elrcHighlightMode;
      if (rawMode === 'progressive_sweeping' || rawMode === 'smooth_sweep') return 'smooth_sweep';
      if (rawMode === 'karaoke' || rawMode === 'current_only' || rawMode === 'instant') return rawMode;
      return DEFAULT_LYRICS_SETTINGS.elrcTransition ?? 'smooth_sweep';
    })(),
    elrcHighlightMode: (() => {
      const rawMode = parsed.elrcTransition || parsed.elrcHighlightMode;
      if (rawMode === 'progressive_sweeping' || rawMode === 'smooth_sweep') return 'smooth_sweep';
      if (rawMode === 'karaoke' || rawMode === 'current_only' || rawMode === 'instant') return rawMode;
      return DEFAULT_LYRICS_SETTINGS.elrcHighlightMode ?? 'smooth_sweep';
    })(),
    wordHighlightAnimation: ['smooth', 'instant', 'fade', 'off'].includes(parsed.wordHighlightAnimation) ? parsed.wordHighlightAnimation : DEFAULT_LYRICS_SETTINGS.wordHighlightAnimation,
    customFontName: typeof parsed.customFontName === 'string' && parsed.customFontName.trim() ? parsed.customFontName.trim() : null,
    customFontFileName: typeof parsed.customFontFileName === 'string' && parsed.customFontFileName.trim() ? parsed.customFontFileName.trim() : null,
    customFontId: typeof parsed.customFontId === 'string' && parsed.customFontId.trim() ? parsed.customFontId.trim() : null,
    customFontUrl: typeof parsed.customFontUrl === 'string' && parsed.customFontUrl.trim() ? parsed.customFontUrl.trim() : null,
    customFontMime: typeof parsed.customFontMime === 'string' && parsed.customFontMime.trim() ? parsed.customFontMime.trim() : null,
    customFontUpdatedAt: typeof parsed.customFontUpdatedAt === 'number' && !isNaN(parsed.customFontUpdatedAt) ? parsed.customFontUpdatedAt : null
  };
}
