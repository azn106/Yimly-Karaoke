import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, ArrowRight, Lock, User, AlertCircle } from 'lucide-react';
import { setAuthToken } from '../lib/auth';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      let data: any = {};
      if (res.headers.get('content-type')?.includes('application/json')) {
        try {
          data = await res.json();
        } catch (e) {
          console.error('Failed to parse login response', e);
        }
      }

      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }

      if (data.token) {
        setAuthToken(data.token);
      }

      navigate('/');
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0B10] text-zinc-100 p-6 relative overflow-hidden font-sans">
      {/* Background ambient bloom */}
      <div className="absolute w-[600px] h-[600px] bg-[#FF4FA3]/10 rounded-full blur-3xl pointer-events-none -top-40 -right-40" />
      <div className="absolute w-[400px] h-[400px] bg-[#FF4FA3]/5 rounded-full blur-3xl pointer-events-none -bottom-20 -left-20" />

      <div className="w-full max-w-md p-8 md:p-10 bg-[#141622] rounded-3xl shadow-2xl border border-white/10 relative z-10">
        {/* Brand Icon */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#FF4FA3] to-[#e0378b] flex items-center justify-center text-white shadow-xl shadow-[#FF4FA3]/25 mb-4">
            <Mic className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Sign in to Yimly</h1>
          <p className="text-xs text-zinc-400 mt-1">Karaoke media server & playback studio</p>
        </div>

        {error && (
          <div className="mb-6 p-3.5 bg-red-950/50 border border-red-500/30 rounded-xl text-red-300 text-xs flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Username</label>
            <div className="relative">
              <User className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                className="w-full pl-10 pr-4 py-2.5 bg-[#0A0B10] border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-[#FF4FA3] focus:ring-1 focus:ring-[#FF4FA3] text-sm"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-2.5 bg-[#0A0B10] border border-white/10 rounded-xl text-white placeholder-zinc-600 focus:outline-none focus:border-[#FF4FA3] focus:ring-1 focus:ring-[#FF4FA3] text-sm"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 px-4 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white font-semibold rounded-xl transition-all shadow-lg shadow-[#FF4FA3]/25 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <span>{loading ? 'Signing In...' : 'Sign In'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
