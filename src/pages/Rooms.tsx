import { useState, useEffect, FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Play, LogIn, Users, Mic, Radio, Sparkles, ArrowRight, Disc, RefreshCw, User, LogOut, AlertCircle } from 'lucide-react';
import { getAuthToken } from '../lib/auth';

export default function Rooms() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // End Session state
  const [sessionToEnd, setSessionToEnd] = useState<any | null>(null);
  const [endingSession, setEndingSession] = useState(false);
  const [endSessionError, setEndSessionError] = useState('');

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const fetchActiveSessions = () => {
    fetch('/api/karaoke/active-sessions')
      .then(async res => {
        if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
          return await res.json();
        }
        return [];
      })
      .then(data => setSessions(Array.isArray(data) ? data : []))
      .catch(err => console.error('Failed to load active rooms:', err));
  };

  useEffect(() => {
    fetchActiveSessions();
    const codeParam = searchParams.get('code');
    if (codeParam) {
      navigate(`/join?session=${codeParam}`, { replace: true });
    }
  }, [searchParams, navigate]);

  const handleEndSession = async () => {
    if (!sessionToEnd) return;
    setEndingSession(true);
    setEndSessionError('');

    try {
      const res = await fetch(`/api/karaoke/sessions/${sessionToEnd.id}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      let data: any = {};
      if (res.headers.get('content-type')?.includes('application/json')) {
        try {
          data = await res.json();
        } catch (e) {
          console.error('Failed to parse end session response', e);
        }
      }

      if (!res.ok) {
        throw new Error(data.error || 'Failed to terminate session on server');
      }

      // Success: Remove ended room from active rooms list and update state
      setSessions((prev) => prev.filter((s) => s.id !== sessionToEnd.id));
      setSessionToEnd(null);
      fetchActiveSessions();
    } catch (err: any) {
      console.error('Failed to end session:', err);
      setEndSessionError(err.message || 'Failed to end session. Please try again.');
    } finally {
      setEndingSession(false);
    }
  };

  const createRoom = async () => {
    setLoading(true);
    setError('');
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
          console.error('Failed to parse create room response', e);
        }
      }
      if (!res.ok) throw new Error(data.error || 'Failed to create room');
      navigate(`/rooms/${data.id}?role=host`);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const joinRoom = async (e: FormEvent) => {
    e.preventDefault();
    const cleanCode = joinCode.replace(/\s+/g, '');
    if (!cleanCode) return;

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/karaoke/sessions/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          roomCode: cleanCode,
          displayName: displayName.trim() || undefined
        })
      });
      let data: any = {};
      if (res.headers.get('content-type')?.includes('application/json')) {
        try {
          data = await res.json();
        } catch (e) {
          console.error('Failed to parse join response', e);
        }
      }
      if (!res.ok) throw new Error(data.error || 'Failed to join room');
      if (data.sessionId && data.controllerId) {
        localStorage.setItem(`yimly_controller_${data.sessionId}`, data.controllerId);
      }
      navigate(`/rooms/${data.sessionId}?role=guest&controllerId=${data.controllerId}`);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto space-y-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 text-[#FF4FA3] text-xs font-semibold uppercase tracking-wider mb-2">
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            <span>Live Session Hub</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight">Karaoke Rooms</h1>
          <p className="text-sm text-zinc-400 mt-1">Host a live karaoke session or join a room from your mobile device.</p>
        </div>

        <button
          onClick={fetchActiveSessions}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors self-start md:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Rooms</span>
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-950/40 border border-red-500/30 rounded-2xl text-red-300 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-xs text-red-400 hover:text-white underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Action Cards Grid */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Host a Session Card */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-[#1A1828] to-[#12131F] border border-[#FF4FA3]/25 p-8 flex flex-col items-center text-center shadow-xl group">
          <div className="absolute top-0 right-0 w-48 h-48 bg-[#FF4FA3]/10 rounded-full blur-2xl pointer-events-none" />

          <div className="w-16 h-16 rounded-2xl bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 flex items-center justify-center mb-5 shadow-lg shadow-[#FF4FA3]/10">
            <Mic className="w-8 h-8 text-[#FF4FA3]" />
          </div>

          <h2 className="text-2xl font-bold text-white mb-2">Host a Session</h2>
          <p className="text-sm text-zinc-400 mb-8 max-w-xs leading-relaxed">
            Create a live karaoke room. Display synchronized lyrics and control audio on this screen.
          </p>

          <button
            onClick={createRoom}
            disabled={loading}
            className="w-full max-w-xs py-3.5 px-6 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white font-semibold rounded-xl transition-all shadow-lg shadow-[#FF4FA3]/25 flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
          >
            <Play className="w-4 h-4 fill-white" />
            <span>{loading ? 'Creating Room...' : 'Start Hosting'}</span>
          </button>
        </div>

        {/* Join a Session Card */}
        <div className="rounded-3xl bg-[#141622] border border-white/10 p-8 flex flex-col items-center text-center shadow-xl">
          <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-5">
            <LogIn className="w-8 h-8 text-zinc-300" />
          </div>

          <h2 className="text-2xl font-bold text-white mb-2">Join a Session</h2>
          <p className="text-sm text-zinc-400 mb-6 max-w-xs leading-relaxed">
            Enter a room code to browse songs, queue up tracks, and sing along from your phone.
          </p>

          <form onSubmit={joinRoom} className="w-full max-w-xs space-y-3">
            <div className="space-y-1 text-left">
              <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider pl-1">Room Code</label>
              <input
                type="text"
                placeholder="e.g. 435 288"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#0A0B10] border border-white/15 rounded-xl text-center text-lg font-mono tracking-widest text-white placeholder-zinc-600 focus:outline-none focus:border-[#FF4FA3] focus:ring-1 focus:ring-[#FF4FA3] transition-all uppercase"
                maxLength={7}
                required
              />
            </div>
            
            <div className="space-y-1 text-left">
              <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider pl-1">Your Name / Device (Optional)</label>
              <input
                type="text"
                placeholder="e.g. Robin, Sarah"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#0A0B10] border border-white/15 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-[#FF4FA3] focus:ring-1 focus:ring-[#FF4FA3] transition-all"
                maxLength={30}
              />
            </div>

            <button
              type="submit"
              disabled={loading || !joinCode}
              className="w-full py-3 px-6 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl border border-white/10 transition-all flex items-center justify-center gap-2 disabled:opacity-40 mt-2"
            >
              <span>Join Room</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>

      {/* Active Sessions List */}
      <div className="space-y-4 pt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-[#FF4FA3]" />
            <span>Active Karaoke Rooms ({sessions.length})</span>
          </h3>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="bg-[#141622] border border-white/5 hover:border-[#FF4FA3]/40 rounded-2xl p-5 flex flex-col justify-between hover:bg-[#1A1C2C] transition-all group"
            >
              <div 
                onClick={() => setJoinCode(s.roomCode)}
                className="cursor-pointer mb-4"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full bg-[#FF4FA3] animate-pulse" />
                  <span className="font-mono text-xl font-extrabold text-white tracking-widest group-hover:text-[#FF4FA3] transition-colors">
                    {s.roomCode}
                  </span>
                </div>
                <div className="text-xs text-zinc-500">Host: {s.hostId}</div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-3 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setJoinCode(s.roomCode)}
                  className="px-3 py-1.5 rounded-lg bg-[#FF4FA3]/15 text-[#FF4FA3] text-xs font-semibold border border-[#FF4FA3]/25 hover:bg-[#FF4FA3] hover:text-white transition-colors"
                >
                  Select Code
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEndSessionError('');
                    setSessionToEnd(s);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-600 hover:text-white text-xs font-semibold border border-red-500/20 transition-all flex items-center gap-1.5"
                  title="End Session"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>End Session</span>
                </button>
              </div>
            </div>
          ))}

          {sessions.length === 0 && (
            <div className="col-span-full py-12 text-center text-zinc-500 border border-dashed border-white/10 rounded-2xl bg-[#11121C]">
              <Radio className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium text-zinc-400">No active rooms right now</p>
              <p className="text-xs text-zinc-600 mt-1">Host a session to start singing!</p>
            </div>
          )}
        </div>
      </div>

      {/* End Session Confirmation Modal */}
      {sessionToEnd && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#141622] border border-white/10 rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl space-y-6 relative overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/30 flex items-center justify-center shrink-0 text-red-400">
                <LogOut className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">End Session?</h3>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                  Are you sure you want to terminate this live karaoke session? This action will close connections for all active participants.
                </p>
              </div>
            </div>

            {/* Room / Session Details */}
            <div className="p-4 bg-[#08090E] border border-white/10 rounded-2xl space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400 font-medium">Room Code</span>
                <span className="font-mono font-black text-white text-base tracking-widest">{sessionToEnd.roomCode}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400 font-medium">Host ID</span>
                <span className="text-zinc-200 font-semibold">{sessionToEnd.hostId}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400 font-medium">Session ID</span>
                <span className="font-mono text-zinc-500 text-[10px] truncate max-w-[180px]">{sessionToEnd.id}</span>
              </div>
            </div>

            {/* Error Message Display */}
            {endSessionError && (
              <div className="p-3.5 bg-red-950/60 border border-red-500/40 rounded-xl text-red-300 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{endSessionError}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setSessionToEnd(null);
                  setEndSessionError('');
                }}
                disabled={endingSession}
                className="flex-1 py-3 px-4 bg-white/5 hover:bg-white/10 text-zinc-300 font-semibold text-xs rounded-xl transition-colors border border-white/10 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEndSession}
                disabled={endingSession}
                className="flex-1 py-3 px-4 bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-xl transition-all shadow-lg shadow-red-600/25 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {endingSession ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Ending...</span>
                  </>
                ) : (
                  <>
                    <LogOut className="w-4 h-4" />
                    <span>End Session</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
