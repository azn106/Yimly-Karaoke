import { loadAndRegisterCustomFont } from './customFontStorage';

export interface LyricStyleSettings {
  font: string; // 'manrope' | 'sora' | 'plus-jakarta-sans' | 'instrument-serif' | 'urbanist' | 'cormorant-garamond' | 'lobster' | 'super-sale' | 'huggable' | 'custom'
  size: number; // in px, e.g. 48
  weight: string; // '100' | '300' | '400' | '500' | '600' | '700' | '800' | '900'
  letterSpacing: number; // in px, e.g. -1, 0, 1, 2
  lineSpacing: number; // line-height multiplier, e.g. 1.2
  textCase: 'original' | 'lowercase' | 'uppercase' | 'titlecase';
  opacity?: number; // 0.1 to 1.0 (for unhighlighted / highlighted)
  color?: string; // hex color string, e.g. '#FF4FA3'
}

export type ElrcTransition = 'smooth_sweep' | 'karaoke' | 'current_only' | 'instant';

export interface LyricsAppearanceSettings {
  highlighted: LyricStyleSettings;
  unhighlighted: LyricStyleSettings;
  alignment: 'left' | 'center' | 'right';
  visibleLines: number; // 1 | 3 | 5
  highlightCurrentLine: boolean; // on / off
  animationDuration: number; // in seconds, e.g. 0.25
  elrcTransition?: ElrcTransition;
  elrcHighlightMode?: ElrcTransition | 'progressive_sweeping'; // 'smooth_sweep' | 'karaoke' | 'current_only' | 'instant'
  wordHighlightAnimation?: 'smooth' | 'instant' | 'fade' | 'off'; // 'smooth' | 'instant' | 'fade' | 'off'
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

const STORAGE_KEY = 'yimly_lyrics_appearance_settings_v1';

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
  // Any removed built-in font (system, sans, serif, mono, display, rounded) or unknown -> fallback to manrope
  return 'manrope';
}

/**
 * Deeply validates, sanitizes, and completes any partial or raw settings object
 * into the canonical full LyricsAppearanceSettings structure.
 */
export function resolveLyricsSettings(raw?: any): LyricsAppearanceSettings {
  const parsed = (raw && typeof raw === 'object') ? raw : {};
  const high = (parsed.highlighted && typeof parsed.highlighted === 'object') ? parsed.highlighted : {};
  const unhigh = (parsed.unhighlighted && typeof parsed.unhighlighted === 'object') ? parsed.unhighlighted : {};

  const validTextCases = ['original', 'lowercase', 'uppercase', 'titlecase'] as const;
  const validAlignments = ['left', 'center', 'right'] as const;

  const resolved: LyricsAppearanceSettings = {
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
      lineSpacing: typeof unhigh.lineSpacing === 'number' && !isNaN(unhigh.lineSpacing) ? high.lineSpacing ?? DEFAULT_LYRICS_SETTINGS.unhighlighted.lineSpacing : DEFAULT_LYRICS_SETTINGS.unhighlighted.lineSpacing,
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

  if (resolved.highlighted.font === 'custom' || resolved.unhighlighted.font === 'custom') {
    loadAndRegisterCustomFont('custom', resolved.customFontName, resolved.customFontUrl);
  }

  return resolved;
}

/**
 * Loads the canonical lyric appearance settings from persistent storage.
 * Always resolves to a complete, valid LyricsAppearanceSettings object.
 */
export function getLyricsSettings(): LyricsAppearanceSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const canonical = resolveLyricsSettings(parsed);
      loadAndRegisterCustomFont(canonical.highlighted.font, canonical.customFontName, canonical.customFontUrl);
      loadAndRegisterCustomFont(canonical.unhighlighted.font, canonical.customFontName, canonical.customFontUrl);
      console.log('[LyricsSettings] Successfully loaded persisted settings from localStorage:', canonical);
      return canonical;
    }
  } catch (e) {
    console.error('[LyricsSettings] Failed to load lyrics settings from localStorage, falling back to defaults:', e);
  }
  console.log('[LyricsSettings] No persisted settings found; using canonical defaults.');
  return DEFAULT_LYRICS_SETTINGS;
}

/**
 * Saves canonical lyric appearance settings to persistent storage and notifies
 * any active rooms or listeners immediately.
 */
