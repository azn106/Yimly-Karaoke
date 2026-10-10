export type BackgroundMusicAudioMode = 'instrumental' | 'original';

export interface BackgroundMusicSettings {
  enabled: boolean;
  volume: number; // 0 to 100
  playlistId: string | null;
  audioMode: BackgroundMusicAudioMode;
  crossfadeEnabled: boolean;
  crossfadeDuration: number; // 2 to 12 seconds
}

export const DEFAULT_BACKGROUND_MUSIC_SETTINGS: BackgroundMusicSettings = {
  enabled: true,
  volume: 25,
  playlistId: null,
  audioMode: 'original',
  crossfadeEnabled: false,
  crossfadeDuration: 5,
};

export const BACKGROUND_MUSIC_STORAGE_KEY = 'yimly_background_music_settings_v1';

export function resolveBackgroundMusicSettings(raw?: any): BackgroundMusicSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_BACKGROUND_MUSIC_SETTINGS };
  }

  const enabled = typeof raw.enabled === 'boolean' 
    ? raw.enabled 
    : (raw.enabled === 'true' || raw.enabled === 1 || raw.enabled === '1' ? true : raw.enabled === 'false' || raw.enabled === 0 || raw.enabled === '0' ? false : DEFAULT_BACKGROUND_MUSIC_SETTINGS.enabled);

  let volume = DEFAULT_BACKGROUND_MUSIC_SETTINGS.volume;
  if (typeof raw.volume === 'number' && !isNaN(raw.volume)) {
    volume = Math.max(0, Math.min(100, Math.round(raw.volume)));
  } else if (typeof raw.volume === 'string' && raw.volume.trim() !== '') {
    const parsed = parseInt(raw.volume, 10);
    if (!isNaN(parsed)) {
      volume = Math.max(0, Math.min(100, parsed));
    }
  }

  let playlistId: string | null = null;
  if (raw.playlistId !== undefined && raw.playlistId !== null) {
    const trimmed = String(raw.playlistId).trim();
    if (trimmed !== '' && trimmed !== 'null' && trimmed !== 'undefined' && trimmed !== 'all') {
      playlistId = trimmed;
    }
  }

  const audioMode: BackgroundMusicAudioMode = DEFAULT_BACKGROUND_MUSIC_SETTINGS.audioMode;
  if (raw.audioMode === 'instrumental' || raw.audioMode === 'original') {
    audioMode = raw.audioMode;
  } else if (raw.audio === 'instrumental' || raw.audio === 'original') {
    audioMode = raw.audio;
  } else if (raw.mode === 'instrumental' || raw.mode === 'original') {
    audioMode = raw.mode;
  }

  const crossfadeEnabled = typeof raw.crossfadeEnabled === 'boolean' 
    ? raw.crossfadeEnabled 
    : DEFAULT_BACKGROUND_MUSIC_SETTINGS.crossfadeEnabled;

  let crossfadeDuration = DEFAULT_BACKGROUND_MUSIC_SETTINGS.crossfadeDuration;
  if (typeof raw.crossfadeDuration === 'number' && !isNaN(raw.crossfadeDuration)) {
    crossfadeDuration = Math.max(2, Math.min(12, Math.round(raw.crossfadeDuration)));
  }

  return {
    enabled,
    volume,
    playlistId,
    audioMode,
    crossfadeEnabled,
    crossfadeDuration,
  };
}

export function getBackgroundMusicSettings(): BackgroundMusicSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_BACKGROUND_MUSIC_SETTINGS };
  try {
    const saved = localStorage.getItem(BACKGROUND_MUSIC_STORAGE_KEY);
    if (saved) {
      return resolveBackgroundMusicSettings(JSON.parse(saved));
    }
  } catch (e) {
    // Ignore JSON/localStorage error
  }
  return { ...DEFAULT_BACKGROUND_MUSIC_SETTINGS };
}

export async function fetchServerBackgroundMusicSettings(): Promise<BackgroundMusicSettings> {
  try {
    const res = await fetch('/api/karaoke/settings/background-music');
    if (res.ok) {
      const data = await res.json();
      if (data && data.settings) {
        const canonical = resolveBackgroundMusicSettings(data.settings);
        try {
          if (typeof window !== 'undefined') {
            localStorage.setItem(BACKGROUND_MUSIC_STORAGE_KEY, JSON.stringify(canonical));
          }
        } catch (e) {}
        return canonical;
      }
    }
  } catch (err) {
    console.warn('[BackgroundMusic] Failed to fetch server background music settings:', err);
  }
  return getBackgroundMusicSettings();
}

export async function saveBackgroundMusicSettings(settings: BackgroundMusicSettings): Promise<BackgroundMusicSettings> {
  const canonical = resolveBackgroundMusicSettings(settings);
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(BACKGROUND_MUSIC_STORAGE_KEY, JSON.stringify(canonical));
      window.dispatchEvent(new CustomEvent('yimly_bgm_settings_changed', { detail: canonical }));
    }
  } catch (e) {}

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('yimly_token') : null;
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch (e) {}

    const res = await fetch('/api/karaoke/settings/background-music', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ settings: canonical }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.settings) {
        return resolveBackgroundMusicSettings(data.settings);
      }
    }
  } catch (err) {
    console.warn('[BackgroundMusic] Failed to save server background music settings:', err);
  }
  return canonical;
}
