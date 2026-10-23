import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Settings as SettingsIcon, Save, CheckCircle2, AlertCircle } from 'lucide-react';

export default function Settings() {
  const { user } = useOutletContext<{ user: any }>() || {};
  const [settings, setSettings] = useState({
    libraryId: '1',
    format: 'mp3',
    quality: '320k',
    downloadLyrics: true,
    folderStructure: '{artist}/{artist} - {title}',
    playlistFolder: true,
    concurrency: 4,
    elrcLineLeadInMs: 500,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/downloader/settings')
      .then(res => res.json())
      .then(data => {
        if (data && !data.error) {
          setSettings(prev => ({ ...prev, ...data }));
        }
      })
      .catch(() => {});
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');

    try {
      const res = await fetch('/api/downloader/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save settings');
      setMessage('Settings saved successfully');
    } catch (err: any) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 text-zinc-100">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 bg-indigo-600/20 text-indigo-400 rounded-xl">
          <SettingsIcon className="w-8 h-8" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Downloader & System Settings</h1>
          <p className="text-zinc-400">Configure default audio formats, quality, lyrics, and storage preferences.</p>
        </div>
      </div>

      {message && (
        <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-3 text-emerald-400">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center gap-3 text-rose-400">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6 bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Audio Format</label>
            <select
              value={settings.format}
              onChange={e => setSettings(s => ({ ...s, format: e.target.value }))}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-zinc-100 focus:outline-none focus:border-indigo-500"
            >
              <option value="mp3">MP3</option>
              <option value="m4a">M4A</option>
              <option value="flac">FLAC</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Audio Quality</label>
            <select
              value={settings.quality}
              onChange={e => setSettings(s => ({ ...s, quality: e.target.value }))}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-zinc-100 focus:outline-none focus:border-indigo-500"
            >
              <option value="320k">320 kbps (High)</option>
              <option value="256k">256 kbps</option>
              <option value="192k">192 kbps</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Download Concurrency</label>
            <input
              type="number"
              min="1"
              max="16"
              value={settings.concurrency}
              onChange={e => setSettings(s => ({ ...s, concurrency: parseInt(e.target.value) || 4 }))}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-zinc-100 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">ELRC Line Lead-in (ms)</label>
            <input
              type="number"
              step="50"
              value={settings.elrcLineLeadInMs}
              onChange={e => setSettings(s => ({ ...s, elrcLineLeadInMs: parseInt(e.target.value) || 500 }))}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-zinc-100 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-zinc-800 flex items-center justify-between">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.downloadLyrics}
              onChange={e => setSettings(s => ({ ...s, downloadLyrics: e.target.checked }))}
              className="w-5 h-5 rounded border-zinc-800 bg-zinc-950 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm font-medium text-zinc-200">Automatically download synchronized lyrics (LRCLib)</span>
          </label>

          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl transition-colors disabled:opacity-50"
          >
            <Save className="w-5 h-5" />
            <span>{saving ? 'Saving...' : 'Save Settings'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
