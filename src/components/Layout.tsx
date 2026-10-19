import { useEffect, useState, ReactNode } from 'react';
import { Outlet, useNavigate, NavLink, useLocation } from 'react-router-dom';
import { Home, Music, Mic, Settings, Users, LogOut, Disc, Menu, X, Radio, Download, ChevronUp, ChevronDown, ListMusic, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { clearAuthToken } from '../lib/auth';
import PlayerBar from './PlayerBar';
import NowPlayingOverlay from './NowPlayingOverlay';
import NowPlayingPanel from './NowPlayingPanel';

export default function Layout() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [jukeboxOpen, setJukeboxOpen] = useState(false);
  const [sidePanelsVisible, setSidePanelsVisible] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    fetch('/api/auth/me')
      .then(async res => {
        if (!res.ok) throw new Error('Not authenticated');
        if (res.headers.get('content-type')?.includes('application/json')) {
          return await res.json();
        }
        throw new Error('Invalid auth response');
      })
      .then(data => {
        setUser(data.user);
        setLoading(false);
      })
      .catch(() => {
        navigate('/login');
      });
  }, [navigate]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Open jukebox by default when on library routes
  useEffect(() => {
    if (location.pathname.startsWith('/library')) {
      setJukeboxOpen(true);
    }
  }, [location.pathname]);

  const isJukeboxActive = location.pathname.startsWith('/library');
  const isLibraryRoute = isJukeboxActive;

  const handleLogout = async () => {
    clearAuthToken();
    await fetch('/api/auth/logout', { method: 'POST' });
    navigate('/login');
  };

  const isHome = location.pathname === '/';
  const isNormalUser = user?.role === 'user';
  const hideSidebar = isNormalUser && isHome;

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0A0B10] text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#FF4FA3]/10 border border-[#FF4FA3]/20 flex items-center justify-center">
            <Disc className="w-6 h-6 text-[#FF4FA3] animate-spin" />
          </div>
          <span className="text-xs text-zinc-400 font-medium tracking-wide">Loading Yimly...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#0A0B10] text-zinc-100 overflow-hidden font-sans">
      {/* Desktop & Tablet Sidebar */}
      {!hideSidebar && sidePanelsVisible && (
        <aside className="w-64 bg-[#11121A] border-r border-white/5 flex flex-col hidden md:flex shrink-0">
          {/* Brand Header */}
          <div className="p-6 pb-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#FF4FA3] to-[#e0378b] flex items-center justify-center shadow-lg shadow-[#FF4FA3]/20">
                <Mic className="w-5 h-5 text-white" />
              </div>
              <div>
                <span className="text-xl font-bold tracking-tight text-white block leading-none">Yimly</span>
                <span className="text-[10px] text-zinc-400 font-medium tracking-wider uppercase mt-1 block">Karaoke Studio</span>
              </div>
            </div>
          </div>

          {/* Navigation Sections */}
          <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto">
            <div className="px-3 pb-2 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
              Menu
            </div>
            <NavItem to="/" icon={<Home className="w-4 h-4" />} label="Home" />
            <div className="space-y-1">
              <button 
                onClick={() => {
                  setJukeboxOpen(true);
                  navigate('/library');
                }} 
                className={`flex items-center justify-between w-full px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isJukeboxActive 
                    ? 'bg-[#FF4FA3]/15 text-[#FF4FA3] font-semibold border border-[#FF4FA3]/25 shadow-sm' 
                    : 'text-zinc-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Music className="w-4 h-4" />
                  <span>Jukebox</span>
                </div>
                <div 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    setJukeboxOpen(!jukeboxOpen); 
                  }}
                  className="p-1 hover:bg-white/10 rounded-lg transition-colors"
                >
                  {jukeboxOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              </button>
              {jukeboxOpen && (
                <div className="pl-4 space-y-1">
                  <NavItem to="/library" icon={<Home className="w-4 h-4" />} label="Jukebox Home" />
                  <NavItem to="/library?tab=songs" icon={<Music className="w-4 h-4" />} label="All Songs" />
                  <NavItem to="/library?tab=albums" icon={<Disc className="w-4 h-4" />} label="Albums" />
                  <NavItem to="/library?tab=artists" icon={<Mic className="w-4 h-4" />} label="Artists" />
                  <NavItem to="/library?tab=playlists" icon={<ListMusic className="w-4 h-4" />} label="Playlists" />
                </div>
              )}
            </div>
            <NavItem to="/rooms" icon={<Radio className="w-4 h-4" />} label="Karaoke Rooms" badge="Live" />

            {user?.role === 'administrator' && (
              <div className="pt-6">
                <div className="px-3 pb-2 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                  Administration
                </div>
                <div className="space-y-1.5">
                  <NavItem to="/download" icon={<Download className="w-4 h-4" />} label="Download Music" />
                  <NavItem to="/users" icon={<Users className="w-4 h-4" />} label="Users" />
                  <NavItem to="/settings" icon={<Settings className="w-4 h-4" />} label="Settings" />
                </div>
              </div>
            )}
          </nav>

          {/* User Profile & Logout */}
          <div className="p-3 border-t border-white/5 bg-[#0D0E15]">
            <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-[#171824] border border-white/5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-white/10 flex items-center justify-center text-xs font-bold text-white shrink-0">
                  {user?.username?.[0]?.toUpperCase() || 'U'}
                </div>
                <div className="min-w-0">
                  <span className="text-xs font-semibold text-white block truncate">{user?.username}</span>
                  <span className="text-[10px] text-zinc-400 capitalize block truncate">{user?.role || 'User'}</span>
                </div>
              </div>
              <button 
                onClick={handleLogout}
                className="p-1.5 text-zinc-400 hover:text-[#FF4FA3] hover:bg-[#FF4FA3]/10 rounded-lg transition-colors shrink-0"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* Mobile Drawer Backdrop & Menu */}
      {!hideSidebar && mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div 
            className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity" 
            onClick={() => setMobileMenuOpen(false)} 
          />
          <div className="relative w-4/5 max-w-xs bg-[#11121A] border-r border-white/10 h-full flex flex-col z-10 p-5">
            <div className="flex items-center justify-between pb-6 border-b border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#FF4FA3] flex items-center justify-center text-white shadow-md shadow-[#FF4FA3]/25">
                  <Mic className="w-5 h-5" />
                </div>
                <span className="text-lg font-bold text-white">Yimly</span>
              </div>
              <button 
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 text-zinc-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 py-6 space-y-2 overflow-y-auto">
              <NavItem to="/" icon={<Home className="w-5 h-5" />} label="Home" />
              <NavItem to="/library" icon={<Music className="w-5 h-5" />} label="Library" />
              <NavItem to="/rooms" icon={<Radio className="w-5 h-5" />} label="Karaoke Rooms" />

              {user?.role === 'administrator' && (
                <div className="pt-6">
                  <div className="px-3 pb-2 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                    Administration
                  </div>
                  <div className="space-y-2">
                    <NavItem to="/download" icon={<Download className="w-5 h-5" />} label="Download Music" />
                    <NavItem to="/users" icon={<Users className="w-5 h-5" />} label="Users" />
                    <NavItem to="/settings" icon={<Settings className="w-5 h-5" />} label="Settings" />
                  </div>
                </div>
              )}
            </nav>

            <div className="pt-4 border-t border-white/5 flex items-center justify-between">
              <div className="min-w-0">
                <span className="text-sm font-semibold text-white block truncate">{user?.username}</span>
                <span className="text-xs text-zinc-400 capitalize">{user?.role}</span>
              </div>
              <button 
                onClick={handleLogout}
                className="p-2 text-zinc-400 hover:text-[#FF4FA3] hover:bg-[#FF4FA3]/10 rounded-lg transition-colors"
                title="Logout"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-[#0A0B10]">
        {/* Mobile Header Bar */}
        {!hideSidebar && (
          <div className="md:hidden px-4 py-3 bg-[#11121A] border-b border-white/5 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#FF4FA3] flex items-center justify-center text-white">
                <Mic className="w-4 h-4" />
              </div>
              <span className="font-bold text-white tracking-tight">Yimly</span>
            </div>
            <button 
              onClick={() => setMobileMenuOpen(true)}
              className="p-2 text-zinc-300 hover:text-white rounded-lg bg-zinc-800/60"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* One desktop control toggles both side panels without touching playback state. */}
        {isLibraryRoute && (
          <div className="hidden md:flex items-center justify-between px-4 py-2 border-b border-white/5 bg-[#0D0E15] shrink-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Jukebox</span>
            <button
              type="button"
              onClick={() => setSidePanelsVisible(visible => !visible)}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-white/10 hover:text-white transition-colors"
              aria-label={sidePanelsVisible ? 'Hide sidebar and now playing panel' : 'Show sidebar and now playing panel'}
              title={sidePanelsVisible ? 'Hide side panels' : 'Show side panels'}
            >
              {sidePanelsVisible ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
              <span>{sidePanelsVisible ? 'Hide panels' : 'Show panels'}</span>
            </button>
          </div>
        )}

        {/* Content and desktop Now Playing panel share a row; playback remains mounted below. */}
        <div className="flex-1 flex min-h-0 min-w-0 overflow-hidden">
          <main className="flex-1 min-w-0 overflow-y-auto">
            <Outlet context={{ user }} />
          </main>
          {isLibraryRoute && sidePanelsVisible && (
            <aside className="hidden md:flex w-80 xl:w-96 border-l border-white/5 bg-[#11121A] shrink-0 min-h-0 overflow-hidden">
              <NowPlayingPanel />
            </aside>
          )}
        </div>

        {/* Keep the persistent playback controls mounted when either side panel is hidden. */}
        {isLibraryRoute ? <PlayerBar /> : <NowPlayingOverlay />}
      </div>
    </div>
  );
}

function NavItem({ to, icon, label, badge }: { to: string, icon: ReactNode, label: string, badge?: string }) {
  const location = useLocation();
  const currentUrl = location.pathname + location.search;

  let isActive = false;
  if (to === '/') {
    isActive = location.pathname === '/';
  } else if (to.includes('?')) {
    isActive = currentUrl === to;
  } else {
    isActive = location.pathname === to && (!location.search || location.search === '?tab=home');
  }

  return (
    <NavLink
      to={to}
      className={
        `flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all text-sm font-medium ${
          isActive 
            ? 'bg-[#FF4FA3]/15 text-[#FF4FA3] font-semibold border border-[#FF4FA3]/25 shadow-sm' 
            : 'text-zinc-400 hover:text-white hover:bg-white/5'
        }`
      }
    >
      <div className="flex items-center gap-3">
        {icon}
        <span>{label}</span>
      </div>
      {badge && (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#FF4FA3]/20 text-[#FF4FA3] border border-[#FF4FA3]/30">
          {badge}
        </span>
      )}
    </NavLink>
  );
}
