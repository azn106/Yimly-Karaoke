import { useState, useEffect, FormEvent } from 'react';
import { useOutletContext } from 'react-router-dom';
import { 
  Plus, Folder, RefreshCw, Trash2, AlertCircle, HardDrive, 
  ShieldCheck, Type, AlignLeft, AlignCenter, AlignRight, RotateCcw, Sparkles, Download, Save, Check,
  Layers, Zap, Sliders, Eye, Shield, Music, Volume2, Shuffle, ListMusic
} from 'lucide-react';
import { getAuthToken } from '../lib/auth';
import { AutoResponsiveLyrics } from '../components/AutoResponsiveLyrics';
import { 
  getLyricsSettings, 
  saveLyricsSettings, 
  fetchServerLyricsSettings,
  resolveLyricsSettings,
  DEFAULT_LYRICS_SETTINGS, 
  LyricsAppearanceSettings, 
  applyTextCase, 
  getFontFamilyClass, 
  getFontFamilyStyle,
  getAlignmentClass,
  LYRICS_FONT_OPTIONS
} from '../utils/lyricsSettings';
import {
  getBackgroundMusicSettings,
  saveBackgroundMusicSettings,
  fetchServerBackgroundMusicSettings,
  BackgroundMusicSettings,
  BackgroundMusicAudioMode,
  DEFAULT_BACKGROUND_MUSIC_SETTINGS,
} from '../utils/backgroundMusicSettings';
import {
  getKaraokeDefaultsSettings,
  saveKaraokeDefaultsSettings,
  fetchServerKaraokeDefaultsSettings,
  KaraokeDefaultsSettings,
  DEFAULT_KARAOKE_DEFAULTS_SETTINGS,
  AudioMode,
  LyricsMode,
} from '../utils/karaokeDefaultsSettings';

