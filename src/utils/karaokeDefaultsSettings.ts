export type AudioMode = 'vocals' | 'instrumental' | 'dual' | 'original';
export type LyricsMode = 'scrolling' | 'static' | 'off' | 'elrc' | 'lrc';

export interface KaraokeDefaultsSettings {
  elrcLineLeadInMs: number;
  downloadLyrics: boolean;
  audioMode: AudioMode;
  lyricsMode: LyricsMode;
}

export const DEFAULT_KARAOKE_DEFAULTS_SETTINGS: KaraokeDefaultsSettings = {
  elrcLineLeadInMs: 500,
  downloadLyrics: true,
  audioMode: 'vocals',
  lyricsMode: 'scrolling',
};

export function getKaraokeDefaultsSettings(): KaraokeDefaultsSettings {
  return DEFAULT_KARAOKE_DEFAULTS_SETTINGS;
}

export async function fetchServerKaraokeDefaultsSettings(): Promise<KaraokeDefaultsSettings> {
  return DEFAULT_KARAOKE_DEFAULTS_SETTINGS;
}

export function resolveKaraokeDefaultsSettings(): KaraokeDefaultsSettings {
  return DEFAULT_KARAOKE_DEFAULTS_SETTINGS;
}
