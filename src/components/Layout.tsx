import { useEffect, useState, ReactNode } from 'react';
import { Outlet, useNavigate, NavLink, useLocation } from 'react-router-dom';
import { Home, Music, Mic, Settings, Users, LogOut, Disc, Menu, X, Radio, Download, ChevronUp, ChevronDown, ListMusic } from 'lucide-react';
import { clearAuthToken } from '../lib/auth';
import PlayerBar from './PlayerBar';
import NowPlayingOverlay from './NowPlayingOverlay';
import NowPlayingPanel from './NowPlayingPanel';

export default function Layout() {
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

  // Scroll-reactive artwork is driven by a tiny rAF-throttled fallback.
  // Depend on loading so the effect attaches after the authenticated layout mounts <main>.
  // This behaves consistently in mobile browsers/WebViews regardless of partial CSS timeline support.
  useEffect(() => {
    if (loading) return;
    const main = document.querySelector<HTMLElement>('main');
    if (!main) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let observed: HTMLElement[] = [];

    const updateArtwork = () => {
      frame = 0;
      if (reducedMotion.matches) {
        observed.forEach((element) => {
          element.style.setProperty('--yk-scroll-translate', '0px');
          element.style.setProperty('--yk-artwork-opacity', '1');
          element.style.setProperty('--yk-scroll-scale', '1');
          element.style.setProperty('--yk-scroll-rotate-x', '0deg');
          element.style.setProperty('--yk-scroll-rotate-y', '0deg');
        });
        return;
      }

      const viewport = main.getBoundingClientRect();
      observed.forEach((element) => {
        const rect = element.getBoundingClientRect();
        const height = Math.max(viewport.height, 1);
        const progress = (rect.top + rect.height / 2 - viewport.top) / height;
        // Make the scroll response visible on a phone-sized viewport:
        // artwork shifts up/down by up to 24px and gently scales as it crosses the centre.
        const width = Math.max(viewport.width, 1);
        const horizontalProgress = (rect.left + rect.width / 2 - viewport.left) / width;
        const distanceFromCentre = Math.min(1, Math.abs(progress - 0.5) * 2);
        const offset = Math.max(-24, Math.min(24, (0.5 - progress) * 48));
        const scale = 1.08 - distanceFromCentre * 0.16;
        const visibility = 1 - distanceFromCentre * 0.28;
        // Tilt follows vertical scroll position, while horizontal position adds a subtle card-like angle.
        const rotateX = Math.max(-6, Math.min(6, (0.5 - progress) * 12));
        const rotateY = Math.max(-6, Math.min(6, (horizontalProgress - 0.5) * 12));
        element.style.setProperty('--yk-scroll-translate', `${offset.toFixed(2)}px`);
        element.style.setProperty('--yk-scroll-scale', scale.toFixed(3));
        element.style.setProperty('--yk-artwork-opacity', visibility.toFixed(3));
        element.style.setProperty('--yk-scroll-rotate-x', `${rotateX.toFixed(2)}deg`);
        element.style.setProperty('--yk-scroll-rotate-y', `${rotateY.toFixed(2)}deg`);
      });
    };

    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(updateArtwork);
    };

    const refreshArtwork = () => {
      observed = Array.from(main.querySelectorAll<HTMLElement>('.yk-artwork-motion'));
      scheduleUpdate();
    };

    const mutationObserver = new MutationObserver(refreshArtwork);
    mutationObserver.observe(main, { childList: true, subtree: true });
    main.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('scroll', scheduleUpdate, { passive: true, capture: true });
    window.addEventListener('resize', scheduleUpdate, { passive: true });
    reducedMotion.addEventListener('change', scheduleUpdate);
    refreshArtwork();

    return () => {
      mutationObserver.disconnect();
      main.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate, true);
      window.removeEventListener('resize', scheduleUpdate);
      reducedMotion.removeEventListener('change', scheduleUpdate);
      if (frame) window.cancelAnimationFrame(frame);
      observed.forEach((element) => {
        element.style.removeProperty('--yk-scroll-translate');
        element.style.removeProperty('--yk-artwork-opacity');
        element.style.removeProperty('--yk-scroll-scale');
        element.style.removeProperty('--yk-scroll-rotate-x');
        element.style.removeProperty('--yk-scroll-rotate-y');
      });
    };
  }, [loading]);

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


  const handleLogout = async () => {
    clearAuthToken();
    await fetch('/api/auth/logout', { method: 'POST' });
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0A0B10] text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#FA243C]/10 border border-[#FA243C]/20 flex items-center justify-center">
            <Disc className="w-6 h-6 text-[#FA243C] animate-spin" />
          </div>
          <span className="text-xs text-zinc-400 font-medium tracking-wide">Loading Yimly...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#0A0B10] text-zinc-100 overflow-hidden font-sans xl:grid xl:grid-cols-[230px_minmax(0,1fr)_346px]">
      {/* Desktop & Tablet Sidebar */}
      <aside className="hidden xl:flex xl:col-start-1 xl:row-start-1 h-full w-full min-w-0 flex-col bg-[#11121A] border-r border-white/5">
          {/* Brand Header */}
          <div className="p-6 pb-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#FA243C] to-[#d91e36] flex items-center justify-center shadow-lg shadow-[#FA243C]/20">
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
                className="p-1.5 text-zinc-400 hover:text-[#FA243C] hover:bg-[#FA243C]/10 rounded-lg transition-colors shrink-0"
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
                <div className="w-9 h-9 rounded-xl bg-[#FA243C] flex items-center justify-center text-white shadow-md shadow-[#FA243C]/25">
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
                className="p-2 text-zinc-400 hover:text-[#FA243C] hover:bg-[#FA243C]/10 rounded-lg transition-colors"
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
              <div className="w-8 h-8 rounded-lg bg-[#FA243C] flex items-center justify-center text-white">
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

        {/* Centre content occupies the middle column; the player overlays only this area. */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#0A0B10]">
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto pb-28">
            <Outlet context={{ user }} />
          </main>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 hidden xl:block">
            <div className="pointer-events-auto">
              <PlayerBar />
            </div>
          </div>
          <NowPlayingOverlay />
        </div>
      </div>

      {/* Right panel is a separate full-height grid column, outside the player overlay. */}
      <aside className="hidden xl:flex xl:col-start-3 xl:row-start-1 h-full min-h-0 w-full min-w-0 overflow-hidden border-l border-white/5 bg-[#11121A]">
          <NowPlayingPanel />
      </aside>
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
        <div className={`flex items-center rounded-xl transition-colors ${isJukeboxActive ? 'bg-[#FA243C]/15 border border-[#FA243C]/25' : 'hover:bg-white/5'}`}>
          <NavLink to="/library" onClick={onNavigate} className={`flex min-w-0 flex-1 items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium ${isJukeboxActive ? 'text-[#FA243C] font-semibold' : 'text-zinc-400 hover:text-white'}`} aria-current={isJukeboxActive ? 'page' : undefined}>
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
        <div className={`flex items-center rounded-xl transition-colors ${isSettingsHomeActive ? 'bg-[#FA243C]/15 border border-[#FA243C]/25' : 'hover:bg-white/5'}`}>
          <NavLink to="/settings" onClick={onNavigate} className={`flex min-w-0 flex-1 items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium ${isSettingsHomeActive ? 'text-[#FA243C] font-semibold' : 'text-zinc-400 hover:text-white'}`} aria-current={location.pathname === '/settings' ? 'page' : undefined}>
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
      onClick={onNavigate}
      className={
        `flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all text-sm font-medium ${
          isActive 
            ? 'bg-[#FA243C]/15 text-[#FA243C] font-semibold border border-[#FA243C]/25 shadow-sm' 
            : 'text-zinc-400 hover:text-white hover:bg-white/5'
        }`
      }
    >
      <div className="flex items-center gap-3">
        {icon}
        <span>{label}</span>
      </div>
      {badge && (
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#FA243C]/20 text-[#FA243C] border border-[#FA243C]/30">
          {badge}
        </span>
      )}
    </NavLink>
  );
}
