import { getAuthToken } from '../lib/auth';

export type AudioMode = 'instrumental' | 'original';
export type LyricsMode = 'elrc' | 'lrc';

export interface KaraokeDefaultsSettings {
  audioMode: AudioMode;
  lyricsMode: LyricsMode;
}

export const DEFAULT_KARAOKE_DEFAULTS_SETTINGS: KaraokeDefaultsSettings = {
  audioMode: 'instrumental',
  lyricsMode: 'elrc',
};

export const KARAOKE_DEFAULTS_STORAGE_KEY = 'yimly_karaoke_startup_defaults_v1';

export function resolveKaraokeDefaultsSettings(raw?: any): KaraokeDefaultsSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_KARAOKE_DEFAULTS_SETTINGS };
  }

  const audioMode: AudioMode = 
    raw.audioMode === 'original' || raw.audioMode === 'instrumental'
      ? raw.audioMode
      : (raw.audio === 'original' || raw.audio === 'instrumental'
          ? raw.audio
          : (raw.variant === 'original' || raw.variant === 'instrumental'
              ? raw.variant
              : DEFAULT_KARAOKE_DEFAULTS_SETTINGS.audioMode));

  const lyricsMode: LyricsMode =
    raw.lyricsMode === 'lrc' || raw.lyricsMode === 'elrc'
      ? raw.lyricsMode
      : (raw.lyrics === 'lrc' || raw.lyrics === 'elrc'
          ? raw.lyrics
          : (raw.lyricsFormat === 'lrc' || raw.lyricsFormat === 'elrc'
              ? raw.lyricsFormat
              : DEFAULT_KARAOKE_DEFAULTS_SETTINGS.lyricsMode));

  return {
    audioMode,
    lyricsMode,
  };
}

export function getKaraokeDefaultsSettings(): KaraokeDefaultsSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_KARAOKE_DEFAULTS_SETTINGS };
  try {
    const saved = localStorage.getItem(KARAOKE_DEFAULTS_STORAGE_KEY);
    if (saved) {
      return resolveKaraokeDefaultsSettings(JSON.parse(saved));
    }
  } catch (e) {
    // Ignore JSON/localStorage error
  }
  return { ...DEFAULT_KARAOKE_DEFAULTS_SETTINGS };
}

export async function fetchServerKaraokeDefaultsSettings(): Promise<KaraokeDefaultsSettings> {
  try {
    const res = await fetch('/api/karaoke/settings/karaoke-defaults');
    if (res.ok) {
      const data = await res.json();
      if (data && data.settings) {
        const canonical = resolveKaraokeDefaultsSettings(data.settings);
        try {
          if (typeof window !== 'undefined') {
            localStorage.setItem(KARAOKE_DEFAULTS_STORAGE_KEY, JSON.stringify(canonical));
          }
        } catch (e) {}
        return canonical;
      }
    }
  } catch (err) {
    console.warn('[KaraokeDefaults] Failed to fetch server karaoke defaults settings:', err);
  }
  return getKaraokeDefaultsSettings();
}

export async function saveKaraokeDefaultsSettings(settings: KaraokeDefaultsSettings): Promise<KaraokeDefaultsSettings> {
  const canonical = resolveKaraokeDefaultsSettings(settings);
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(KARAOKE_DEFAULTS_STORAGE_KEY, JSON.stringify(canonical));
      window.dispatchEvent(new CustomEvent('yimly_karaoke_defaults_changed', { detail: canonical }));
    }
  } catch (e) {}

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
      const token = getAuthToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch (e) {}

    const res = await fetch('/api/karaoke/settings/karaoke-defaults', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ settings: canonical }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.settings) {
        return resolveKaraokeDefaultsSettings(data.settings);
      }
    }
  } catch (err) {
    console.warn('[KaraokeDefaults] Failed to save server karaoke defaults settings:', err);
  }
  return canonical;
}
