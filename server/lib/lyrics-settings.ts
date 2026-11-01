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


export interface LyricsAppearanceSettings {
  highlighted: LyricStyleSettings;
  unhighlighted: LyricStyleSettings;
  alignment: 'left' | 'center' | 'right';
  verticalAlignment: 'top' | 'center' | 'bottom';
  visibleLines: number;
  elrcDisplayLeadInMs?: number;
  elrcFadeDurationMs?: number;
  elrcFadeOverlapMs?: number;
  customFontName?: string | null;
  customFontFileName?: string | null;
  customFontId?: string | null;
  customFontUrl?: string | null;
  customFontMime?: string | null;
  customFontUpdatedAt?: number | null;
}

export const DEFAULT_LYRICS_SETTINGS: LyricsAppearanceSettings = {
  highlighted: {
    font: 'ltkaraoke',
    size: 48,
    weight: '700',
    letterSpacing: -1,
    lineSpacing: 1.2,
    textCase: 'original',
    opacity: 1.0,
    color: '#FF4FA3'
  },
  unhighlighted: {
    font: 'ltkaraoke',
    size: 20,
    weight: '500',
    opacity: 0.8,
    letterSpacing: 0,
    lineSpacing: 1.4,
    textCase: 'original',
    color: '#d4d4d8'
  },
  alignment: 'center',
  verticalAlignment: 'center',
  visibleLines: 2,
  elrcDisplayLeadInMs: 1500,
  elrcFadeDurationMs: 1500,
  elrcFadeOverlapMs: 300,
  customFontName: null,
  customFontFileName: null,
  customFontId: null,
  customFontUrl: null,
  customFontMime: null,
  customFontUpdatedAt: null
};

export function sanitizeLyricsFont(fontVal: any): string {
  if (typeof fontVal !== 'string' || !fontVal.trim()) return 'ltkaraoke';
  const norm = fontVal.toLowerCase().trim().replace(/_/g, '-').replace(/\s+/g, '-');
  if (norm === 'custom') return 'custom';
  if (norm === 'ltkaraoke' || norm === 'lt-karaoke') return 'ltkaraoke';
  if (norm === 'dongle') return 'dongle';
  if (norm === 'lobster') return 'lobster';
  if (norm === 'super-sale' || norm === 'supersale') return 'super-sale';
  return 'ltkaraoke';
}

export function sanitizeLyricsWeight(fontVal: string, weightVal: any): string {
  const font = sanitizeLyricsFont(fontVal);
  const requested = Number(weightVal);
  const weights = font === 'ltkaraoke' ? ['300', '400', '500', '600', '700']
    : font === 'dongle' ? ['300', '400', '700']
    : font === 'lobster' || font === 'super-sale' ? ['400']
    : ['100', '300', '400', '500', '600', '700', '800', '900'];
  if (!Number.isFinite(requested)) return weights.includes('400') ? '400' : weights[0];
  return weights.reduce((best, current) =>
    Math.abs(Number(current) - requested) < Math.abs(Number(best) - requested) ? current : best
  , weights[0]);
}

