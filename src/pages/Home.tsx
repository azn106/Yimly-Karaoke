import { useEffect, useState, useRef } from 'react';
import { useOutletContext, Link, useNavigate } from 'react-router-dom';
import { Mic, Radio, Music, ChevronRight, Sparkles, Download } from 'lucide-react';
import { getAuthToken } from '../lib/auth';

export default function Home() {
  const { user } = useOutletContext<{ user: any }>() || {};
  const navigate = useNavigate();
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const [joiningSessionId, setJoiningSessionId] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const hostButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (user?.role === 'user') {
      hostButtonRef.current?.focus();
    }
  }, [user]);

  useEffect(() => {
    async function loadDashboardData() {
      try {
        const sessionsRes = await fetch('/api/karaoke/active-sessions');
        if (sessionsRes.ok && sessionsRes.headers.get('content-type')?.includes('application/json')) {
          setActiveSessions(await sessionsRes.json());
        }
      } catch (e) {
        console.error('Failed to load dashboard data:', e);
      }
    }

    loadDashboardData();
  }, []);

  const createRoom = async () => {
    try {
      const token = getAuthToken();
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const res = await fetch('/api/karaoke/sessions', {
        method: 'POST',
        credentials: 'same-origin',
        headers
      });
      let data: any = {};
      if (res.headers.get('content-type')?.includes('application/json')) {
        try {
          data = await res.json();
        } catch (e) {
          console.error('Failed to parse json response', e);
        }
      }
      if (!res.ok) throw new Error(data.error || 'Failed to start session');
      navigate(`/rooms/${data.id}?role=host`);
    } catch (err: any) {
      alert(err.message || 'Failed to start session');
    }
  };

  const handleQueueSong = async (songId: number) => {
    try {
      if (activeSessions.length === 0) {
        alert('No active room found. Please host or join a karaoke room first.');
        navigate('/rooms');
        return;
      }
      const sessionId = activeSessions[0].id;
      const res = await fetch(`/api/karaoke/sessions/${sessionId}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId })
      });
      if (res.ok) {
        alert('Song added to karaoke queue!');
      } else {
        alert('Failed to add song to queue');
      }
    } catch (e) {
      alert('Failed to queue song');
    }
  };

  const handleJoinSession = async (s: any) => {
    if (joiningSessionId) return;
    setJoinError(null);
    setJoiningSessionId(s.id);
    try {
      if (user?.id && s.hostId === user.id) {
        navigate(`/rooms/${s.id}?role=host`);
        return;
      }
      const storageKey = `yimly_controller_${s.id}`;
      const storedControllerId = localStorage.getItem(storageKey);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = getAuthToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch('/api/karaoke/sessions/join', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({ roomCode: s.roomCode, sessionId: s.id, ...(storedControllerId ? { controllerId: storedControllerId } : {}) })
      });
      let data: any = {};
      if (res.headers.get('content-type')?.includes('application/json')) {
        try { data = await res.json(); } catch (e) { console.error('Failed to parse join response', e); }
      }
      if (!res.ok) throw new Error(data.error || `Unable to join room (${res.status}). Please try again.`);
      if (typeof data.controllerId !== 'string' || !data.controllerId.trim()) {
        throw new Error('The server did not return room access credentials. Please try again.');
      }
      localStorage.setItem(storageKey, data.controllerId);
      navigate(`/rooms/${s.id}?role=guest&controllerId=${encodeURIComponent(data.controllerId)}`);
    } catch (err: any) {
      console.warn('Join session failed:', err?.message || err);
      setJoinError(err?.message || 'Unable to join this room. Please try again.');
    } finally {
      setJoiningSessionId(null);
    }
  };

  const isNormalUser = user?.role === 'user';

  if (isNormalUser) {
    return (
      <div className="min-h-[85vh] flex flex-col items-center justify-center p-6 md:p-12 text-center">
        <div className="relative max-w-lg w-full overflow-hidden rounded-3xl bg-gradient-to-br from-[#171827] via-[#1b172a] to-[#141522] border border-white/10 p-8 md:p-14 shadow-2xl">
          <div className="absolute top-0 right-0 w-72 h-72 bg-[#F472B6]/15 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
          
          <div className="relative z-10 flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#F472B6] to-[#DB2777] flex items-center justify-center shadow-xl shadow-[#F472B6]/25 mb-6">
              <Mic className="w-8 h-8 text-white" />
            </div>

            <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight mb-3">
              Yimly
            </h1>

            <p className="text-zinc-400 text-sm md:text-base leading-relaxed mb-8 max-w-sm">
              Welcome back{user?.username ? `, ${user.username}` : ''}! Launch your karaoke hosting session instantly.
            </p>

            <button
              ref={hostButtonRef}
              onClick={createRoom}
              className="w-full sm:w-auto px-8 py-4 bg-[#F472B6] hover:bg-[#DB2777] text-white font-bold text-base rounded-2xl transition-all shadow-xl shadow-[#F472B6]/30 flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-[#F472B6] focus:ring-offset-2 focus:ring-offset-[#171827] focus:scale-105"
            >
              <Mic className="w-5 h-5" />
              <span>Host Karaoke</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-10">
      {/* Hero / Welcome Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#171827] via-[#1b172a] to-[#141522] border border-white/10 p-8 md:p-12 shadow-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#F472B6]/15 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#F472B6]/15 border border-[#F472B6]/30 text-[#F472B6] text-xs font-semibold uppercase tracking-wider mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Dedicated Karaoke System</span>
          </div>

          <h1 className="text-3xl md:text-5xl font-extrabold text-white tracking-tight leading-tight mb-4">
            Sing, Queue & Stream <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-zinc-200 to-[#F472B6]">
              Your Media Library
            </span>
          </h1>

          <p className="text-zinc-400 text-sm md:text-base leading-relaxed mb-8">
            Welcome back{user?.username ? `, ${user.username}` : ''}! Launch a live karaoke session with real-time synchronized lyrics, or explore your high-fidelity music collection.
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={createRoom}
              className="px-6 py-3.5 bg-[#F472B6] hover:bg-[#DB2777] text-white font-semibold rounded-xl transition-all shadow-lg shadow-[#F472B6]/25 flex items-center gap-2 hover:scale-[1.02] active:scale-[0.98]"
            >
              <Mic className="w-5 h-5" />
              <span>Host Karaoke Room</span>
            </button>

            <Link
              to="/download"
              className="px-6 py-3.5 bg-[#F472B6]/15 hover:bg-[#F472B6]/25 text-[#F472B6] font-semibold rounded-xl border border-[#F472B6]/30 transition-all flex items-center gap-2"
            >
              <Download className="w-5 h-5" />
              <span>Download Music</span>
            </Link>

            <Link
              to="/library"
              className="px-6 py-3.5 bg-[#1C1E2D] hover:bg-[#25283C] text-zinc-200 hover:text-white font-medium rounded-xl border border-white/10 transition-all flex items-center gap-2"
            >
              <Music className="w-5 h-5 text-zinc-400" />
              <span>Jukebox</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Live Karaoke Sessions Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[#F472B6] animate-pulse" />
            <h2 className="text-xl font-bold text-white tracking-tight">Active Karaoke Rooms</h2>
          </div>
          <Link
            to="/rooms"
            className="text-xs font-semibold text-[#F472B6] hover:text-[#DB2777] flex items-center gap-1 transition-colors"
          >
            <span>View All Rooms</span>
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

        {joinError && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <span className="flex-1">{joinError}</span>
            <button type="button" onClick={() => setJoinError(null)} className="shrink-0 rounded-md px-2 py-1 hover:bg-red-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300" aria-label="Dismiss join error">Dismiss</button>
          </div>
        )}

        {activeSessions.length > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeSessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleJoinSession(s)}
                disabled={joiningSessionId !== null}
                aria-label={`Join karaoke room ${s.roomCode}`}
                aria-busy={joiningSessionId === s.id}
                className="text-left w-full bg-[#141622] hover:bg-[#1A1C2C] border border-white/5 hover:border-[#F472B6]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F472B6] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1018] disabled:opacity-70 disabled:cursor-wait rounded-2xl p-5 cursor-pointer transition-all group relative overflow-hidden"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase bg-[#F472B6]/15 text-[#F472B6] border border-[#F472B6]/25 flex items-center gap-1.5">
                    <Radio className="w-3 h-3 animate-pulse" /> Live Now
                  </span>
                  <span className="text-xs text-zinc-500 font-mono">ID: {s.id.slice(0, 6)}</span>
                </div>
                <div className="font-mono text-2xl font-black tracking-widest text-white mb-2 group-hover:text-[#F472B6] transition-colors">
                  {s.roomCode}
                </div>
                <p className="text-xs text-zinc-400 flex items-center justify-between">
                  <span>Host: {s.hostId}</span>
                  <span className="text-[#F472B6] font-semibold flex items-center gap-1">
                    {joiningSessionId === s.id ? 'Joining…' : 'Join'} <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                  </span>
                </p>
              </button>
            ))
          </div>
        ) : (
          <div className="rounded-2xl bg-[#12131E] border border-dashed border-white/10 p-8 text-center">
            <Radio className="w-8 h-8 text-zinc-600 mx-auto mb-2 opacity-50" />
            <h3 className="text-sm font-semibold text-zinc-300 mb-1">No Active Karaoke Rooms</h3>
            <p className="text-xs text-zinc-500 max-w-sm mx-auto mb-4">
              There are currently no live sessions. Create a room to start hosting karaoke with friends!
            </p>
            <button
              onClick={createRoom}
              className="px-4 py-2 bg-[#F472B6]/15 hover:bg-[#F472B6] text-[#F472B6] hover:text-white border border-[#F472B6]/30 text-xs font-semibold rounded-xl transition-colors inline-flex items-center gap-2"
            >
              <Mic className="w-3.5 h-3.5" />
              <span>Create First Room</span>
            </button>
          </div>
        )}
      </div>

    </div>
  );
}
