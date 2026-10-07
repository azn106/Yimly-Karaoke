import { useEffect, useState, useRef, ReactNode } from 'react';
import { useOutletContext, Link, useNavigate } from 'react-router-dom';
import { Play, Mic, Radio, Users, Music, Disc, ChevronRight, Plus, Sparkles, Folder, Download } from 'lucide-react';
import { getAuthToken } from '../lib/auth';

export default function Home() {
  const { user } = useOutletContext<{ user: any }>() || {};
  const navigate = useNavigate();
  const [stats, setStats] = useState({ songs: 0, artists: 0, albums: 0 });
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const [featuredSongs, setFeaturedSongs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const hostButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (user?.role === 'user') {
      hostButtonRef.current?.focus();
    }
  }, [user]);

  useEffect(() => {
    async function loadDashboardData() {
      try {
        const [statsRes, sessionsRes, songsRes] = await Promise.all([
          fetch('/api/libraries/stats'),
          fetch('/api/karaoke/active-sessions'),
          fetch('/api/songs')
        ]);

        if (statsRes.ok && statsRes.headers.get('content-type')?.includes('application/json')) {
          setStats(await statsRes.json());
        }
        if (sessionsRes.ok && sessionsRes.headers.get('content-type')?.includes('application/json')) {
          setActiveSessions(await sessionsRes.json());
        }
        if (songsRes.ok && songsRes.headers.get('content-type')?.includes('application/json')) {
          const songsData = await songsRes.json();
          if (Array.isArray(songsData)) {
            setFeaturedSongs(songsData.slice(0, 8));
          }
        }
      } catch (e) {
        console.error('Failed to load dashboard data:', e);
      } finally {
        setLoading(false);
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
    try {
      if (user?.id && s.hostId === user.id) {
        navigate(`/rooms/${s.id}?role=host`);
        return;
      }

      const storageKey = `yimly_controller_${s.id}`;
      let controllerId = localStorage.getItem(storageKey);

      if (!controllerId) {
        const res = await fetch('/api/karaoke/sessions/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomCode: s.roomCode,
            sessionId: s.id
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
          setActiveSessions((prev) => prev.filter((item) => item.id !== s.id));
          throw new Error(data.error || 'Failed to join room');
        }
        controllerId = data.controllerId;
        if (controllerId) {
          localStorage.setItem(storageKey, controllerId);
        }
      }

      if (controllerId) {
        navigate(`/rooms/${s.id}?role=guest&controllerId=${encodeURIComponent(controllerId)}`);
      } else {
        navigate(`/rooms/${s.id}?role=guest`);
      }
    } catch (err: any) {
      console.warn('Join session notice:', err?.message || err);
      navigate(`/rooms/${s.id}?role=guest`);
    }
  };

  const isNormalUser = user?.role === 'user';

  if (isNormalUser) {
    return (
      <div className="min-h-[85vh] flex flex-col items-center justify-center p-6 md:p-12 text-center">
        <div className="relative max-w-lg w-full overflow-hidden rounded-3xl bg-gradient-to-br from-[#171827] via-[#1b172a] to-[#141522] border border-white/10 p-8 md:p-14 shadow-2xl">
          <div className="absolute top-0 right-0 w-72 h-72 bg-[#FF4FA3]/15 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
          
          <div className="relative z-10 flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#FF4FA3] to-[#e0378b] flex items-center justify-center shadow-xl shadow-[#FF4FA3]/25 mb-6">
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
              className="w-full sm:w-auto px-8 py-4 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white font-bold text-base rounded-2xl transition-all shadow-xl shadow-[#FF4FA3]/30 flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-[#FF4FA3] focus:ring-offset-2 focus:ring-offset-[#171827] focus:scale-105"
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
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#FF4FA3]/15 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 text-[#FF4FA3] text-xs font-semibold uppercase tracking-wider mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Dedicated Karaoke System</span>
          </div>

          <h1 className="text-3xl md:text-5xl font-extrabold text-white tracking-tight leading-tight mb-4">
            Sing, Queue & Stream <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-zinc-200 to-[#FF4FA3]">
              Your Media Library
            </span>
          </h1>

          <p className="text-zinc-400 text-sm md:text-base leading-relaxed mb-8">
            Welcome back{user?.username ? `, ${user.username}` : ''}! Launch a live karaoke session with real-time synchronized lyrics, or explore your high-fidelity music collection.
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={createRoom}
              className="px-6 py-3.5 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white font-semibold rounded-xl transition-all shadow-lg shadow-[#FF4FA3]/25 flex items-center gap-2 hover:scale-[1.02] active:scale-[0.98]"
            >
              <Mic className="w-5 h-5" />
              <span>Host Karaoke Room</span>
            </button>

            <Link
              to="/download"
              className="px-6 py-3.5 bg-[#FF4FA3]/15 hover:bg-[#FF4FA3]/25 text-[#FF4FA3] font-semibold rounded-xl border border-[#FF4FA3]/30 transition-all flex items-center gap-2"
            >
              <Download className="w-5 h-5" />
              <span>Download Music</span>
            </Link>

            <Link
              to="/library"
              className="px-6 py-3.5 bg-[#1C1E2D] hover:bg-[#25283C] text-zinc-200 hover:text-white font-medium rounded-xl border border-white/10 transition-all flex items-center gap-2"
            >
              <Music className="w-5 h-5 text-zinc-400" />
              <span>Browse Catalog</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Stats Overview Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
        <StatCard
          icon={<Music className="w-5 h-5 text-[#FF4FA3]" />}
          title="Total Songs"
          value={stats.songs}
          link="/library"
        />
        <StatCard
          icon={<Mic className="w-5 h-5 text-[#FF4FA3]" />}
          title="Artists"
          value={stats.artists}
          link="/library"
        />
        <StatCard
          icon={<Disc className="w-5 h-5 text-[#FF4FA3]" />}
          title="Albums"
          value={stats.albums}
          link="/library"
        />
        <StatCard
          icon={<Radio className="w-5 h-5 text-[#FF4FA3]" />}
          title="Active Rooms"
          value={activeSessions.length}
          link="/rooms"
          highlight={activeSessions.length > 0}
        />
      </div>

      {/* Live Karaoke Sessions Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[#FF4FA3] animate-pulse" />
            <h2 className="text-xl font-bold text-white tracking-tight">Active Karaoke Rooms</h2>
          </div>
          <Link
            to="/rooms"
            className="text-xs font-semibold text-[#FF4FA3] hover:text-[#ff69b2] flex items-center gap-1 transition-colors"
          >
            <span>View All Rooms</span>
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>

        {activeSessions.length > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeSessions.map((s) => (
              <div
                key={s.id}
                onClick={() => handleJoinSession(s)}
                className="bg-[#141622] hover:bg-[#1A1C2C] border border-white/5 hover:border-[#FF4FA3]/40 rounded-2xl p-5 cursor-pointer transition-all group relative overflow-hidden"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase bg-[#FF4FA3]/15 text-[#FF4FA3] border border-[#FF4FA3]/25 flex items-center gap-1.5">
                    <Radio className="w-3 h-3 animate-pulse" /> Live Now
                  </span>
                  <span className="text-xs text-zinc-500 font-mono">ID: {s.id.slice(0, 6)}</span>
                </div>

                <div className="font-mono text-2xl font-black tracking-widest text-white mb-2 group-hover:text-[#FF4FA3] transition-colors">
                  {s.roomCode}
                </div>

                <p className="text-xs text-zinc-400 flex items-center justify-between">
                  <span>Host: {s.hostId}</span>
                  <span className="text-[#FF4FA3] font-semibold flex items-center gap-1">
                    Join <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                  </span>
                </p>
              </div>
            ))}
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
              className="px-4 py-2 bg-[#FF4FA3]/15 hover:bg-[#FF4FA3] text-[#FF4FA3] hover:text-white border border-[#FF4FA3]/30 text-xs font-semibold rounded-xl transition-colors inline-flex items-center gap-2"
            >
              <Mic className="w-3.5 h-3.5" />
              <span>Create First Room</span>
            </button>
          </div>
        )}
      </div>

      {/* Featured / Recently Added Songs Showcase */}
      {featuredSongs.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-white tracking-tight">Media Library Highlights</h2>
            <Link
              to="/library"
              className="text-xs font-semibold text-zinc-400 hover:text-white flex items-center gap-1 transition-colors"
            >
              <span>Explore All Songs</span>
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {featuredSongs.map((song) => (
              <div
                key={song.id}
                className="bg-[#141622] hover:bg-[#1A1C2C] border border-white/5 hover:border-white/15 rounded-2xl p-4 transition-all group flex flex-col justify-between"
              >
                <div>
                  <div className="w-full aspect-square rounded-xl bg-[#1C1E2D] border border-white/5 mb-3 flex items-center justify-center relative overflow-hidden group-hover:border-[#FF4FA3]/30 transition-colors">
                    {song.hasArtwork ? (
                      <img
                        src={`/api/songs/${song.id}/artwork`}
                        alt={song.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <Disc className="w-10 h-10 text-zinc-600 group-hover:text-[#FF4FA3] transition-colors" />
                    )}
                  </div>
                  <h3 className="font-semibold text-sm text-white truncate group-hover:text-[#FF4FA3] transition-colors">
                    {song.title}
                  </h3>
                  <p className="text-xs text-zinc-400 truncate mt-0.5">{song.artist || 'Unknown Artist'}</p>
                </div>

                <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
                  <span className="text-[11px] text-zinc-500 capitalize">{song.variant}</span>
                  <button
                    onClick={() => handleQueueSong(song.id)}
                    className="p-1.5 bg-[#FF4FA3]/15 hover:bg-[#FF4FA3] text-[#FF4FA3] hover:text-white rounded-lg text-xs font-medium transition-colors"
                    title="Add to active room queue"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  title,
  value,
  link,
  highlight = false
}: {
  icon: ReactNode;
  title: string;
  value: number;
  link: string;
  highlight?: boolean;
}) {
  return (
    <Link
      to={link}
      className={`p-5 rounded-2xl border transition-all flex flex-col justify-between ${
        highlight
          ? 'bg-[#181524] border-[#FF4FA3]/30 shadow-lg shadow-[#FF4FA3]/10'
          : 'bg-[#141622] hover:bg-[#1A1C2C] border-white/5 hover:border-white/10'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center">
          {icon}
        </div>
        <ChevronRight className="w-4 h-4 text-zinc-600" />
      </div>
      <div>
        <div className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">{value}</div>
        <div className="text-xs font-medium text-zinc-400 mt-1">{title}</div>
      </div>
    </Link>
  );
}
