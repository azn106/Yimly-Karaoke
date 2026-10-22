import { useEffect, useState, ReactNode } from 'react';
import { Outlet, useNavigate, NavLink, useLocation } from 'react-router-dom';
import { Home, Music, Mic, Settings, Users, LogOut, Disc, Menu, X, Radio, Download, ChevronUp, ChevronDown, ListMusic } from 'lucide-react';
import { clearAuthToken } from '../lib/auth';
import NowPlayingOverlay from './NowPlayingOverlay';
import NowPlayingPanel from './NowPlayingPanel';
import { usePlayback } from '../context/PlaybackContext';

export default function Layout() {
  const { currentSong, queue, togglePlay } = usePlayback();
  const hasActivePlayback = Boolean(currentSong || queue.length > 0);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState<'jukebox' | 'settings' | null>(null);
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

  // Close the drawer when the destination changes, including Jukebox tab changes.
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname, location.search, location.key]);

  // Keep the relevant section expanded while navigating within it.
  // Only one submenu can be open at a time.
  useEffect(() => {
    if (location.pathname.startsWith('/library')) {
      setExpandedSection('jukebox');
    } else if (['/settings', '/download', '/users'].includes(location.pathname)) {
      setExpandedSection('settings');
    } else {
      setExpandedSection(null);
    }
  }, [location.pathname]);

  // Track xl viewport breakpoint (1280px) for responsive player presentation
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(min-width: 1280px)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(min-width: 1280px)');
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsDesktop(e.matches);
    };
    if (mql.addEventListener) {
      mql.addEventListener('change', onChange as (e: MediaQueryListEvent) => void);
    } else {
      mql.addListener(onChange);
    }
    return () => {
      if (mql.removeEventListener) {
        mql.removeEventListener('change', onChange as (e: MediaQueryListEvent) => void);
      } else {
        mql.removeListener(onChange);
      }
    };
  }, []);

  // Desktop keyboard shortcut: Space toggles play/pause when not typing in form controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (
        activeTag === 'input' || 
        activeTag === 'textarea' || 
        document.activeElement?.getAttribute('contenteditable') === 'true'
      ) {
        return;
      }
      if (e.code === 'Space' && currentSong) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentSong, togglePlay]);

  // Unified player visibility conditions:
  // Right-side player panel is shown on desktop (>= 1280px) on music/library routes (Home & Library).
  // On other routes (e.g. /rooms, /settings, /download, /users) or below xl, it is hidden.
  const isRightPanelRoute = location.pathname === '/' || location.pathname.startsWith('/library');
  const isRightPanelVisible = isDesktop && isRightPanelRoute;

  // The compact bottom NowPlayingOverlay is shown whenever the right-side panel is hidden
  // AND there is active/paused playback with a current track or queue.
  const isBottomOverlayVisible = !isRightPanelVisible && hasActivePlayback;

  const handleLogout = async () => {
    clearAuthToken();
    await fetch('/api/auth/logout', { method: 'POST' });
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0A0B10] text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#F472B6]/10 border border-[#F472B6]/20 flex items-center justify-center">
            <Disc className="w-6 h-6 text-[#F472B6] animate-spin" />
          </div>
          <span className="text-xs text-zinc-400 font-medium tracking-wide">Loading Yimly...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-screen bg-[#0A0B10] text-zinc-100 overflow-hidden font-sans xl:grid ${
      isRightPanelVisible 
        ? 'xl:grid-cols-[230px_minmax(0,1fr)_346px]' 
        : 'xl:grid-cols-[230px_minmax(0,1fr)]'
    }`}>
      {/* Desktop & Tablet Sidebar */}
      <aside className="hidden xl:flex xl:col-start-1 xl:row-start-1 h-full w-full min-w-0 flex-col bg-[#11121A] border-r border-white/5">
          {/* Brand Header */}
          <div className="p-6 pb-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#F472B6] to-[#DB2777] flex items-center justify-center shadow-lg shadow-[#F472B6]/20">
                <Mic className="w-5 h-5 text-white" />
              </div>
              <div>
                <span className="text-xl font-bold tracking-tight text-white block leading-none">Yimly</span>
                <span className="text-[10px] text-zinc-400 font-medium tracking-wider uppercase mt-1 block">Karaoke Studio</span>
              </div>
            </div>
          </div>

          <NavigationSections
            user={user}
            expandedSection={expandedSection}
            onToggleSection={(section) => setExpandedSection(current => current === section ? null : section)}
            variant="desktop"
            onNavigate={() => {}}
          />

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
                className="p-1.5 text-zinc-400 hover:text-[#F472B6] hover:bg-[#F472B6]/10 rounded-lg transition-colors shrink-0"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
      </aside>

      {/* Mobile Drawer Backdrop & Menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 xl:hidden flex">
          <div 
            className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity" 
            onClick={() => setMobileMenuOpen(false)} 
          />
          <div className="relative w-4/5 max-w-xs bg-[#11121A] border-r border-white/10 h-full flex flex-col z-10 p-5">
            <div className="flex items-center justify-between pb-6 border-b border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#F472B6] flex items-center justify-center text-white shadow-md shadow-[#F472B6]/25">
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

            <NavigationSections
              user={user}
              expandedSection={expandedSection}
              onToggleSection={(section) => setExpandedSection(current => current === section ? null : section)}
              variant="mobile"
              onNavigate={() => setMobileMenuOpen(false)}
            />

            <div className="pt-4 border-t border-white/5 flex items-center justify-between">
              <div className="min-w-0">
                <span className="text-sm font-semibold text-white block truncate">{user?.username}</span>
                <span className="text-xs text-zinc-400 capitalize">{user?.role}</span>
              </div>
              <button 
                onClick={handleLogout}
                className="p-2 text-zinc-400 hover:text-[#F472B6] hover:bg-[#F472B6]/10 rounded-lg transition-colors"
                title="Logout"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex min-w-0 min-h-0 flex-col overflow-hidden bg-[#0A0B10] xl:col-start-2 xl:row-start-1">
        {/* Mobile Header Bar */}
        <div className="xl:hidden px-4 py-3 bg-[#11121A] border-b border-white/5 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#F472B6] flex items-center justify-center text-white">
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

        {/* Centre content occupies the middle column; the compact player overlays only this area when right panel is hidden. */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#0A0B10]">
          <main className={`min-h-0 min-w-0 flex-1 overflow-y-auto ${isBottomOverlayVisible ? 'pb-24 sm:pb-20' : 'pb-8'}`}>
            <Outlet context={{ user }} />
          </main>
          {isBottomOverlayVisible && <NowPlayingOverlay />}
        </div>
      </div>

      {/* Right panel is a separate full-height grid column, visible only on desktop music routes */}
      {isRightPanelVisible && (
        <aside className="hidden xl:flex xl:col-start-3 xl:row-start-1 h-full min-h-0 w-full min-w-0 overflow-hidden border-l border-white/5 bg-[#11121A]">
          <NowPlayingPanel />
        </aside>
      )}
    </div>
  );
}

type NavigationSection = 'jukebox' | 'settings';

function NavigationSections({
  user,
  expandedSection,
  onToggleSection,
  variant,
  onNavigate,
}: {
  user: any;
  expandedSection: NavigationSection | null;
  onToggleSection: (section: NavigationSection) => void;
  variant: 'desktop' | 'mobile';
  onNavigate: () => void;
}) {
  const isMobile = variant === 'mobile';
  const location = useLocation();
  const iconSize = isMobile ? 'w-5 h-5' : 'w-4 h-4';
  const isJukeboxActive = location.pathname === '/library' && (!location.search || location.search === '?tab=home');
  const isSettingsHomeActive = location.pathname === '/settings';

  return (
    <nav
      onClick={(event) => {
        // Delegate to the drawer so links that switch query-string tabs
        // (e.g. Songs -> Albums) also dismiss it reliably.
        if (isMobile && (event.target as HTMLElement).closest('a')) onNavigate();
      }}
      className={isMobile ? 'flex-1 py-6 space-y-2 overflow-y-auto' : 'flex-1 px-3 py-4 space-y-1.5 overflow-y-auto'}
    >
      {!isMobile && (
        <div className="px-3 pb-2 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Menu</div>
      )}
      <NavItem to="/" icon={<Home className={iconSize} />} label="Home" onNavigate={onNavigate} />

      <div className="space-y-1">
        <div className={`flex items-center rounded-xl transition-colors ${isJukeboxActive ? 'bg-[#F472B6]/15 border border-[#F472B6]/25' : 'hover:bg-white/5'}`}>
          <NavLink to="/library" onClick={() => { onNavigate(); window.dispatchEvent(new Event('yimly:navigate-library-section')); }} className={`flex min-w-0 flex-1 items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium ${isJukeboxActive ? 'text-[#F472B6] font-semibold' : 'text-zinc-400 hover:text-white'}`} aria-current={isJukeboxActive ? 'page' : undefined}>
            <Music className={iconSize} /><span>Jukebox</span>
          </NavLink>
          <button type="button" onClick={() => onToggleSection('jukebox')} className="mr-1 p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors" aria-label={expandedSection === 'jukebox' ? 'Collapse Jukebox menu' : 'Expand Jukebox menu'} aria-expanded={expandedSection === 'jukebox'}>
            {expandedSection === 'jukebox' ? <ChevronUp className={iconSize} /> : <ChevronDown className={iconSize} />}
          </button>
        </div>
        {expandedSection === 'jukebox' && (
          <div className="pl-4 space-y-1">
            <NavItem to="/library?tab=songs" icon={<Music className={iconSize} />} label="Songs" onNavigate={onNavigate} />
            <NavItem to="/library?tab=albums" icon={<Disc className={iconSize} />} label="Albums" onNavigate={onNavigate} />
            <NavItem to="/library?tab=artists" icon={<Mic className={iconSize} />} label="Artists" onNavigate={onNavigate} />
            <NavItem to="/library?tab=playlists" icon={<ListMusic className={iconSize} />} label="Playlists" onNavigate={onNavigate} />
          </div>
        )}
      </div>

      <NavItem to="/rooms" icon={<Radio className={iconSize} />} label="Karaoke Room" onNavigate={onNavigate} />

      <div className="space-y-1">
        <div className={`flex items-center rounded-xl transition-colors ${isSettingsHomeActive ? 'bg-[#F472B6]/15 border border-[#F472B6]/25' : 'hover:bg-white/5'}`}>
          <NavLink to="/settings" onClick={onNavigate} className={`flex min-w-0 flex-1 items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium ${isSettingsHomeActive ? 'text-[#F472B6] font-semibold' : 'text-zinc-400 hover:text-white'}`} aria-current={location.pathname === '/settings' ? 'page' : undefined}>
            <Settings className={iconSize} /><span>Settings</span>
          </NavLink>
          <button type="button" onClick={() => onToggleSection('settings')} className="mr-1 p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors" aria-label={expandedSection === 'settings' ? 'Collapse Settings menu' : 'Expand Settings menu'} aria-expanded={expandedSection === 'settings'}>
            {expandedSection === 'settings' ? <ChevronUp className={iconSize} /> : <ChevronDown className={iconSize} />}
          </button>
        </div>
        {expandedSection === 'settings' && user?.role === 'administrator' && (
          <div className="pl-4 space-y-1">
            <NavItem to="/download" icon={<Download className={iconSize} />} label="Download Music" onNavigate={onNavigate} />
            <NavItem to="/users" icon={<Users className={iconSize} />} label="Users" onNavigate={onNavigate} />
          </div>
        )}
      </div>
    </nav>
  );
}

function NavItem({ to, icon, label, badge, activeWhen, onNavigate }: { to: string, icon: ReactNode, label: string, badge?: string, activeWhen?: boolean, onNavigate?: () => void }) {
  const location = useLocation();
  const currentUrl = location.pathname + location.search;

  let isActive = activeWhen ?? false;
  if (activeWhen === undefined) {
    if (to === '/') {
      isActive = location.pathname === '/';
    } else if (to.includes('?')) {
      isActive = currentUrl === to;
    } else {
      isActive = location.pathname === to && (!location.search || location.search === '?tab=home');
    }
  }

  return (
    <NavLink
      to={to}
      onClick={() => {
        onNavigate?.();
        if (to.startsWith('/library')) {
          // Clear local detail views even when the clicked tab URL is already current.
          window.dispatchEvent(new Event('yimly:navigate-library-section'));
        }
      }}
      className={
        `flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all text-sm font-medium ${
          isActive 
            ? 'bg-[#F472B6]/15 text-[#F472B6] font-semibold border border-[#F472B6]/25 shadow-sm' 
            : 'text-zinc-400 hover:text-white hover:bg-white/5'
        }`
      }
    >
      <div className="flex items-center gap-3">
        {icon}
        <span>{label}</span>
      </div>
      {badge && (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#F472B6]/20 text-[#F472B6] border border-[#F472B6]/30">
          {badge}
        </span>
      )}
    </NavLink>
  );
}
