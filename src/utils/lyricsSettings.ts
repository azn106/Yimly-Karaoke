import { loadAndRegisterCustomFont } from './customFontStorage';

export interface LyricStyleSettings {
  font: string; // 'ltkaraoke' | 'dongle' | 'lobster' | 'super-sale' | 'custom'
  size: number; // in px, e.g. 48
  weight: string; // '100' | '300' | '400' | '500' | '600' | '700' | '800' | '900'
  letterSpacing: number; // in px, e.g. -1, 0, 1, 2
  lineSpacing: number; // line-height multiplier, e.g. 1.2
  textCase: 'original' | 'lowercase' | 'uppercase' | 'titlecase';
  opacity?: number; // 0.1 to 1.0 (for unhighlighted / highlighted)
  color?: string; // hex color string, e.g. '#F472B6'
}

export interface LyricsAppearanceSettings {
  highlighted: LyricStyleSettings;
  unhighlighted: LyricStyleSettings;
  alignment: 'left' | 'center' | 'right';
  verticalAlignment: 'top' | 'center' | 'bottom';
  visibleLines: number; // Number of parallel lyric sections (1–5)
  elrcDisplayLeadInMs?: number; // Optional line-display lead-in for eLRC lyrics, in milliseconds.
  elrcFadeDurationMs?: number; // eLRC line wipe fade duration, in milliseconds (default: 1500)
  elrcFadeOverlapMs?: number; // eLRC incoming/outgoing overlap, in milliseconds (default: 300)
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
    color: '#F472B6'
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

const STORAGE_KEY = 'yimly_lyrics_appearance_settings_v1';

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

/**
 * Deeply validates, sanitizes, and completes any partial or raw settings object
 * into the canonical full LyricsAppearanceSettings structure.
 */
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

  const resolved: LyricsAppearanceSettings = {
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
    // Preserve the user's existing 1–5 selection; it now controls the number of rotating sections.
    visibleLines: Number.isInteger(parsed.visibleLines) && parsed.visibleLines >= 1 && parsed.visibleLines <= 5
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
  { value: 'ltkaraoke', label: 'LTKaraoke — Default Lyrics', fontFamily: '"LTKaraoke", sans-serif' },
  { value: 'dongle', label: 'Dongle', fontFamily: '"Dongle", sans-serif' },
  { value: 'lobster', label: 'Lobster', fontFamily: '"Lobster", cursive, sans-serif' },
  { value: 'super-sale', label: 'Super Sale', fontFamily: '"Super Sale", Impact, sans-serif' },
  { value: 'custom', label: 'Custom Font', fontFamily: 'custom' }
];

export function getFontFamilyStyle(fontKey: string, customFontName?: string | null): string {
  const normalized = (fontKey || '').toLowerCase().trim().replace(/_/g, '-').replace(/\s+/g, '-');
  if (normalized === 'custom' && customFontName) return `"${customFontName}", sans-serif`;
  switch (normalized) {
    case 'ltkaraoke':
    case 'lt-karaoke': return '"LTKaraoke", sans-serif';
    case 'dongle': return '"Dongle", sans-serif';
    case 'lobster': return '"Lobster", cursive, sans-serif';
    case 'super-sale':
    case 'supersale': return '"Super Sale", Impact, sans-serif';
    default: return '"LTKaraoke", sans-serif';
  }
}

export function getFontFamilyClass(fontKey: string): string {
  const normalized = (fontKey || '').toLowerCase().trim().replace(/_/g, '-').replace(/\s+/g, '-');
  switch (normalized) {
    case 'ltkaraoke':
    case 'lt-karaoke': return 'font-["LTKaraoke",sans-serif]';
    case 'dongle': return 'font-["Dongle",sans-serif]';
    case 'lobster': return 'font-["Lobster",cursive]';
    case 'super-sale':
    case 'supersale': return 'font-["Super_Sale",sans-serif]';
    default: return 'font-["LTKaraoke",sans-serif]';
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