export function saveLyricsSettings(settings: LyricsAppearanceSettings, sessionId?: string): void {
  try {
    const canonical = resolveLyricsSettings(settings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(canonical));
    window.dispatchEvent(new CustomEvent('yimly_lyrics_settings_changed', { detail: canonical }));
    console.log('[LyricsSettings] Persisted updated lyric appearance settings locally:', canonical);

    if (canonical.highlighted.font === 'custom' || canonical.unhighlighted.font === 'custom') {
      loadAndRegisterCustomFont('custom', canonical.customFontName, canonical.customFontUrl);
    }

    // Persist to server default settings
    fetch('/api/karaoke/settings/lyrics', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: canonical }),
    }).catch(err => console.warn('[LyricsSettings] Failed to save settings to server default:', err));

    // If active session ID is provided, also sync directly to the session
    if (sessionId) {
      fetch(`/api/karaoke/sessions/${sessionId}/lyrics-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: canonical }),
      }).catch(err => console.warn(`[LyricsSettings] Failed to sync settings to session ${sessionId}:`, err));
    }
  } catch (e) {
    console.error('[LyricsSettings] Failed to save lyrics settings:', e);
  }
}

/**
 * Fetches the canonical lyric appearance settings from the server.
 * Updates local storage cache upon success.
 */
export async function fetchServerLyricsSettings(sessionId?: string): Promise<LyricsAppearanceSettings> {
  try {
    const url = sessionId 
      ? `/api/karaoke/sessions/${sessionId}/lyrics-settings` 
      : '/api/karaoke/settings/lyrics';

    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data && data.settings) {
        const canonical = resolveLyricsSettings(data.settings);
        if (canonical.highlighted.font === 'custom' || canonical.unhighlighted.font === 'custom') {
          loadAndRegisterCustomFont('custom', canonical.customFontName, canonical.customFontUrl);
        }
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(canonical));
        } catch (e) {
          // ignore localStorage error
        }
        return canonical;
      }
    }
  } catch (err) {
    console.warn('[LyricsSettings] Failed to fetch server lyrics settings:', err);
  }
  return getLyricsSettings();
}

export function applyTextCase(text: string, textCase: string): string {
  if (!text) return '';
  switch (textCase) {
    case 'lowercase':
      return text.toLowerCase();
    case 'uppercase':
      return text.toUpperCase();
    case 'titlecase':
      return text.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
    case 'original':
    default:
      return text;
  }
}

export interface LyricFontOption {
  value: string;
  label: string;
  fontFamily: string;
}

export const LYRICS_FONT_OPTIONS: LyricFontOption[] = [
  {
    value: 'manrope',
    label: 'Manrope — Modern Premium',
    fontFamily: '"Manrope", system-ui, -apple-system, sans-serif'
  },
  {
    value: 'sora',
    label: 'Sora — Sleek/Futuristic',
    fontFamily: '"Sora", system-ui, -apple-system, sans-serif'
  },
  {
    value: 'plus-jakarta-sans',
    label: 'Plus Jakarta Sans — Spotify-like',
    fontFamily: '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif'
  },
  {
    value: 'instrument-serif',
    label: 'Instrument Serif — Luxury',
    fontFamily: '"Instrument Serif", Georgia, "Times New Roman", serif'
  },
  {
    value: 'urbanist',
    label: 'Urbanist — Stylish Lyrics',
    fontFamily: '"Urbanist", system-ui, -apple-system, sans-serif'
  },
  {
    value: 'cormorant-garamond',
    label: 'Cormorant Garamond — Emotional',
    fontFamily: '"Cormorant Garamond", Garamond, Georgia, serif'
  },
  {
    value: 'lobster',
    label: 'Lobster — Script / Playful',
    fontFamily: '"Lobster", cursive, sans-serif'
  },
  {
    value: 'super-sale',
    label: 'Super Sale',
    fontFamily: '"Super Sale", Impact, "Arial Black", system-ui, sans-serif'
  },
  {
    value: 'huggable',
    label: 'Huggable',
    fontFamily: '"Huggable", "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif'
  },
  {
    value: 'custom',
    label: 'Custom Font',
    fontFamily: 'custom'
  }
];

export function getFontFamilyStyle(fontKey: string, customFontName?: string | null): string {
  const normalized = (fontKey || '').toLowerCase().trim().replace(/_/g, '-').replace(/\s+/g, '-');
  if (normalized === 'custom' && customFontName) {
    return `"${customFontName}", sans-serif`;
  }
  switch (normalized) {
    case 'manrope':
      return '"Manrope", system-ui, -apple-system, sans-serif';
    case 'sora':
      return '"Sora", system-ui, -apple-system, sans-serif';
    case 'plus-jakarta-sans':
    case 'plusjakartasans':
      return '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
    case 'instrument-serif':
    case 'instrumentserif':
      return '"Instrument Serif", Georgia, "Times New Roman", serif';
    case 'urbanist':
      return '"Urbanist", system-ui, -apple-system, sans-serif';
    case 'cormorant-garamond':
    case 'cormorantgaramond':
      return '"Cormorant Garamond", Garamond, Georgia, serif';
    case 'lobster':
      return '"Lobster", cursive, sans-serif';
    case 'super-sale':
    case 'supersale':
      return '"Super Sale", Impact, "Arial Black", system-ui, sans-serif';
    case 'huggable':
      return '"Huggable", "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif';
    default:
      return '"Manrope", system-ui, -apple-system, sans-serif';
  }
}

export function getFontFamilyClass(fontKey: string): string {
  const normalized = (fontKey || '').toLowerCase().trim().replace(/_/g, '-').replace(/\s+/g, '-');
  switch (normalized) {
    case 'manrope':
      return 'font-["Manrope",sans-serif]';
    case 'sora':
      return 'font-["Sora",sans-serif]';
    case 'plus-jakarta-sans':
    case 'plusjakartasans':
      return 'font-["Plus_Jakarta_Sans",sans-serif]';
    case 'instrument-serif':
    case 'instrumentserif':
      return 'font-["Instrument_Serif",serif]';
    case 'urbanist':
      return 'font-["Urbanist",sans-serif]';
    case 'cormorant-garamond':
    case 'cormorantgaramond':
      return 'font-["Cormorant_Garamond",serif]';
    case 'lobster':
      return 'font-["Lobster",cursive]';
    case 'super-sale':
    case 'supersale':
      return 'font-["Super_Sale",sans-serif]';
    case 'huggable':
      return 'font-["Huggable",sans-serif]';
    default:
      return 'font-["Manrope",sans-serif]';
  }
}

export function getAlignmentClass(alignment: 'left' | 'center' | 'right'): string {
  switch (alignment) {
    case 'left':
      return 'text-left items-start';
    case 'right':
      return 'text-right items-end';
    case 'center':
    default:
      return 'text-center items-center';
  }
}