export default function Settings() {
  const context = useOutletContext<{ user: any }>();
  const user = context?.user;

  // Media Libraries State
  const [libraries, setLibraries] = useState<any[]>([]);
  const [newLibName, setNewLibName] = useState('');
  const [newLibPath, setNewLibPath] = useState('');
  const [libToRemove, setLibToRemove] = useState<any>(null);
  const [scanningId, setScanningId] = useState<number | null>(null);

  // Lyrics Appearance State
  const [lyricsSettings, setLyricsSettings] = useState<LyricsAppearanceSettings>(getLyricsSettings);
  const [activeTab, setActiveTab] = useState<'highlighted' | 'unhighlighted' | 'layout'>('highlighted');

  // Downloader Settings State
  const [dlSettings, setDlSettings] = useState({
    libraryId: '',
    format: 'mp3',
    quality: '320k',
    embedMetadata: true,
    embedArtwork: true,
    downloadLyrics: true,
    lyricsProviders: ['lrclib'],
    folderStructure: '{artist}/{artist} - {title}',
    playlistFolder: true,
    elrcLineLeadInMs: 500,
  });
  const [savingDlSettings, setSavingDlSettings] = useState(false);
  const [dlSavedMessage, setDlSavedMessage] = useState('');

  // Background Music Settings State
  const [bgmSettings, setBgmSettings] = useState<BackgroundMusicSettings>(getBackgroundMusicSettings);
  const [savingBgmSettings, setSavingBgmSettings] = useState(false);
  const [bgmSavedMessage, setBgmSavedMessage] = useState('');
  const [playlists, setPlaylists] = useState<Array<{ id: number; name: string; songCount?: number }>>([]);

  // Karaoke Startup Defaults State
  const [karaokeDefaults, setKaraokeDefaults] = useState<KaraokeDefaultsSettings>(getKaraokeDefaultsSettings);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [defaultsSavedMessage, setDefaultsSavedMessage] = useState('');

  const fetchPlaylists = async () => {
    try {
      const token = getAuthToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/playlists', { headers });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setPlaylists(data);
          // If the currently saved playlistId is no longer in the playlist list, fall back to All Local Music
          const currentBgm = getBackgroundMusicSettings();
          if (currentBgm.playlistId) {
            const exists = data.some((p: any) => String(p.id) === String(currentBgm.playlistId));
            if (!exists) {
              const fallback = { ...currentBgm, playlistId: null };
              setBgmSettings(fallback);
              saveBgm(fallback);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[Settings] Failed to fetch playlists for background music:', e);
    }
  };

  useEffect(() => {
    fetchLibraries();
    fetchDlSettings();
    fetchPlaylists();
    fetchServerLyricsSettings().then((srv) => {
      if (srv) {
        setLyricsSettings(srv);
      }
    });
    fetchServerBackgroundMusicSettings().then((srv) => {
      if (srv) {
        setBgmSettings(srv);
      }
    });
    fetchServerKaraokeDefaultsSettings().then((srv) => {
      if (srv) {
        setKaraokeDefaults(srv);
      }
    });
  }, []);

  const saveKaraokeDefaults = async (newSettings: KaraokeDefaultsSettings) => {
    setKaraokeDefaults(newSettings);
    setSavingDefaults(true);
    setDefaultsSavedMessage('');
    try {
      const saved = await saveKaraokeDefaultsSettings(newSettings);
      setKaraokeDefaults(saved);
      setDefaultsSavedMessage('Karaoke defaults saved!');
      setTimeout(() => setDefaultsSavedMessage(''), 3000);
    } catch (e) {
      console.error('[Settings] Failed to save karaoke defaults:', e);
    } finally {
      setSavingDefaults(false);
    }
  };

  const saveBgm = async (newSettings: BackgroundMusicSettings) => {
    setBgmSettings(newSettings);
    setSavingBgmSettings(true);
    setBgmSavedMessage('');
    try {
      const saved = await saveBackgroundMusicSettings(newSettings);
      setBgmSettings(saved);
      setBgmSavedMessage('Background music settings saved!');
      setTimeout(() => setBgmSavedMessage(''), 3000);
    } catch (e) {
      console.error('Failed to save background music settings:', e);
    } finally {
      setSavingBgmSettings(false);
    }
  };

  const fetchDlSettings = async () => {
    try {
      const res = await fetch('/api/downloader/settings');
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        setDlSettings(data);
      }
    } catch (e) {
      console.error('Failed to fetch downloader settings:', e);
    }
  };

  const saveDlSettings = async (e: FormEvent) => {
    e.preventDefault();
    setSavingDlSettings(true);
    setDlSavedMessage('');
    try {
      const res = await fetch('/api/downloader/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dlSettings),
      });
      if (res.ok) {
        setDlSavedMessage('Downloader settings saved successfully!');
        setTimeout(() => setDlSavedMessage(''), 3000);
      } else {
        alert('Failed to save downloader settings.');
      }
    } catch (err) {
      alert('Error saving downloader settings.');
    } finally {
      setSavingDlSettings(false);
    }
  };

  const fetchLibraries = async () => {
    try {
      const res = await fetch('/api/libraries');
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        setLibraries(await res.json());
      }
    } catch (e) {
      console.error('Failed to fetch libraries:', e);
    }
  };

  const addLibrary = async (e: FormEvent) => {
    e.preventDefault();
    if (!newLibName || !newLibPath) return;
    
    await fetch('/api/libraries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newLibName, path: newLibPath })
    });
    setNewLibName('');
    setNewLibPath('');
    fetchLibraries();
  };

  const removeLibrary = async () => {
    if (!libToRemove) return;
    try {
      const res = await fetch(`/api/libraries/${libToRemove.id}`, { method: 'DELETE' });
      if (res.ok) {
        setLibToRemove(null);
        fetchLibraries();
      } else {
        let data: any = {};
        if (res.headers.get('content-type')?.includes('application/json')) {
          try {
            data = await res.json();
          } catch (e) {
            console.error('Failed to parse error json', e);
          }
        }
        alert(`Failed to remove library: ${data.error || res.statusText || 'Unknown error'}`);
      }
    } catch (err) {
      alert('Error removing library.');
    }
  };

  const scanLibrary = async (id: number) => {
    setScanningId(id);
    await fetch(`/api/libraries/${id}/scan`, { method: 'POST' });
    setTimeout(() => {
      setScanningId(null);
      fetchLibraries();
    }, 2000);
  };

  // Update & Persist Lyrics Appearance Settings
  const updateSetting = (updater: (prev: LyricsAppearanceSettings) => LyricsAppearanceSettings) => {
    setLyricsSettings((prev) => {
      const canonicalPrev = resolveLyricsSettings(prev);
      const updated = resolveLyricsSettings(updater(canonicalPrev));
      saveLyricsSettings(updated);
      return updated;
    });
  };

  const resetLyricsToDefault = () => {
    setLyricsSettings(DEFAULT_LYRICS_SETTINGS);
    saveLyricsSettings(DEFAULT_LYRICS_SETTINGS);
  };

  if (user?.role !== 'administrator') {
    return (
      <div className="p-10 flex flex-col items-center justify-center min-h-[50vh] text-center">
        <Shield className="w-12 h-12 text-rose-500 mb-3" />
        <h2 className="text-xl font-bold text-white mb-1">Access Restricted</h2>
        <p className="text-sm text-zinc-400">Only system administrators can access system and media library settings.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-10 max-w-5xl mx-auto space-y-10 font-sans select-none">
      {/* Settings Title */}
      <div>
        <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight">Settings</h1>
        <p className="text-xs md:text-sm text-zinc-400 mt-1">
          Customize live lyrics appearance, text styles, and media library configurations.
        </p>
      </div>

      {/* ========================================================= */}
      {/* SECTION: LYRICS APPEARANCE SETTINGS                       */}
      {/* ========================================================= */}
      <section className="space-y-6">
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 text-[#FF4FA3] rounded-xl">
              <Type className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white">Lyrics Appearance</h2>
              <p className="text-xs text-zinc-400">Control font, size, weight, alignment, and spacing for host lyrics</p>
            </div>
          </div>

          <button
            onClick={resetLyricsToDefault}
            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white rounded-xl text-xs font-semibold border border-white/10 flex items-center gap-1.5 transition-colors"
            title="Reset to default appearance"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset Defaults</span>
          </button>
        </div>

        {/* Live Preview Box */}
        <div className="bg-[#08090E] border border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center min-h-[220px] shadow-2xl relative overflow-hidden">
          <div className="absolute top-3 left-4 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[#FF4FA3]">
            <Sparkles className="w-3 h-3" />
            <span>LIVE PREVIEW</span>
          </div>

          <div className="w-full h-48 flex items-center justify-center mt-4">
            <AutoResponsiveLyrics
              lyrics={[
                { time: 1, text: 'Earlier lyric line' },
                { time: 2, text: 'Previous lyric line' },
                {
                  time: 3,
                  text: 'CURRENT ACTIVE LYRIC',
                  words: [
                    { text: 'CURRENT', start: 3.0 },
                    { text: 'ACTIVE', start: 3.5 },
                    { text: 'LYRIC', start: 4.0 }
                  ]
                },
                { time: 4, text: 'Next upcoming lyric' },
                { time: 5, text: 'Later upcoming lyric' },
              ]}
              focusIndex={2}
              lyricsSettings={lyricsSettings}
              isHighlighted={lyricsSettings.highlightCurrentLine !== false}
              prev2Line={{ time: 1, text: 'Earlier lyric line' }}
              prev1Line={{ time: 2, text: 'Previous lyric line' }}
              currLine={{
                time: 3,
                text: 'CURRENT ACTIVE LYRIC',
                words: [
                  { text: 'CURRENT', start: 3.0 },
                  { text: 'ACTIVE', start: 3.5 },
                  { text: 'LYRIC', start: 4.0 }
                ]
              }}
              next1Line={{ time: 4, text: 'Next upcoming lyric' }}
              next2Line={{ time: 5, text: 'Later upcoming lyric' }}
              visibleLinesCount={lyricsSettings.visibleLines ?? 3}
              applyTextCase={applyTextCase}
              getFontFamilyStyle={getFontFamilyStyle}
              getAlignmentClass={getAlignmentClass}
              isPreview={true}
            />
          </div>
        </div>

        {/* Tab Selection Navigation */}
        <div className="flex items-center gap-2 border-b border-white/10 pb-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('highlighted')}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all whitespace-nowrap ${
              activeTab === 'highlighted'
                ? 'bg-[#FF4FA3] text-white shadow-lg shadow-[#FF4FA3]/25'
                : 'bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10'
            }`}
          >
            CURRENT / HIGHLIGHTED
          </button>
          <button
            onClick={() => setActiveTab('unhighlighted')}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all whitespace-nowrap ${
              activeTab === 'unhighlighted'
                ? 'bg-[#FF4FA3] text-white shadow-lg shadow-[#FF4FA3]/25'
                : 'bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10'
            }`}
          >
            OTHER / UNHIGHLIGHTED
          </button>
          <button
            onClick={() => setActiveTab('layout')}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all whitespace-nowrap ${
              activeTab === 'layout'
                ? 'bg-[#FF4FA3] text-white shadow-lg shadow-[#FF4FA3]/25'
                : 'bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10'
            }`}
          >
            LAYOUT & ALIGNMENT
          </button>
        </div>

        {/* Controls Body */}
        <div className="bg-[#12131D] border border-white/10 rounded-2xl p-5 md:p-6 shadow-xl">
          {/* TAB 1: CURRENT / HIGHLIGHTED SETTINGS */}
          {activeTab === 'highlighted' && (
            <div className="space-y-6">
              {/* Highlight Current Line Toggle & Color Banner */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl bg-[#08090E] border border-white/5 items-center">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-zinc-200 uppercase tracking-wider">
                      Highlight Current Line
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        updateSetting((prev) => ({
                          ...prev,
                          highlightCurrentLine: prev.highlightCurrentLine === false ? true : false
                        }))
                      }
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                        lyricsSettings.highlightCurrentLine !== false ? 'bg-[#FF4FA3]' : 'bg-white/20'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          lyricsSettings.highlightCurrentLine !== false ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Apply accent glow, custom color, and display emphasis to the active lyric line.
                  </p>
                </div>

                {/* Highlight Color Preset Picker */}
                <div>
                  <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">
                    Highlight Color
                  </label>
                  <div className="flex items-center gap-2 flex-wrap">
                    {[
                      { name: 'Neon Pink', hex: '#FF4FA3' },
                      { name: 'Cyber Cyan', hex: '#00F5D4' },
                      { name: 'Gold Yellow', hex: '#FFD166' },
                      { name: 'Electric Purple', hex: '#A78BFA' },
                      { name: 'Emerald', hex: '#10B981' },
                      { name: 'Pure White', hex: '#FFFFFF' }
                    ].map((col) => (
                      <button
                        key={col.hex}
                        type="button"
                        onClick={() =>
                          updateSetting((prev) => ({
                            ...prev,
                            highlighted: { ...prev.highlighted, color: col.hex }
                          }))
                        }
                        className={`w-7 h-7 rounded-full border-2 transition-transform ${
                          (lyricsSettings.highlighted.color || '#FF4FA3').toLowerCase() === col.hex.toLowerCase()
                            ? 'border-white scale-110 shadow-lg shadow-white/20'
                            : 'border-transparent hover:scale-105 opacity-80 hover:opacity-100'
                        }`}
                        style={{ backgroundColor: col.hex }}
                        title={col.name}
                      />
                    ))}
                    <input
                      type="color"
                      value={lyricsSettings.highlighted.color || '#FF4FA3'}
                      onChange={(e) =>
                        updateSetting((prev) => ({
                          ...prev,
                          highlighted: { ...prev.highlighted, color: e.target.value }
                        }))
                      }
                      className="w-7 h-7 rounded-lg cursor-pointer bg-transparent border-0"
                      title="Custom Color"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Font */}
                <div>
                  <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">
                    Font Family
                  </label>
                  <select
                    value={lyricsSettings.highlighted.font}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateSetting((prev) => ({
                        ...prev,
                        highlighted: { ...prev.highlighted, font: val },
                        unhighlighted: { ...prev.unhighlighted, font: val }
                      }));
                    }}
                    className="w-full bg-[#08090E] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#FF4FA3]"
                  >
                    {LYRICS_FONT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  {lyricsSettings.highlighted.font === 'custom' && (
                    <div className="mt-3 p-3 bg-white/5 border border-white/10 rounded-xl">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-zinc-300 font-medium">
                          {lyricsSettings.customFontFileName ? `Loaded: ${lyricsSettings.customFontFileName}` : 'No custom font uploaded'}
                        </span>
                        {lyricsSettings.customFontName && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const res = await fetch('/api/karaoke/settings/lyrics/custom-font', {
                                  method: 'DELETE'
                                });
                                if (!res.ok) {
                                  console.warn('Server returned error on font deletion, proceeding locally anyway.');
                                }
                              } catch (e) {
                                console.error('Failed to delete custom font:', e);
                              }
                              updateSetting((prev) => ({
                                ...prev,
                                customFontName: null,
                                customFontFileName: null,
                                customFontId: null,
                                customFontUrl: null,
                                customFontMime: null,
                                customFontUpdatedAt: null,
                                highlighted: { ...prev.highlighted, font: 'manrope' },
                                unhighlighted: { ...prev.unhighlighted, font: 'manrope' }
                              }));
                            }}
                            className="text-xs text-rose-400 hover:text-rose-300 underline"
                          >
                            Remove Font
                          </button>
                        )}
                      </div>
                      <input
                        type="file"
                        accept=".ttf,.otf,.woff,.woff2"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          try {
                            const res = await fetch('/api/karaoke/settings/lyrics/custom-font?filename=' + encodeURIComponent(file.name), {
                              method: 'POST',
                              headers: {
                                'x-font-filename': encodeURIComponent(file.name),
                                'Content-Type': file.type || 'application/octet-stream'
                              },
                              body: file
                            });
                            
                            if (!res.ok) {
                              const errorData = await res.json().catch(() => ({}));
                              throw new Error(errorData.error || 'Failed to upload custom font to server');
                            }
                            
                            const data = await res.json();
                            if (data && data.settings) {
                              const canonical = resolveLyricsSettings(data.settings);
                              setLyricsSettings(canonical);
                              saveLyricsSettings(canonical);
                            }
                          } catch (err: any) {
                            console.error('Failed to upload custom font:', err);
                            alert(err.message || 'Failed to upload custom font file. Please ensure it is a valid TTF, OTF, WOFF, or WOFF2 file.');
                          }
                        }}
                        className="block w-full text-xs text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[#FF4FA3] file:text-white hover:file:bg-[#e03d90] cursor-pointer"
                      />
                    </div>
                  )}
                </div>

                {/* Weight */}
                <div>
                  <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">
                    Font Weight
                  </label>
                  <select
                    value={lyricsSettings.highlighted.weight}
                    onChange={(e) =>
                      updateSetting((prev) => ({
                        ...prev,
                        highlighted: { ...prev.highlighted, weight: e.target.value }
                      }))
                    }
                    className="w-full bg-[#08090E] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#FF4FA3]"
                  >
                    <option value="100">Thin (100)</option>
                    <option value="300">Light (300)</option>
                    <option value="400">Regular (400)</option>
                    <option value="500">Medium (500)</option>
                    <option value="600">Semi Bold (600)</option>
                    <option value="700">Bold (700)</option>
                    <option value="800">Extra Bold (800)</option>
                    <option value="900">Black (900)</option>
                  </select>
                </div>

                {/* Size */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                      Font Size
                    </label>
                    <span className="text-xs font-mono text-[#FF4FA3] font-bold">
                      {lyricsSettings.highlighted.size}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min="24"
                    max="80"
                    value={lyricsSettings.highlighted.size}
                    onChange={(e) =>
                      updateSetting((prev) => ({
                        ...prev,
                        highlighted: { ...prev.highlighted, size: Number(e.target.value) }
                      }))
                    }
                    className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#FF4FA3]"
                  />
                </div>

                {/* Opacity */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                      Opacity
                    </label>
                    <span className="text-xs font-mono text-[#FF4FA3] font-bold">
                      {Math.round((lyricsSettings.highlighted.opacity ?? 1.0) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.2"
                    max="1.0"
                    step="0.05"
                    value={lyricsSettings.highlighted.opacity ?? 1.0}
                    onChange={(e) =>
                      updateSetting((prev) => ({
                        ...prev,
                        highlighted: { ...prev.highlighted, opacity: Number(e.target.value) }
                      }))
                    }
                    className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#FF4FA3]"
                  />
                </div>

                {/* Text Case */}
                <div>
                  <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">
                    Text Case
                  </label>
                  <select
                    value={lyricsSettings.highlighted.textCase}
                    onChange={(e) =>
                      updateSetting((prev) => ({
                        ...prev,
                        highlighted: {
                          ...prev.highlighted,
                          textCase: e.target.value as any
                        }
                      }))
                    }
                    className="w-full bg-[#08090E] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#FF4FA3]"
                  >
                    <option value="original">Original</option>
                    <option value="lowercase">lowercase</option>
                    <option value="uppercase">UPPERCASE</option>
                    <option value="titlecase">Title Case</option>
                  </select>
                </div>

                {/* Letter Spacing */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                      Letter Spacing
                    </label>
                    <span className="text-xs font-mono text-[#FF4FA3] font-bold">
                      {lyricsSettings.highlighted.letterSpacing}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-4"
                    max="12"
                    value={lyricsSettings.highlighted.letterSpacing}
                    onChange={(e) =>
                      updateSetting((prev) => ({
                        ...prev,
                        highlighted: { ...prev.highlighted, letterSpacing: Number(e.target.value) }
                      }))
                    }
                    className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#FF4FA3]"
                  />
                </div>

                {/* Line Spacing */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                      Line Spacing (Height)
                    </label>
                    <span className="text-xs font-mono text-[#FF4FA3] font-bold">
                      {lyricsSettings.highlighted.lineSpacing}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min="1.0"
                    max="2.2"
                    step="0.05"
                    value={lyricsSettings.highlighted.lineSpacing}
                    onChange={(e) =>
                      updateSetting((prev) => ({
                        ...prev,
                        highlighted: { ...prev.highlighted, lineSpacing: Number(e.target.value) }
                      }))
                    }
                    className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#FF4FA3]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: OTHER / UNHIGHLIGHTED SETTINGS */}
          {activeTab === 'unhighlighted' && (
            <div className="space-y-6">
              {/* Unhighlighted Color Banner */}
              <div className="p-4 rounded-xl bg-[#08090E] border border-white/5">
                <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">
                  Inactive Lyric Color
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  {[
                    { name: 'Light Zinc', hex: '#d4d4d8' },
                    { name: 'Pure White', hex: '#FFFFFF' },
                    { name: 'Muted Slate', hex: '#94a3b8' },
                    { name: 'Warm Sand', hex: '#fde68a' },
                    { name: 'Muted Violet', hex: '#c4b5fd' }
                  ].map((col) => (
                    <button
                      key={col.hex}
                      type="button"
                      onClick={() =>
                        updateSetting((prev) => ({
                          ...prev,
                          unhighlighted: { ...prev.unhighlighted, color: col.hex }
                        }))
                      }
                      className={`w-7 h-7 rounded-full border-2 transition-transform ${
                        (lyricsSettings.unhighlighted.color || '#d4d4d8').toLowerCase() === col.hex.toLowerCase()
                          ? 'border-white scale-110 shadow-lg shadow-white/20'
                          : 'border-transparent hover:scale-105 opacity-80 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: col.hex }}
                      title={col.name}
                    />
                  ))}
                  <input
                    type="color"
                    value={lyricsSettings.unhighlighted.color || '#d4d4d8'}
                    onChange={(e) =>
                      updateSetting((prev) => ({
                        ...prev,
                        unhighlighted: { ...prev.unhighlighted, color: e.target.value }
                      }))
                    }
                    className="w-7 h-7 rounded-lg cursor-pointer bg-transparent border-0"
                    title="Custom Color"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Font */}
                <div>
                  <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">
                    Font Family
                  </label>
                  <select
                    value={lyricsSettings.unhighlighted.font}
                    onChange={(e) =>
                      updateSetting((prev) => ({
                        ...prev,
                        unhighlighted: { ...prev.unhighlighted, font: e.target.value }
                      }))
                    }
                    className="w-full bg-[#08090E] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#FF4FA3]"
                  >
                    {LYRICS_FONT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Weight */}
                <div>
                  <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">
                    Font Weight
                  </label>
                  <select
                    value={lyricsSettings.unhighlighted.weight}
                    onChange={(e) =>
                      updateSetting((prev) => ({
                        ...prev,
                        unhighlighted: { ...prev.unhighlighted, weight: e.target.value }
                      }))
                    }
                    className="w-full bg-[#08090E] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#FF4FA3]"
                  >
                    <option value="100">Thin (100)</option>
                    <option value="300">Light (300)</option>
                    <option value="400">Regular (400)</option>
                    <option value="500">Medium (500)</option>
                    <option value="600">Semi Bold (600)</option>
                    <option value="700">Bold (700)</option>
                    <option value="800">Extra Bold (800)</option>
                    <option value="900">Black (900)</option>
                  </select>
                </div>

                {/* Size */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                      Font Size
                    </label>
                    <span className="text-xs font-mono text-[#FF4FA3] font-bold">
                      {lyricsSettings.unhighlighted.size}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min="12"
                    max="44"
                    value={lyricsSettings.unhighlighted.size}
                    onChange={(e) =>
                      updateSetting((prev) => ({
                        ...prev,
                        unhighlighted: { ...prev.unhighlighted, size: Number(e.target.value) }
                      }))
                    }
                    className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#FF4FA3]"
                  />
                </div>

                {/* Opacity */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                      Opacity
                    </label>
                    <span className="text-xs font-mono text-[#FF4FA3] font-bold">
                      {Math.round((lyricsSettings.unhighlighted.opacity ?? 0.45) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.10"
                    max="1.0"
                    step="0.05"
                    value={lyricsSettings.unhighlighted.opacity ?? 0.45}
                    onChange={(e) =>
                      updateSetting((prev) => ({
                        ...prev,
                        unhighlighted: { ...prev.unhighlighted, opacity: Number(e.target.value) }
                      }))
                    }
                    className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#FF4FA3]"
                  />
                </div>

                {/* Text Case */}
                <div>
                  <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">
                    Text Case
                  </label>
                  <select
                    value={lyricsSettings.unhighlighted.textCase}
                    onChange={(e) =>
                      updateSetting((prev) => ({
                        ...prev,
                        unhighlighted: {
                          ...prev.unhighlighted,
                          textCase: e.target.value as any
                        }
                      }))
                    }
                    className="w-full bg-[#08090E] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-[#FF4FA3]"
                  >
                    <option value="original">Original</option>
                    <option value="lowercase">lowercase</option>
                    <option value="uppercase">UPPERCASE</option>
                    <option value="titlecase">Title Case</option>
                  </select>
                </div>

                {/* Letter Spacing */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                      Letter Spacing
                    </label>
                    <span className="text-xs font-mono text-[#FF4FA3] font-bold">
                      {lyricsSettings.unhighlighted.letterSpacing}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-4"
                    max="12"
                    value={lyricsSettings.unhighlighted.letterSpacing}
                    onChange={(e) =>
                      updateSetting((prev) => ({
                        ...prev,
                        unhighlighted: { ...prev.unhighlighted, letterSpacing: Number(e.target.value) }
                      }))
                    }
                    className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#FF4FA3]"
                  />
                </div>

                {/* Line Spacing */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                      Line Spacing (Height)
                    </label>
                    <span className="text-xs font-mono text-[#FF4FA3] font-bold">
                      {lyricsSettings.unhighlighted.lineSpacing}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min="1.0"
                    max="2.2"
                    step="0.05"
                    value={lyricsSettings.unhighlighted.lineSpacing}
                    onChange={(e) =>
                      updateSetting((prev) => ({
                        ...prev,
                        unhighlighted: { ...prev.unhighlighted, lineSpacing: Number(e.target.value) }
                      }))
                    }
                    className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#FF4FA3]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: LAYOUT & TEXT ALIGNMENT SETTINGS */}
          {activeTab === 'layout' && (
            <div className="space-y-8">
              {/* Text Alignment */}
              <div>
                <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-3">
                  Text Alignment
                </label>
                <div className="grid grid-cols-3 gap-3 max-w-md">
                  <button
                    type="button"
                    onClick={() =>
                      updateSetting((prev) => ({ ...prev, alignment: 'left' }))
                    }
                    className={`py-3.5 px-4 rounded-2xl border font-bold text-xs flex flex-col items-center gap-2 transition-all ${
                      lyricsSettings.alignment === 'left'
                        ? 'bg-[#FF4FA3] text-white border-[#FF4FA3] shadow-lg shadow-[#FF4FA3]/25'
                        : 'bg-[#08090E] text-zinc-400 border-white/10 hover:text-white hover:border-white/20'
                    }`}
                  >
                    <AlignLeft className="w-5 h-5" />
                    <span>Left</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      updateSetting((prev) => ({ ...prev, alignment: 'center' }))
                    }
                    className={`py-3.5 px-4 rounded-2xl border font-bold text-xs flex flex-col items-center gap-2 transition-all ${
                      lyricsSettings.alignment === 'center'
                        ? 'bg-[#FF4FA3] text-white border-[#FF4FA3] shadow-lg shadow-[#FF4FA3]/25'
                        : 'bg-[#08090E] text-zinc-400 border-white/10 hover:text-white hover:border-white/20'
                    }`}
                  >
                    <AlignCenter className="w-5 h-5" />
                    <span>Centre</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      updateSetting((prev) => ({ ...prev, alignment: 'right' }))
                    }
                    className={`py-3.5 px-4 rounded-2xl border font-bold text-xs flex flex-col items-center gap-2 transition-all ${
                      lyricsSettings.alignment === 'right'
                        ? 'bg-[#FF4FA3] text-white border-[#FF4FA3] shadow-lg shadow-[#FF4FA3]/25'
                        : 'bg-[#08090E] text-zinc-400 border-white/10 hover:text-white hover:border-white/20'
                    }`}
                  >
                    <AlignRight className="w-5 h-5" />
                    <span>Right</span>
                  </button>
                </div>
                <p className="text-xs text-zinc-500 mt-2">
                  Controls horizontal alignment of lyric text. The lyrics block remains top-anchored.
                </p>
              </div>

              {/* Visible Lines Count */}
              <div>
                <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-3">
                  Visible Line Count
                </label>
                <div className="grid grid-cols-3 gap-3 max-w-md">
                  {[
                    { count: 1, label: '1 Line', desc: 'Current Only' },
                    { count: 3, label: '3 Lines', desc: 'Prev / Current / Next' },
                    { count: 5, label: '5 Lines', desc: 'Extended Context' }
                  ].map((item) => (
                    <button
                      key={item.count}
                      type="button"
                      onClick={() =>
                        updateSetting((prev) => ({ ...prev, visibleLines: item.count }))
                      }
                      className={`py-3 px-3 rounded-2xl border font-bold text-xs flex flex-col items-center gap-1 transition-all ${
                        (lyricsSettings.visibleLines ?? 3) === item.count
                          ? 'bg-[#FF4FA3] text-white border-[#FF4FA3] shadow-lg shadow-[#FF4FA3]/25'
                          : 'bg-[#08090E] text-zinc-400 border-white/10 hover:text-white hover:border-white/20'
                      }`}
                    >
                      <span className="text-sm font-black">{item.label}</span>
                      <span className="text-[10px] font-normal opacity-80">{item.desc}</span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-zinc-500 mt-2">
                  Controls how many lines of context are shown simultaneously on the Host Room screen.
                </p>
              </div>

              {/* Transition / Animation Duration */}
              <div>
                <div className="flex justify-between items-center mb-2 max-w-md">
                  <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                    Lyric Transition Speed
                  </label>
                  <span className="text-xs font-mono text-[#FF4FA3] font-bold">
                    {lyricsSettings.animationDuration ?? 0.25}s
                  </span>
                </div>
                <div className="max-w-md">
                  <input
                    type="range"
                    min="0.05"
                    max="0.80"
                    step="0.05"
                    value={lyricsSettings.animationDuration ?? 0.25}
                    onChange={(e) =>
                      updateSetting((prev) => ({
                        ...prev,
                        animationDuration: Number(e.target.value)
                      }))
                    }
                    className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#FF4FA3]"
                  />
                  <div className="flex justify-between text-[10px] text-zinc-500 mt-1 font-mono">
                    <span>Fast (0.05s)</span>
                    <span>Standard (0.25s)</span>
                    <span>Smooth (0.80s)</span>
                  </div>
                </div>
              </div>

              {/* ELRC Transition Mode */}
              <div className="pt-4 border-t border-white/10">
                <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">
                  ELRC Transition
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
                  {[
                    {
                      id: 'smooth_sweep',
                      label: 'Smooth Sweep',
                      desc: 'The highlight smoothly travels across each word from left to right using the ELRC timestamps.'
                    },
                    {
                      id: 'karaoke',
                      label: 'Karaoke',
                      desc: 'Preserve the existing karaoke-style ELRC behavior (past + current accumulate).'
                    },
                    {
                      id: 'current_only',
                      label: 'Current Word',
                      desc: 'Preserve the existing current-word highlighting behavior.'
                    },
                    {
                      id: 'instant',
                      label: 'Instant',
                      desc: "When a word's timestamp is reached, the entire word becomes highlighted immediately."
                    }
                  ].map((mode) => {
                    const activeMode = lyricsSettings.elrcTransition || lyricsSettings.elrcHighlightMode || 'smooth_sweep';
                    const isSelected = activeMode === mode.id || (activeMode === 'progressive_sweeping' && mode.id === 'smooth_sweep');

                    return (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() =>
                          updateSetting((prev) => ({
                            ...prev,
                            elrcTransition: mode.id as any,
                            elrcHighlightMode: mode.id as any
                          }))
                        }
                        className={`py-3.5 px-4 rounded-2xl border font-bold text-xs flex flex-col items-start gap-1.5 transition-all text-left ${
                          isSelected
                            ? 'bg-[#FF4FA3] text-white border-[#FF4FA3] shadow-lg shadow-[#FF4FA3]/25 ring-2 ring-[#FF4FA3]/30'
                            : 'bg-[#08090E] text-zinc-400 border-white/10 hover:text-white hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="text-sm font-black">{mode.label}</span>
                          {isSelected && (
                            <span className="px-2 py-0.5 bg-white/20 text-white rounded-full text-[10px] font-extrabold uppercase">
                              Active
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] font-normal leading-relaxed opacity-85">{mode.desc}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-zinc-500 mt-2.5">
                  Controls word-level visual transitions and highlighting behavior for Enhanced LRC (.elrc.lrc) files.
                </p>
              </div>

              {/* Word Highlight Animation */}
              <div className="pt-4 border-t border-white/10">
                <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider mb-2">
                  Word Highlight Animation
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-xl">
                  {[
                    { id: 'smooth', label: 'Smooth', desc: 'Smooth transition (default)' },
                    { id: 'instant', label: 'Instant', desc: 'Immediate change' },
                    { id: 'fade', label: 'Fade', desc: 'Soft crossfade' },
                    { id: 'off', label: 'Off', desc: 'No animation' }
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        updateSetting((prev) => ({ ...prev, wordHighlightAnimation: item.id as any }))
                      }
                      className={`py-3 px-3 rounded-2xl border font-bold text-xs flex flex-col items-center gap-1 transition-all ${
                        (lyricsSettings.wordHighlightAnimation || 'smooth') === item.id
                          ? 'bg-[#FF4FA3] text-white border-[#FF4FA3] shadow-lg shadow-[#FF4FA3]/25'
                          : 'bg-[#08090E] text-zinc-400 border-white/10 hover:text-white hover:border-white/20'
                      }`}
                    >
                      <span className="text-sm font-black">{item.label}</span>
                      <span className="text-[10px] font-normal opacity-80 text-center">{item.desc}</span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-zinc-500 mt-2">
                  Controls the visual animation transition when advancing between words in eLRC lyrics.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ========================================================= */}
      {/* SECTION: DOWNLOAD MUSIC CONFIGURATION                     */}
      {/* ========================================================= */}
      <section className="space-y-6 pt-6 border-t border-white/10">
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 text-[#FF4FA3] rounded-xl">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white">Music Downloader Settings</h2>
              <p className="text-xs text-zinc-400">Configure default save location, audio formats, bitrate quality, and metadata tagging</p>
            </div>
          </div>
        </div>

        <form onSubmit={saveDlSettings} className="bg-[#141622] border border-white/10 rounded-2xl p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Target Library Folder */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider">
                Default Download Library
              </label>
              <select
                value={dlSettings.libraryId}
                onChange={(e) => setDlSettings({ ...dlSettings, libraryId: e.target.value })}
                className="w-full bg-[#08090E] border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-[#FF4FA3]"
              >
                {libraries.map((lib) => (
                  <option key={lib.id} value={lib.id}>
                    {lib.name} ({lib.path})
                  </option>
                ))}
                {libraries.length === 0 && <option value="">No media libraries configured</option>}
              </select>
              <p className="text-[11px] text-zinc-500">
                Downloaded tracks will be saved directly into this media library path and indexed automatically.
              </p>
            </div>

            {/* Audio Format */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider">
                Audio Output Format
              </label>
              <select
                value={dlSettings.format}
                onChange={(e) => setDlSettings({ ...dlSettings, format: e.target.value })}
                className="w-full bg-[#08090E] border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-[#FF4FA3] font-mono"
              >
                <option value="mp3">MP3 (Recommended for maximum compatibility)</option>
                <option value="m4a">M4A (AAC Audio)</option>
                <option value="flac">FLAC (Lossless Audio)</option>
                <option value="wav">WAV (Uncompressed Waveform)</option>
                <option value="opus">OPUS (High-efficiency Opus Audio)</option>
              </select>
            </div>

            {/* Quality Bitrate */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider">
                Default Audio Quality
              </label>
              <select
                value={dlSettings.quality}
                onChange={(e) => setDlSettings({ ...dlSettings, quality: e.target.value })}
                className="w-full bg-[#08090E] border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-[#FF4FA3] font-mono"
              >
                <option value="320k">320 kbps (High Quality Constant Bitrate)</option>
                <option value="256k">256 kbps (Standard High Quality)</option>
                <option value="192k">192 kbps (Medium Bitrate)</option>
                <option value="128k">128 kbps (Compact Storage)</option>
              </select>
            </div>

            {/* Folder Naming Pattern */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-zinc-300 uppercase tracking-wider">
                Folder / File Naming Pattern (Downtify Standard)
              </label>
              <input
                type="text"
                value={dlSettings.folderStructure}
                onChange={(e) => setDlSettings({ ...dlSettings, folderStructure: e.target.value })}
                placeholder="{artist}/{artist} - {title}"
                className="w-full bg-[#08090E] border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-[#FF4FA3] font-mono"
              />
              <p className="text-[11px] text-zinc-500">
                Standard format: <code className="text-[#FF4FA3]">/media/&lt;Artist&gt;/&lt;Artist&gt; - &lt;Title&gt;.mp3</code> + matching <code className="text-[#FF4FA3]">.lrc</code> sidecar
              </p>
            </div>
          </div>

          {/* Toggle Switches & Lyrics Options */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-white/5">
            <label className="flex items-center justify-between p-3.5 bg-[#08090E] border border-white/5 rounded-xl cursor-pointer">
              <span className="text-xs font-semibold text-white">Embed ID3 Metadata Tags</span>
              <input
                type="checkbox"
                checked={dlSettings.embedMetadata}
                onChange={(e) => setDlSettings({ ...dlSettings, embedMetadata: e.target.checked })}
                className="w-4 h-4 rounded text-[#FF4FA3] focus:ring-[#FF4FA3] accent-[#FF4FA3]"
              />
            </label>

            <label className="flex items-center justify-between p-3.5 bg-[#08090E] border border-white/5 rounded-xl cursor-pointer">
              <span className="text-xs font-semibold text-white">Embed High-Res Cover Artwork</span>
              <input
                type="checkbox"
                checked={dlSettings.embedArtwork}
                onChange={(e) => setDlSettings({ ...dlSettings, embedArtwork: e.target.checked })}
                className="w-4 h-4 rounded text-[#FF4FA3] focus:ring-[#FF4FA3] accent-[#FF4FA3]"
              />
            </label>

            <label className="flex items-center justify-between p-3.5 bg-[#08090E] border border-white/5 rounded-xl cursor-pointer">
              <div>
                <span className="text-xs font-semibold text-white block">Download Synced Lyrics (.lrc)</span>
                <span className="text-[11px] text-zinc-500 block">Fetch time-synced lyrics from LRCLIB and save sidecar .lrc files</span>
              </div>
              <input
                type="checkbox"
                checked={dlSettings.downloadLyrics}
                onChange={(e) => setDlSettings({ ...dlSettings, downloadLyrics: e.target.checked })}
                className="w-4 h-4 rounded text-[#FF4FA3] focus:ring-[#FF4FA3] accent-[#FF4FA3]"
              />
            </label>

            <div className={`p-3.5 bg-[#08090E] border border-white/5 rounded-xl space-y-2 transition-opacity ${!dlSettings.downloadLyrics ? 'opacity-40 pointer-events-none' : ''}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">Lyrics Provider</span>
                <span className="text-[10px] text-zinc-500 font-mono">only lrclib is active</span>
              </div>
              <select
                disabled={!dlSettings.downloadLyrics}
                value={dlSettings.lyricsProviders?.[0] || 'lrclib'}
                onChange={(e) => setDlSettings({ ...dlSettings, lyricsProviders: [e.target.value] })}
                className="w-full bg-[#141622] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#FF4FA3] font-mono"
              >
                <option value="lrclib">lrclib (Active - https://lrclib.net)</option>
                <option value="genius">genius (Legacy)</option>
                <option value="musixmatch">musixmatch (Legacy)</option>
                <option value="azlyrics">azlyrics (Legacy)</option>
              </select>
            </div>

            {/* eLRC Line Lead-In (Word-Synced Lyrics Offset) */}
            <div className="p-3.5 bg-[#08090E] border border-white/5 rounded-xl space-y-2 md:col-span-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold text-white block">eLRC Line Lead-In (ms)</span>
                  <span className="text-[11px] text-zinc-500 block">
                    How many milliseconds before the first word an eLRC outer line timestamp appears.
                  </span>
                </div>
                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <input
                    type="number"
                    min={0}
                    max={5000}
                    step={50}
                    value={dlSettings.elrcLineLeadInMs ?? 500}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setDlSettings({
                        ...dlSettings,
                        elrcLineLeadInMs: isNaN(val) ? 500 : Math.max(0, Math.min(5000, val)),
                      });
                    }}
                    className="w-24 px-3 py-1.5 bg-[#141622] border border-white/10 rounded-lg text-xs font-mono text-white text-right focus:outline-none focus:border-[#FF4FA3]"
                  />
                  <span className="text-xs text-zinc-400 font-mono font-medium">ms</span>
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#141622]/70 border border-white/5 text-[11px] text-zinc-400 flex flex-wrap items-center justify-between gap-2 font-mono">
                <span className="text-zinc-500">Preview (First word at 01:24.00):</span>
                <span>
                  Line appears at:{' '}
                  <strong className="text-[#FF4FA3] font-semibold">
                    {(() => {
                      const leadMs = dlSettings.elrcLineLeadInMs ?? 500;
                      const wordSec = 84.0; // 01:24.00
                      const leadSec = Math.max(0, Math.min(5000, leadMs)) / 1000;
                      const lineSec = Math.max(0, Math.round((wordSec - leadSec) * 100) / 100);
                      const m = Math.floor(lineSec / 60);
                      const s = Math.floor(lineSec % 60);
                      const cs = Math.round((lineSec % 1) * 100);
                      return `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}] <01:24.00>First <01:24.40>word`;
                    })()}
                  </strong>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            {dlSavedMessage && (
              <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                <Check className="w-4 h-4" />
                <span>{dlSavedMessage}</span>
              </span>
            )}
            <button
              type="submit"
              disabled={savingDlSettings}
              className="ml-auto px-6 py-2.5 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white font-bold text-xs rounded-xl shadow-lg shadow-[#FF4FA3]/20 flex items-center gap-2 transition-all"
            >
              <Save className="w-4 h-4" />
              <span>{savingDlSettings ? 'Saving...' : 'Save Downloader Settings'}</span>
            </button>
          </div>
        </form>
      </section>

      {/* ========================================================= */}
      {/* SECTION: BACKGROUND MUSIC                                 */}
      {/* ========================================================= */}
      <section className="space-y-6 pt-6 border-t border-white/10" id="section-background-music">
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 text-[#FF4FA3] rounded-xl">
              <Music className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white">Background Music</h2>
              <p className="text-xs text-zinc-400">Configure ambient music playback from your local library when the karaoke room queue is empty</p>
            </div>
          </div>
        </div>

        <div className="bg-[#141622] border border-white/10 rounded-2xl p-6 space-y-6">
          <div className="space-y-4">
            {/* Enable Toggle */}
            <div className="flex items-center justify-between p-4 bg-[#08090E] border border-white/5 rounded-xl">
              <div>
                <span className="text-sm font-bold text-white block">Enable Background Music</span>
                <span className="text-xs text-zinc-400">
                  Automatically play ambient songs from your local music library when no karaoke tracks are queued or playing.
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
                <input
                  type="checkbox"
                  checked={bgmSettings.enabled}
                  onChange={(e) => saveBgm({ ...bgmSettings, enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FF4FA3]"></div>
              </label>
            </div>

            {/* Music Source (Playlist Selection Dropdown) */}
            <div className="p-4 bg-[#08090E] border border-white/5 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ListMusic className="w-4 h-4 text-[#FF4FA3]" />
                  <div>
                    <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider block">Music Source</span>
                    <span className="text-xs text-zinc-400">
                      Choose which playlist supplies background music, or play all local tracks.
                    </span>
                  </div>
                </div>
                <span className="text-[11px] font-mono text-zinc-400 bg-white/5 px-2.5 py-1 rounded-lg">
                  {bgmSettings.playlistId ? 'Playlist' : 'All Local Music'}
                </span>
              </div>
              <select
                aria-label="Background Music Source Playlist"
                value={bgmSettings.playlistId || ''}
                onChange={(e) => {
                  const val = e.target.value === '' ? null : e.target.value;
                  const updated = { ...bgmSettings, playlistId: val };
                  setBgmSettings(updated);
                  saveBgm(updated);
                }}
                className="w-full bg-[#141622] text-white text-xs font-medium border border-white/10 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#FF4FA3] cursor-pointer"
              >
                <option value="">All Local Music</option>
                {playlists.map((pl) => (
                  <option key={pl.id} value={String(pl.id)}>
                    {pl.name} ({pl.songCount || 0} {pl.songCount === 1 ? 'song' : 'songs'})
                  </option>
                ))}
              </select>
            </div>

            {/* Background Music Audio Mode */}
            <div className="p-4 bg-[#08090E] border border-white/5 rounded-xl space-y-3" id="bgm-audio-mode-setting">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Music className="w-4 h-4 text-[#FF4FA3]" />
                  <div>
                    <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider block">Background Music Audio Mode</span>
                    <span className="text-xs text-zinc-400">
                      Choose whether ambient music plays original vocal tracks, instrumental backing tracks, or both.
                    </span>
                  </div>
                </div>
                <span className="text-[11px] font-mono text-zinc-400 bg-white/5 px-2.5 py-1 rounded-lg">
                  {bgmSettings.audioMode === 'instrumental'
                    ? 'Instrumental Only'
                    : bgmSettings.audioMode === 'original'
                    ? 'Original Only'
                    : 'Both (Default)'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2.5 pt-1">
                <button
                  type="button"
                  data-testid="bgm-audio-mode-both-btn"
                  onClick={() => {
                    const updated = { ...bgmSettings, audioMode: 'both' as BackgroundMusicAudioMode };
                    setBgmSettings(updated);
                    saveBgm(updated);
                  }}
                  className={`px-3 py-2.5 rounded-xl text-xs font-bold transition-all border flex items-center justify-center gap-2 cursor-pointer ${
                    bgmSettings.audioMode === 'both'
                      ? 'bg-[#FF4FA3] text-white border-[#FF4FA3] shadow-lg shadow-[#FF4FA3]/25'
                      : 'bg-[#141622] text-zinc-400 border-white/10 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <Music className="w-3.5 h-3.5" />
                  <span>Both</span>
                </button>
                <button
                  type="button"
                  data-testid="bgm-audio-mode-instrumental-btn"
                  onClick={() => {
                    const updated = { ...bgmSettings, audioMode: 'instrumental' as BackgroundMusicAudioMode };
                    setBgmSettings(updated);
                    saveBgm(updated);
                  }}
                  className={`px-3 py-2.5 rounded-xl text-xs font-bold transition-all border flex items-center justify-center gap-2 cursor-pointer ${
                    bgmSettings.audioMode === 'instrumental'
                      ? 'bg-[#FF4FA3] text-white border-[#FF4FA3] shadow-lg shadow-[#FF4FA3]/25'
                      : 'bg-[#141622] text-zinc-400 border-white/10 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <Music className="w-3.5 h-3.5" />
                  <span>Instrumental Only</span>
                </button>
                <button
                  type="button"
                  data-testid="bgm-audio-mode-original-btn"
                  onClick={() => {
                    const updated = { ...bgmSettings, audioMode: 'original' as BackgroundMusicAudioMode };
                    setBgmSettings(updated);
                    saveBgm(updated);
                  }}
                  className={`px-3 py-2.5 rounded-xl text-xs font-bold transition-all border flex items-center justify-center gap-2 cursor-pointer ${
                    bgmSettings.audioMode === 'original'
                      ? 'bg-[#FF4FA3] text-white border-[#FF4FA3] shadow-lg shadow-[#FF4FA3]/25'
                      : 'bg-[#141622] text-zinc-400 border-white/10 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <Music className="w-3.5 h-3.5" />
                  <span>Original Only</span>
                </button>
              </div>

              <select
                id="bgm-audio-mode-select"
                aria-label="Background Music Audio Mode"
                value={bgmSettings.audioMode || 'both'}
                onChange={(e) => {
                  const val = e.target.value as BackgroundMusicAudioMode;
                  const updated = { ...bgmSettings, audioMode: val };
                  setBgmSettings(updated);
                  saveBgm(updated);
                }}
                className="w-full bg-[#141622] text-white text-xs font-medium border border-white/10 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#FF4FA3] cursor-pointer"
              >
                <option value="both">Both</option>
                <option value="instrumental">Instrumental Only</option>
                <option value="original">Original Only</option>
              </select>
            </div>

            {/* Playback Mode (Shuffled) */}
            <div className="p-4 bg-[#08090E] border border-white/5 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Shuffle className="w-4 h-4 text-[#FF4FA3]" />
                <div>
                  <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider block">Playback Mode</span>
                  <span className="text-xs text-zinc-400">Continuous shuffle without repeats until all eligible library tracks have played</span>
                </div>
              </div>
              <span className="text-[11px] font-mono text-zinc-500 bg-white/5 px-2.5 py-1 rounded-lg">Continuous Shuffle</span>
            </div>

            {/* Background Volume Slider */}
            <div className="p-4 bg-[#08090E] border border-white/5 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-[#FF4FA3]" />
                  <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">Background Music Volume</span>
                </div>
                <span className="text-xs font-mono font-bold text-[#FF4FA3]">{bgmSettings.volume}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={bgmSettings.volume}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setBgmSettings({ ...bgmSettings, volume: val });
                }}
                onMouseUp={() => saveBgm(bgmSettings)}
                onTouchEnd={() => saveBgm(bgmSettings)}
                className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#FF4FA3] focus:outline-none focus:ring-2 focus:ring-[#FF4FA3]"
              />
              <p className="text-[11px] text-zinc-500">
                Independent volume control for ambient background music. Does not affect host karaoke volume. Default is 25%.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            {bgmSavedMessage && (
              <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                <Check className="w-4 h-4" />
                <span>{bgmSavedMessage}</span>
              </span>
            )}
            <button
              type="button"
              onClick={() => saveBgm(bgmSettings)}
              disabled={savingBgmSettings}
              className="ml-auto px-6 py-2.5 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white font-bold text-xs rounded-xl shadow-lg shadow-[#FF4FA3]/20 flex items-center gap-2 transition-all disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{savingBgmSettings ? 'Saving...' : 'Save Background Music Settings'}</span>
            </button>
          </div>
        </div>
      </section>

      {/* ========================================================= */}
      {/* SECTION: KARAOKE STARTUP DEFAULTS                         */}
      {/* ========================================================= */}
      <section className="space-y-6 pt-6 border-t border-white/10" id="section-karaoke-defaults">
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 text-[#FF4FA3] rounded-xl">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white">Karaoke Defaults</h2>
              <p className="text-xs text-zinc-400">Configure startup audio and lyrics preferences when a new karaoke room starts</p>
            </div>
          </div>
        </div>

        <div className="bg-[#141622] border border-white/10 rounded-2xl p-6 space-y-6">
          <div className="space-y-4">
            {/* Default Audio Mode */}
            <div className="p-4 bg-[#08090E] border border-white/5 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Music className="w-4 h-4 text-[#FF4FA3]" />
                  <div>
                    <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider block">Default Audio Mode</span>
                    <span className="text-xs text-zinc-400">
                      Choose whether new karaoke rooms begin with Instrumental backing track or Original vocal track.
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-zinc-400 bg-white/5 px-2.5 py-1 rounded-lg capitalize">
                    {karaokeDefaults.audioMode === 'instrumental' ? 'Instrumental (Default)' : 'Original'}
                  </span>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  data-testid="audio-mode-instrumental-btn"
                  onClick={() => {
                    const updated = { ...karaokeDefaults, audioMode: 'instrumental' as AudioMode };
                    setKaraokeDefaults(updated);
                    saveKaraokeDefaults(updated);
                  }}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all border flex items-center justify-center gap-2 cursor-pointer ${
                    karaokeDefaults.audioMode === 'instrumental'
                      ? 'bg-[#FF4FA3] text-white border-[#FF4FA3] shadow-lg shadow-[#FF4FA3]/25'
                      : 'bg-[#141622] text-zinc-400 border-white/10 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <Music className="w-3.5 h-3.5" />
                  <span>Instrumental (Default)</span>
                </button>
                <button
                  type="button"
                  data-testid="audio-mode-original-btn"
                  onClick={() => {
                    const updated = { ...karaokeDefaults, audioMode: 'original' as AudioMode };
                    setKaraokeDefaults(updated);
                    saveKaraokeDefaults(updated);
                  }}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all border flex items-center justify-center gap-2 cursor-pointer ${
                    karaokeDefaults.audioMode === 'original'
                      ? 'bg-[#FF4FA3] text-white border-[#FF4FA3] shadow-lg shadow-[#FF4FA3]/25'
                      : 'bg-[#141622] text-zinc-400 border-white/10 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <Music className="w-3.5 h-3.5" />
                  <span>Original</span>
                </button>
              </div>

              <select
                id="default-audio-mode-select"
                aria-label="Default Audio Mode"
                value={karaokeDefaults.audioMode}
                onChange={(e) => {
                  const val = e.target.value as AudioMode;
                  const updated = { ...karaokeDefaults, audioMode: val };
                  setKaraokeDefaults(updated);
                  saveKaraokeDefaults(updated);
                }}
                className="w-full bg-[#141622] text-white text-xs font-medium border border-white/10 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#FF4FA3] cursor-pointer"
              >
                <option value="instrumental">Instrumental</option>
                <option value="original">Original</option>
              </select>
            </div>

            {/* Default Lyrics Mode */}
            <div className="p-4 bg-[#08090E] border border-white/5 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Sliders className="w-4 h-4 text-[#FF4FA3]" />
                  <div>
                    <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider block">Default Lyrics Mode</span>
                    <span className="text-xs text-zinc-400">
                      Choose whether synchronized word-by-word enhanced LRC (eLRC) or line-by-line LRC is active by default.
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-zinc-400 bg-white/5 px-2.5 py-1 rounded-lg uppercase">
                    {karaokeDefaults.lyricsMode === 'elrc' ? 'eLRC (Default)' : 'LRC'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  data-testid="lyrics-mode-elrc-btn"
                  onClick={() => {
                    const updated = { ...karaokeDefaults, lyricsMode: 'elrc' as LyricsMode };
                    setKaraokeDefaults(updated);
                    saveKaraokeDefaults(updated);
                  }}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all border flex items-center justify-center gap-2 cursor-pointer ${
                    karaokeDefaults.lyricsMode === 'elrc'
                      ? 'bg-cyan-500 text-white border-cyan-500 shadow-lg shadow-cyan-500/25'
                      : 'bg-[#141622] text-zinc-400 border-white/10 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                  <span>eLRC (Default)</span>
                </button>
                <button
                  type="button"
                  data-testid="lyrics-mode-lrc-btn"
                  onClick={() => {
                    const updated = { ...karaokeDefaults, lyricsMode: 'lrc' as LyricsMode };
                    setKaraokeDefaults(updated);
                    saveKaraokeDefaults(updated);
                  }}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all border flex items-center justify-center gap-2 cursor-pointer ${
                    karaokeDefaults.lyricsMode === 'lrc'
                      ? 'bg-cyan-500 text-white border-cyan-500 shadow-lg shadow-cyan-500/25'
                      : 'bg-[#141622] text-zinc-400 border-white/10 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                  <span>LRC</span>
                </button>
              </div>

              <select
                id="default-lyrics-mode-select"
                aria-label="Default Lyrics Mode"
                value={karaokeDefaults.lyricsMode}
                onChange={(e) => {
                  const val = e.target.value as LyricsMode;
                  const updated = { ...karaokeDefaults, lyricsMode: val };
                  setKaraokeDefaults(updated);
                  saveKaraokeDefaults(updated);
                }}
                className="w-full bg-[#141622] text-white text-xs font-medium border border-white/10 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#FF4FA3] cursor-pointer"
              >
                <option value="elrc">eLRC</option>
                <option value="lrc">LRC</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            {defaultsSavedMessage && (
              <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                <Check className="w-4 h-4" />
                <span>{defaultsSavedMessage}</span>
              </span>
            )}
            <button
              type="button"
              onClick={() => saveKaraokeDefaults(karaokeDefaults)}
              disabled={savingDefaults}
              className="ml-auto px-6 py-2.5 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white font-bold text-xs rounded-xl shadow-lg shadow-[#FF4FA3]/20 flex items-center gap-2 transition-all disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{savingDefaults ? 'Saving...' : 'Save Karaoke Defaults'}</span>
            </button>
          </div>
        </div>
      </section>

      {/* ========================================================= */}
      {/* SECTION: SYSTEM ADMINISTRATION (ADMINISTRATORS ONLY)      */}
      {/* ========================================================= */}
      {user?.role === 'administrator' && (
        <section className="space-y-4 pt-6 border-t border-white/10">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#FF4FA3]" />
            <h2 className="text-sm font-bold text-[#FF4FA3] uppercase tracking-wider">
              System Administration
            </h2>
          </div>

          <div className="flex items-center gap-2 border-b border-white/5 pb-3">
            <HardDrive className="w-5 h-5 text-[#FF4FA3]" />
            <h3 className="text-lg font-bold text-white">Media Library Directories</h3>
          </div>
          
          <div className="bg-[#141622] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#0E0F17] text-zinc-400 border-b border-white/5 text-xs font-semibold uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3.5">Name</th>
                  <th className="px-5 py-3.5">Server Directory Path</th>
                  <th className="px-5 py-3.5">Last Scanned</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {libraries.map(lib => (
                  <tr key={lib.id} className="hover:bg-[#1A1C2C]/60 transition-colors">
                    <td className="px-5 py-3.5 font-medium text-white flex items-center gap-2.5">
                      <Folder className="w-4 h-4 text-[#FF4FA3]" />
                      <span>{lib.name}</span>
                    </td>
                    <td className="px-5 py-3.5 text-zinc-400 font-mono text-xs">{lib.path}</td>
                    <td className="px-5 py-3.5 text-zinc-400 text-xs">
                      {lib.lastScan ? new Date(lib.lastScan).toLocaleString() : 'Never'}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex justify-end gap-2">
                        <button 
                          onClick={() => scanLibrary(lib.id)}
                          disabled={scanningId === lib.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1C1E2D] hover:bg-[#25283C] text-white rounded-lg text-xs font-medium border border-white/5 transition-colors disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${scanningId === lib.id ? 'animate-spin text-[#FF4FA3]' : ''}`} />
                          <span>{scanningId === lib.id ? 'Scanning' : 'Scan'}</span>
                        </button>
                        <button 
                          onClick={() => setLibToRemove(lib)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-950/30 hover:bg-red-900/50 text-red-400 rounded-lg text-xs font-medium border border-red-500/20 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Remove</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {libraries.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-zinc-500 text-sm">
                      No media libraries configured. Add a directory path below.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Add Library Card */}
          <form onSubmit={addLibrary} className="bg-[#141622] p-5 rounded-2xl border border-white/5 flex flex-col md:flex-row items-end gap-4 shadow-xl">
            <div className="flex-1 w-full">
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Library Display Name</label>
              <input 
                value={newLibName} onChange={e => setNewLibName(e.target.value)}
                placeholder="e.g. Main Karaoke Collection"
                className="w-full px-3.5 py-2.5 bg-[#0A0B10] border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-[#FF4FA3] focus:ring-1 focus:ring-[#FF4FA3] text-sm"
                required
              />
            </div>
            <div className="flex-1 w-full">
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Folder Path on Host</label>
              <input 
                value={newLibPath} onChange={e => setNewLibPath(e.target.value)}
                placeholder="e.g. /media"
                className="w-full px-3.5 py-2.5 bg-[#0A0B10] border border-white/10 rounded-xl text-white placeholder-zinc-600 font-mono text-sm focus:outline-none focus:border-[#FF4FA3] focus:ring-1 focus:ring-[#FF4FA3]"
                required
              />
            </div>
            <button 
              type="submit" 
              className="w-full md:w-auto px-5 py-2.5 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white text-sm font-semibold rounded-xl transition-all shadow-lg shadow-[#FF4FA3]/25 flex items-center justify-center gap-2 h-[42px] shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Add Library</span>
            </button>
          </form>
        </section>
      )}

      {/* Confirmation Modal */}
      {libToRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#141622] border border-white/10 rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4 text-red-400">
              <div className="w-10 h-10 rounded-xl bg-red-950/60 border border-red-500/30 flex items-center justify-center">
                <AlertCircle className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold text-white">Remove Media Library?</h3>
            </div>
            
            <p className="text-zinc-300 text-sm mb-4 leading-relaxed">
              Yimly will stop scanning this location and remove it from the catalog configuration. 
            </p>
            <div className="bg-[#0A0B10] border border-white/10 rounded-xl p-3.5 mb-4">
              <div className="text-[11px] text-zinc-500 mb-1">Path:</div>
              <code className="text-[#FF4FA3] font-mono text-xs">{libToRemove.path}</code>
            </div>
            <p className="text-zinc-400 text-xs mb-6">
              Your audio and video files will <strong className="text-white">NOT</strong> be deleted.
            </p>
            
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setLibToRemove(null)}
                className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white rounded-xl transition-colors font-semibold text-xs"
              >
                Cancel
              </button>
              <button 
                onClick={removeLibrary}
                className="px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl transition-colors font-semibold text-xs shadow-lg shadow-red-900/20"
              >
                Remove Library
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

