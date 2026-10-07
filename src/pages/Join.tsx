import { useState, FormEvent } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Mic, ArrowRight, AlertCircle, Music } from 'lucide-react';

export default function Join() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Read session code from query params: ?session=642370 or ?code=642370
  const sessionParam = searchParams.get('session') || searchParams.get('code') || '';
  const rawCode = sessionParam.replace(/\s+/g, '');

  // Format code for display: "642 370"
  const formattedCode = rawCode.length === 6 
    ? `${rawCode.slice(0, 3)} ${rawCode.slice(3)}` 
    : rawCode || '------';

  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleJoin = async (e: FormEvent) => {
    e.preventDefault();

    const trimmedName = username.trim();
    if (!trimmedName) {
      setError('Please enter your username.');
      return;
    }

    if (!rawCode) {
      setError('This room is no longer available.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/karaoke/sessions/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomCode: rawCode,
          displayName: trimmedName,
          username: trimmedName
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

      if (!res.ok) {
        throw new Error(data.error || 'This room is no longer available.');
      }

      if (data.sessionId && data.controllerId) {
        localStorage.setItem(`yimly_controller_${data.sessionId}`, data.controllerId);
      }

      // Success! Navigate directly to Guest Controller
      navigate(`/rooms/${data.sessionId}?role=guest&controllerId=${data.controllerId}`);
    } catch (err: any) {
      console.error('Join room error:', err);
      setError('This room is no longer available.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#08090E] text-white flex items-center justify-center p-4 font-sans select-none">
      <div className="w-full max-w-sm bg-[#12131D] border border-white/10 rounded-3xl p-8 shadow-2xl text-center relative overflow-hidden">
        {/* Ambient Top Glow */}
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-48 h-48 bg-[#FF4FA3]/10 rounded-full blur-3xl pointer-events-none" />

        {/* Brand Logo */}
        <div className="flex items-center justify-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-xl bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 flex items-center justify-center text-[#FF4FA3]">
            <Music className="w-4 h-4" />
          </div>
          <span className="text-xl font-black tracking-widest text-white">YIMLY</span>
        </div>

        {/* Section Heading */}
        <div className="text-[11px] font-extrabold uppercase tracking-widest text-[#FF4FA3] mb-1">
          JOIN ROOM
        </div>

        {/* Display Session Code */}
        <div className="my-5 py-3 px-6 bg-[#08090E] border border-white/10 rounded-2xl shadow-inner inline-block w-full">
          <span className="text-3xl font-mono font-black text-white tracking-widest">
            {formattedCode}
          </span>
        </div>

        {/* Error Alert Box (Clean message, no options to create room) */}
        {error ? (
          <div className="mb-6 p-4 bg-red-950/40 border border-red-500/30 rounded-2xl text-center">
            <AlertCircle className="w-6 h-6 text-red-400 mx-auto mb-2" />
            <p className="text-sm font-semibold text-red-300">{error}</p>
            <p className="text-xs text-zinc-400 mt-1">Please ask the host for an active room QR code.</p>
          </div>
        ) : (
          /* Username Entry Form */
          <form onSubmit={handleJoin} className="space-y-4">
            <div className="space-y-2 text-left">
              <label htmlFor="username-input" className="block text-xs font-semibold text-zinc-300 text-center">
                What's your username?
              </label>
              <input
                id="username-input"
                type="text"
                placeholder="Enter username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={30}
                required
                autoFocus
                className="w-full px-4 py-3.5 bg-[#08090E] border border-white/15 rounded-xl text-center text-base font-semibold text-white placeholder-zinc-500 focus:outline-none focus:border-[#FF4FA3] focus:ring-2 focus:ring-[#FF4FA3]/40 transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !username.trim() || !rawCode}
              className="w-full py-4 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white font-bold text-base rounded-xl transition-all shadow-lg shadow-[#FF4FA3]/25 flex items-center justify-center gap-2 active:scale-95 disabled:opacity-40"
            >
              {loading ? (
                <span>Joining...</span>
              ) : (
                <>
                  <span>JOIN ROOM</span>
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