export function resolveLyricsSettings(raw?: any): LyricsAppearanceSettings {
  const parsed = (raw && typeof raw === 'object') ? raw : {};
  const high = (parsed.highlighted && typeof parsed.highlighted === 'object') ? parsed.highlighted : {};
  const unhigh = (parsed.unhighlighted && typeof parsed.unhighlighted === 'object') ? parsed.unhighlighted : {};

  const validTextCases = ['original', 'lowercase', 'uppercase', 'titlecase'] as const;
  const validAlignments = ['left', 'center', 'right'] as const;
  const validVerticalAlignments = ['top', 'center', 'bottom'] as const;

  return {
    highlighted: {
      font: sanitizeLyricsFont(high.font),
      size: typeof high.size === 'number' && !isNaN(high.size) ? high.size : DEFAULT_LYRICS_SETTINGS.highlighted.size,
      weight: sanitizeLyricsWeight(sanitizeLyricsFont(high.font), high.weight ?? DEFAULT_LYRICS_SETTINGS.highlighted.weight),
      letterSpacing: typeof high.letterSpacing === 'number' && !isNaN(high.letterSpacing) ? high.letterSpacing : DEFAULT_LYRICS_SETTINGS.highlighted.letterSpacing,
      lineSpacing: typeof high.lineSpacing === 'number' && !isNaN(high.lineSpacing) ? high.lineSpacing : DEFAULT_LYRICS_SETTINGS.highlighted.lineSpacing,
      textCase: validTextCases.includes(high.textCase) ? high.textCase : DEFAULT_LYRICS_SETTINGS.highlighted.textCase,
      opacity: typeof high.opacity === 'number' && !isNaN(high.opacity) ? high.opacity : DEFAULT_LYRICS_SETTINGS.highlighted.opacity,
      color: typeof high.color === 'string' && high.color.trim() ? high.color.trim() : DEFAULT_LYRICS_SETTINGS.highlighted.color
    },
    unhighlighted: {
      font: sanitizeLyricsFont(unhigh.font),
      size: typeof unhigh.size === 'number' && !isNaN(unhigh.size) ? unhigh.size : DEFAULT_LYRICS_SETTINGS.unhighlighted.size,
      weight: sanitizeLyricsWeight(sanitizeLyricsFont(unhigh.font), unhigh.weight ?? DEFAULT_LYRICS_SETTINGS.unhighlighted.weight),
      letterSpacing: typeof unhigh.letterSpacing === 'number' && !isNaN(unhigh.letterSpacing) ? unhigh.letterSpacing : DEFAULT_LYRICS_SETTINGS.unhighlighted.letterSpacing,
      lineSpacing: typeof unhigh.lineSpacing === 'number' && !isNaN(unhigh.lineSpacing) ? unhigh.lineSpacing : DEFAULT_LYRICS_SETTINGS.unhighlighted.lineSpacing,
      textCase: validTextCases.includes(unhigh.textCase) ? unhigh.textCase : DEFAULT_LYRICS_SETTINGS.unhighlighted.textCase,
      opacity: typeof unhigh.opacity === 'number' && !isNaN(unhigh.opacity) ? unhigh.opacity : DEFAULT_LYRICS_SETTINGS.unhighlighted.opacity,
      color: typeof unhigh.color === 'string' && unhigh.color.trim() ? unhigh.color.trim() : DEFAULT_LYRICS_SETTINGS.unhighlighted.color
    },
    alignment: validAlignments.includes(parsed.alignment) ? parsed.alignment : DEFAULT_LYRICS_SETTINGS.alignment,
    verticalAlignment: validVerticalAlignments.includes(parsed.verticalAlignment) ? parsed.verticalAlignment : DEFAULT_LYRICS_SETTINGS.verticalAlignment,
    visibleLines: (Number.isInteger(parsed.visibleLines) && parsed.visibleLines >= 1 && parsed.visibleLines <= 5)
      ? parsed.visibleLines
      : DEFAULT_LYRICS_SETTINGS.visibleLines,
    elrcDisplayLeadInMs: typeof parsed.elrcDisplayLeadInMs === 'number' && Number.isFinite(parsed.elrcDisplayLeadInMs) ? Math.max(1500, Math.min(5000, Math.round(parsed.elrcDisplayLeadInMs))) : 1500,
    elrcFadeDurationMs: typeof parsed.elrcFadeDurationMs === 'number' && Number.isFinite(parsed.elrcFadeDurationMs) ? Math.max(300, Math.min(5000, Math.round(parsed.elrcFadeDurationMs))) : 1500,
    elrcFadeOverlapMs: typeof parsed.elrcFadeOverlapMs === 'number' && Number.isFinite(parsed.elrcFadeOverlapMs) ? Math.max(0, Math.min(3000, Math.round(parsed.elrcFadeOverlapMs))) : 300,
    customFontName: typeof parsed.customFontName === 'string' && parsed.customFontName.trim() ? parsed.customFontName.trim() : null,
    customFontFileName: typeof parsed.customFontFileName === 'string' && parsed.customFontFileName.trim() ? parsed.customFontFileName.trim() : null,
    customFontId: typeof parsed.customFontId === 'string' && parsed.customFontId.trim() ? parsed.customFontId.trim() : null,
    customFontUrl: typeof parsed.customFontUrl === 'string' && parsed.customFontUrl.trim() ? parsed.customFontUrl.trim() : null,
    customFontMime: typeof parsed.customFontMime === 'string' && parsed.customFontMime.trim() ? parsed.customFontMime.trim() : null,
    customFontUpdatedAt: typeof parsed.customFontUpdatedAt === 'number' && !isNaN(parsed.customFontUpdatedAt) ? parsed.customFontUpdatedAt : null
  };
}
