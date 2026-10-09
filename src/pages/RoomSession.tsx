import { useState, useEffect, useRef, useCallback, ChangeEvent } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import QRCode from 'qrcode';
import GuestRoom from '../components/GuestRoom';
import { AutoResponsiveLyrics } from '../components/AutoResponsiveLyrics';
import { 
  getLyricsSettings, 
  fetchServerLyricsSettings,
  resolveLyricsSettings,
  LyricsAppearanceSettings, 
  applyTextCase, 
  getFontFamilyStyle,
  getFontFamilyClass, 
  getAlignmentClass 
} from '../utils/lyricsSettings';
import { 
  Play, Pause, SkipForward, RotateCcw, Mic, Music, 
  FileText, ArrowLeft, Plus, Radio, Check, AlertCircle, 
  User, Library as LibraryIcon, Search, X, RefreshCw,
  Maximize2, Minimize2, Info, LogOut, QrCode, Clock, Volume2
} from 'lucide-react';
import { filterSongs, SearchableSong } from '../lib/search-utils';
import { getAuthToken } from '../lib/auth';

export interface LyricWord {
  text: string;
  start: number;
}

export interface LyricLine {
  time: number;
  text: string;
  words?: LyricWord[];
}

interface SongItem extends SearchableSong {}

type ValidationStatus = 'loading' | 'valid' | 'not_found' | 'expired' | 'invalid_controller' | 'error';

export default function RoomSession() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const roleParam = searchParams.get('role');
  const urlControllerId = searchParams.get('controllerId');
  const getStoredControllerId = (sId?: string): string | null => {
    if (!sId) return null;
    try {
      return localStorage.getItem(`yimly_controller_${sId}`);
    } catch {
      return null;
    }
  };
  const controllerId = urlControllerId || getStoredControllerId(sessionId);
  const isHost = roleParam === 'host';

  useEffect(() => {
    if (sessionId && urlControllerId) {
      try {
        localStorage.setItem(`yimly_controller_${sessionId}`, urlControllerId);
      } catch {}
    }
  }, [sessionId, urlControllerId]);

  const [validationStatus, setValidationStatus] = useState<ValidationStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [guestUsername, setGuestUsername] = useState<string>('');

  const [session, setSession] = useState<any>(null);
  const [queue, setQueue] = useState<any[]>([]);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Advanced features state
  const [variant, setVariant] = useState<'original' | 'instrumental'>('original');
  const [lrcOffset, setLrcOffset] = useState<number>(0); // in ms
  const [elrcOffset, setElrcOffset] = useState<number>(0); // in ms
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [lyricsSettings, setLyricsSettings] = useState<LyricsAppearanceSettings>(() => {
    return getLyricsSettings();
  });
  const [currentSongDetails, setCurrentSongDetails] = useState<any>(null);

  const lastSongIdRef = useRef<number | null>(null);
  const prevSettingsJsonRef = useRef<string>('');

  // Synchronize and subscribe to canonical lyrics settings across storage, tabs, visibility, and session lifecycle
  useEffect(() => {
    const current = getLyricsSettings();
    setLyricsSettings(current);
    prevSettingsJsonRef.current = JSON.stringify(current);

    fetchServerLyricsSettings(sessionId).then((srv) => {
      if (srv) {
        setLyricsSettings(srv);
        prevSettingsJsonRef.current = JSON.stringify(srv);
      }
    });

    console.log('[LyricSettings] Host initialized');
    console.log('[LyricSettings] source: localStorage / server');
    console.log(`[LyricSettings] session: ${sessionId || 'unknown'}`);
    console.log(`[LyricSettings] font: ${current.highlighted.font}`);
    console.log(`[LyricSettings] currentSize: ${current.highlighted.size}`);
    console.log(`[LyricSettings] otherSize: ${current.unhighlighted.size}`);

    const handleSettingsChange = (e: any) => {
      const updated = e?.detail ? resolveLyricsSettings(e.detail) : getLyricsSettings();
      console.log('[LyricSettings] Updated from settings change event:', updated);
      setLyricsSettings(updated);
      prevSettingsJsonRef.current = JSON.stringify(updated);
    };

    const handleStorageChange = (e: StorageEvent) => {
      if (!e.key || e.key === 'yimly_lyrics_appearance_settings_v1') {
        const updated = getLyricsSettings();
        console.log('[LyricSettings] Updated from storage event:', updated);
        setLyricsSettings(updated);
        prevSettingsJsonRef.current = JSON.stringify(updated);
      }
    };

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        const latest = getLyricsSettings();
        setLyricsSettings(latest);
        prevSettingsJsonRef.current = JSON.stringify(latest);
      }
    };

    window.addEventListener('yimly_lyrics_settings_changed', handleSettingsChange);
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      window.removeEventListener('yimly_lyrics_settings_changed', handleSettingsChange);
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [sessionId]);
  const [showLibrary, setShowLibrary] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lyricsFormat, setLyricsFormat] = useState<'elrc' | 'lrc'>('elrc');
  const rawLyricsRef = useRef<string>('');

  const handleToggleLyricsFormat = () => {
    if (!currentSongDetails?.hasElrc) return;
    const newFormat = lyricsFormat === 'elrc' ? 'lrc' : 'elrc';
    setLyricsFormat(newFormat);
    if (rawLyricsRef.current) {
      const parsed = parseLrc(rawLyricsRef.current, newFormat);
      setLyrics(parsed);
    }
  };
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [isRestartingSession, setIsRestartingSession] = useState(false);

  // Overflow menu and modals state (Host Only)
  const [showEndSessionModal, setShowEndSessionModal] = useState(false);
  const [showSessionInfoModal, setShowSessionInfoModal] = useState(false);

  // Library modal search & songs (for Guest Controller)
  const [availableSongs, setAvailableSongs] = useState<SongItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [librarySearchResults, setLibrarySearchResults] = useState<SongItem[]>([]);
  const [externalSearchResults, setExternalSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addingSongId, setAddingSongId] = useState<number | null>(null);
  const [addedSongId, setAddedSongId] = useState<number | null>(null);
  const [audioAutoplayBlocked, setAudioAutoplayBlocked] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const restorePositionRef = useRef<{ time: number, playing: boolean } | null>(null);

  // TV Remote / D-pad Navigation Focus Management
  const playButtonRef = useRef<HTMLButtonElement>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const lastFocusedTvIdRef = useRef<string | null>(null);
  const initialFocusSetRef = useRef(false);

  // Safe focus helper that prevents scroll on older WebKit and resets unwanted scroll
  const safeFocus = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    try {
      el.focus({ preventScroll: true });
    } catch (e) {
      try {
        el.focus();
      } catch (err) {}
    }
    if (typeof window !== 'undefined') {
      if (window.scrollX !== 0 || window.scrollY !== 0) {
        try {
          window.scrollTo(0, 0);
        } catch (e) {}
      }
      const rootEl = document.getElementById('room-session-root');
      if (rootEl && (rootEl.scrollTop !== 0 || rootEl.scrollLeft !== 0)) {
        rootEl.scrollTop = 0;
        rootEl.scrollLeft = 0;
      }
      const contentEl = document.getElementById('room-session-content');
      if (contentEl && (contentEl.scrollTop !== 0 || contentEl.scrollLeft !== 0)) {
        contentEl.scrollTop = 0;
        contentEl.scrollLeft = 0;
      }
      const sidebarEl = document.getElementById('room-session-sidebar');
      if (sidebarEl && (sidebarEl.scrollTop !== 0 || sidebarEl.scrollLeft !== 0)) {
        sidebarEl.scrollTop = 0;
        sidebarEl.scrollLeft = 0;
      }
      const mainEl = document.getElementById('room-session-main');
      if (mainEl && (mainEl.scrollTop !== 0 || mainEl.scrollLeft !== 0)) {
        mainEl.scrollTop = 0;
        mainEl.scrollLeft = 0;
      }
    }
  }, []);

  // Ensure host room layout stays anchored at (0, 0) and does not scroll
  useEffect(() => {
    const handleScroll = () => {
      if (typeof window !== 'undefined' && (window.scrollY !== 0 || window.scrollX !== 0)) {
        window.scrollTo(0, 0);
      }
      const rootEl = document.getElementById('room-session-root');
      if (rootEl && rootEl.scrollTop !== 0) rootEl.scrollTop = 0;
      const contentEl = document.getElementById('room-session-content');
      if (contentEl && contentEl.scrollTop !== 0) contentEl.scrollTop = 0;
      const sidebarEl = document.getElementById('room-session-sidebar');
      if (sidebarEl && sidebarEl.scrollTop !== 0) sidebarEl.scrollTop = 0;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Track last focused element ID
  useEffect(() => {
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target && target !== document.body) {
        lastFocusedElementRef.current = target;
        const tvId = target.getAttribute('data-tv-id');
        if (tvId) {
          lastFocusedTvIdRef.current = tvId;
        }
      }
    };
    window.addEventListener('focusin', handleFocusIn);
    return () => window.removeEventListener('focusin', handleFocusIn);
  }, []);

  // Initial focus placement on Play button or primary action when Host room opens
  useEffect(() => {
    if (validationStatus === 'valid' && isHost) {
      if (initialFocusSetRef.current) return;
      const focusPrimary = () => {
        if (initialFocusSetRef.current) return;
        if (playButtonRef.current && !playButtonRef.current.hasAttribute('disabled')) {
          safeFocus(playButtonRef.current);
          initialFocusSetRef.current = true;
          return;
        }
        const candidate = document.querySelector<HTMLElement>(
          '[data-tv-id="play-button"], [data-tv-id="start-session-button"], [data-tv-id="header-start-session-button"]'
        );
        if (candidate && !candidate.hasAttribute('disabled')) {
          safeFocus(candidate);
          initialFocusSetRef.current = true;
        }
      };

      const t1 = setTimeout(focusPrimary, 100);
      const t2 = setTimeout(focusPrimary, 400);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [validationStatus, isHost, session?.id, safeFocus]);

  // Focus recovery if focus lands back on body unexpectedly during TV navigation
  useEffect(() => {
    if (validationStatus === 'valid' && isHost && lastFocusedTvIdRef.current) {
      if (document.activeElement === document.body) {
        const prevEl = document.querySelector<HTMLElement>(`[data-tv-id="${lastFocusedTvIdRef.current}"]`);
        if (prevEl && !prevEl.hasAttribute('disabled')) {
          safeFocus(prevEl);
        }
      }
    }
  }, [validationStatus, isHost, safeFocus]);

  // Overlay Focus Traps and Restoration
  useEffect(() => {
    if (showEndSessionModal) {
      const t = setTimeout(() => {
        const cancelBtn = document.querySelector<HTMLElement>('[data-tv-id="end-session-cancel"]');
        if (cancelBtn) cancelBtn.focus();
      }, 50);
      return () => clearTimeout(t);
    }
  }, [showEndSessionModal]);

  useEffect(() => {
    if (showSessionInfoModal) {
      const t = setTimeout(() => {
        const closeBtn = document.querySelector<HTMLElement>('[data-tv-id="session-info-close"]');
        if (closeBtn) closeBtn.focus();
      }, 50);
      return () => clearTimeout(t);
    }
  }, [showSessionInfoModal]);

  useEffect(() => {
    if (showLibrary) {
      const t = setTimeout(() => {
        const searchInput = document.querySelector<HTMLElement>('[data-tv-id="library-search"]');
        if (searchInput) searchInput.focus();
      }, 50);
      return () => clearTimeout(t);
    }
  }, [showLibrary]);

  // Keydown Spatial & Back Key Handler for TV Remote / Keyboard
  useEffect(() => {
    if (!isHost) return;

    const getFocusable = (container: HTMLElement | Document = document): HTMLElement[] => {
      const selectors = [
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"]):not([disabled])',
        'a[href]'
      ].join(',');

      return Array.from(container.querySelectorAll<HTMLElement>(selectors)).filter(el => {
        if (el.offsetWidth === 0 || el.offsetHeight === 0) return false;
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
        return true;
      });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key;
      const keyCode = e.keyCode;

      const isDpad = key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight' ||
                     keyCode === 38 || keyCode === 40 || keyCode === 37 || keyCode === 39;

      const isSelect = key === 'Enter' || key === ' ' || key === 'Select' ||
                       keyCode === 13 || keyCode === 32 || keyCode === 29443;

      const isBack = key === 'Escape' || key === 'Backspace' || key === 'GoBack' ||
                     keyCode === 27 || keyCode === 8 || keyCode === 10009 || keyCode === 461;

      // 1. Handle TV Remote Back / Escape Key
      if (isBack) {
        if (showEndSessionModal) {
          e.preventDefault();
          setShowEndSessionModal(false);
          lastFocusedElementRef.current?.focus();
          return;
        }
        if (showSessionInfoModal) {
          e.preventDefault();
          setShowSessionInfoModal(false);
          lastFocusedElementRef.current?.focus();
          return;
        }
        if (showLibrary) {
          e.preventDefault();
          setShowLibrary(false);
          lastFocusedElementRef.current?.focus();
          return;
        }
        // Return focus to Play button if somewhere else
        const playBtn = playButtonRef.current || document.querySelector<HTMLElement>('[data-tv-id="play-button"]');
        if (playBtn && document.activeElement !== playBtn && !playBtn.hasAttribute('disabled')) {
          e.preventDefault();
          playBtn.focus();
          return;
        }
      }

      // 2. Handle OK / Select Key when focus is on body or non-interactive container
      if (isSelect) {
        if (document.activeElement === document.body) {
          e.preventDefault();
          const playBtn = playButtonRef.current || document.querySelector<HTMLElement>('[data-tv-id="play-button"], [data-tv-id="start-session-button"]');
          if (playBtn) {
            playBtn.focus();
            playBtn.click();
          }
          return;
        }
      }

      // 3. Handle D-pad Spatial Navigation
      if (isDpad) {
        const activeEl = (document.activeElement as HTMLElement) || document.body;

        // Allow range slider native left/right adjustment
        if (activeEl.tagName === 'INPUT' && (activeEl as HTMLInputElement).type === 'range') {
          if (key === 'ArrowLeft' || key === 'ArrowRight' || keyCode === 37 || keyCode === 39) {
            return;
          }
        }

        // Allow text input left/right cursor movement
        if (activeEl.tagName === 'INPUT' && (activeEl as HTMLInputElement).type === 'text') {
          if (key === 'ArrowLeft' || key === 'ArrowRight' || keyCode === 37 || keyCode === 39) {
            return;
          }
        }

        e.preventDefault();

        const isRight = key === 'ArrowRight' || keyCode === 39;
        const isLeft = key === 'ArrowLeft' || keyCode === 37;
        const isDown = key === 'ArrowDown' || keyCode === 40;
        const isUp = key === 'ArrowUp' || keyCode === 38;

        // Determine container scope
        let searchContainer: HTMLElement | Document = document;
        if (showEndSessionModal || showSessionInfoModal || showLibrary) {
          const activeModal = document.querySelector<HTMLElement>('.fixed.inset-0 > div, .fixed.inset-0');
          if (activeModal) {
            searchContainer = activeModal;
          }
        }

        const candidates = getFocusable(searchContainer);
        if (candidates.length === 0) return;

        if (activeEl === document.body || !searchContainer.contains(activeEl)) {
          const defaultTarget = candidates.find(c => c.getAttribute('data-tv-id') === 'play-button') || candidates[0];
          if (defaultTarget) defaultTarget.focus();
          return;
        }

        const navCandidates = candidates.filter(c => c !== activeEl);
        if (navCandidates.length === 0) return;

        const activeRect = activeEl.getBoundingClientRect();
        const activeCenterX = activeRect.left + activeRect.width / 2;
        const activeCenterY = activeRect.top + activeRect.height / 2;

        let bestCandidate: HTMLElement | null = null;
        let minScore = Infinity;

        for (const cand of navCandidates) {
          const candRect = cand.getBoundingClientRect();
          const candCenterX = candRect.left + candRect.width / 2;
          const candCenterY = candRect.top + candRect.height / 2;

          let isDirectionValid = false;
          let score = Infinity;

          if (isRight) {
            if (candCenterX > activeCenterX + 2 || candRect.left >= activeRect.right - 5) {
              isDirectionValid = true;
              const dx = Math.max(0, candRect.left - activeRect.right);
              const dy = Math.abs(candCenterY - activeCenterY);
              score = dx + dy * 2.5;
            }
          } else if (isLeft) {
            if (candCenterX < activeCenterX - 2 || candRect.right <= activeRect.left + 5) {
              isDirectionValid = true;
              const dx = Math.max(0, activeRect.left - candRect.right);
              const dy = Math.abs(candCenterY - activeCenterY);
              score = dx + dy * 2.5;
            }
          } else if (isDown) {
            if (candCenterY > activeCenterY + 2 || candRect.top >= activeRect.bottom - 5) {
              isDirectionValid = true;
              const dy = Math.max(0, candRect.top - activeRect.bottom);
              const dx = Math.abs(candCenterX - activeCenterX);
              score = dy + dx * 2.5;
            }
          } else if (isUp) {
            if (candCenterY < activeCenterY - 2 || candRect.bottom <= activeRect.top + 5) {
              isDirectionValid = true;
              const dy = Math.max(0, activeRect.top - candRect.bottom);
              const dx = Math.abs(candCenterX - activeCenterX);
              score = dy + dx * 2.5;
            }
          }

          if (isDirectionValid && score < minScore) {
            minScore = score;
            bestCandidate = cand;
          }
        }

        if (bestCandidate) {
          bestCandidate.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isHost, showEndSessionModal, showSessionInfoModal, showLibrary]);

  // Feature detect if native Element Fullscreen API is available
  const isNativeFullscreenSupported = () => {
    if (typeof document === 'undefined') return false;
    const doc = document as any;
    const docEl = document.documentElement as any;
    return Boolean(
      (docEl.requestFullscreen ||
       docEl.webkitRequestFullscreen ||
       docEl.mozRequestFullScreen ||
       docEl.msRequestFullscreen) &&
      doc.fullscreenEnabled !== false &&
      doc.webkitFullscreenEnabled !== false &&
      doc.mozFullScreenEnabled !== false &&
      doc.msFullscreenEnabled !== false
    );
  };

  // Fullscreen change listener with vendor prefixes for iOS Safari
  useEffect(() => {
    const handleFullscreenChange = () => {
      const doc = document as any;
      const fsEl = doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement;
      setIsFullscreen(Boolean(fsEl));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.documentElement.classList.remove('ios-fullscreen-fallback');
      document.body.classList.remove('ios-fullscreen-fallback');
    };
  }, []);

  const toggleFullscreen = () => {
    try {
      const doc = document as any;
      const docEl = document.documentElement as any;

      if (isNativeFullscreenSupported()) {
        const fsEl = doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement;

        if (!fsEl) {
          if (docEl.requestFullscreen) {
            docEl.requestFullscreen().catch((err: any) => console.warn('Fullscreen request failed:', err));
          } else if (docEl.webkitRequestFullscreen) {
            docEl.webkitRequestFullscreen();
          } else if (docEl.msRequestFullscreen) {
            docEl.msRequestFullscreen();
          }
        } else {
          if (doc.exitFullscreen) {
            doc.exitFullscreen().catch((err: any) => console.warn('Exit fullscreen failed:', err));
          } else if (doc.webkitExitFullscreen) {
            doc.webkitExitFullscreen();
          } else if (doc.msExitFullscreen) {
            doc.msExitFullscreen();
          }
        }
        return;
      }

      // Fallback ONLY for legacy browsers lacking native Element Fullscreen API (iOS 10 Safari)
      const nextFullscreen = !isFullscreen;
      setIsFullscreen(nextFullscreen);

      if (nextFullscreen) {
        document.documentElement.classList.add('ios-fullscreen-fallback');
        document.body.classList.add('ios-fullscreen-fallback');
        try {
          window.scrollTo(0, 1);
        } catch (e) {}
      } else {
        document.documentElement.classList.remove('ios-fullscreen-fallback');
        document.body.classList.remove('ios-fullscreen-fallback');
      }

      try {
        window.dispatchEvent(new Event('resize'));
      } catch (e) {}
    } catch (e) {
      console.warn('Fullscreen toggle failed:', e);
    }
  };

  // Generate QR code for guest join
  useEffect(() => {
    if (session?.roomCode) {
      const cleanCode = String(session.roomCode).replace(/\s+/g, '');
      const joinUrl = `${window.location.origin}/join?session=${cleanCode}`;
      QRCode.toDataURL(joinUrl, {
        width: 320,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      })
        .then(url => setQrCodeDataUrl(url))
        .catch(err => console.error('QR generation error:', err));
    }
  }, [session?.roomCode]);

  // 1. Initial Validation on Mount
  useEffect(() => {
    let isMounted = true;

    async function validate() {
      if (!sessionId) {
        setValidationStatus('not_found');
        setErrorMessage('Session ID is missing.');
        return;
      }

      try {
        const query = new URLSearchParams({
          role: roleParam || 'guest',
          ...(controllerId ? { controllerId } : {})
        });

        const res = await fetch(`/api/karaoke/sessions/${sessionId}/validate?${query.toString()}`);
        let data: any = {};
        if (res.headers.get('content-type')?.includes('application/json')) {
          try {
            data = await res.json();
          } catch (e) {
            console.error('Failed to parse validation JSON response:', e);
          }
        }

        if (!isMounted) return;

        if (res.ok && data.valid) {
          setSession(data.session);
          if (data.guestUsername) {
            setGuestUsername(data.guestUsername);
          }
          if (data.lyricSettings) {
            const resolved = resolveLyricsSettings(data.lyricSettings);
            setLyricsSettings(resolved);
            prevSettingsJsonRef.current = JSON.stringify(resolved);
          }
          setValidationStatus('valid');
        } else {
          if (data.code === 'ROOM_NOT_FOUND' || res.status === 404) {
            setValidationStatus('not_found');
            setErrorMessage(data.error || 'The requested karaoke room does not exist.');
          } else if (data.code === 'ROOM_EXPIRED' || res.status === 410) {
            setValidationStatus('expired');
            setErrorMessage(data.error || 'This karaoke room has ended or expired.');
          } else if (data.code === 'INVALID_CONTROLLER' || data.code === 'CONTROLLER_REQUIRED' || res.status === 403) {
            setValidationStatus('invalid_controller');
            setErrorMessage(data.error || 'Guest access rejected: invalid or missing controller credentials.');
          } else {
            setValidationStatus('error');
            setErrorMessage(data.error || 'Unable to access room.');
          }
        }
      } catch (err: any) {
        if (!isMounted) return;
        console.error('Validation error:', err);
        setValidationStatus('error');
        setErrorMessage('Failed to connect to the karaoke server.');
      }
    }

    validate();

    return () => {
      isMounted = false;
    };
  }, [sessionId, roleParam, controllerId]);

  // 2. Fetch Session State & Queue
  const fetchState = async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/karaoke/sessions/${sessionId}/state`);
      if (res.ok) {
        const data = await res.json();
        setSession(data.session);
        setQueue(data.queue || []);
        if (data.lyricSettings || data.playback?.lyricSettings) {
          const resolved = resolveLyricsSettings(data.lyricSettings || data.playback.lyricSettings);
          setLyricsSettings(resolved);
          prevSettingsJsonRef.current = JSON.stringify(resolved);
        }
        if (data.playback) {
          if (typeof data.playback.playing === 'boolean') {
            setPlaying(data.playback.playing);
          }
          if (data.playback.variant) {
            setVariant(data.playback.variant);
          }
          if (typeof data.playback.lrcOffset === 'number') {
            setLrcOffset(data.playback.lrcOffset);
          } else if (typeof data.playback.lyricOffset === 'number') {
            setLrcOffset(data.playback.lyricOffset);
          }
          if (typeof data.playback.elrcOffset === 'number') {
            setElrcOffset(data.playback.elrcOffset);
          } else if (typeof data.playback.lyricOffset === 'number') {
            setElrcOffset(data.playback.lyricOffset);
          }
        }
      }
    } catch (e) {
      console.error('[STATE] Failed to fetch session state:', e);
    }
  };

  // 3. Connect WebSocket with auto-reconnect & state synchronization
  useEffect(() => {
    if (validationStatus !== 'valid' || !sessionId) return;

    let socket: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let isClosedIntentionally = false;

    fetchState();

    function connect() {
      if (isClosedIntentionally) return;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const token = getAuthToken();
      const tokenQuery = token ? `&token=${encodeURIComponent(token)}` : '';
      socket = new WebSocket(`${protocol}//${window.location.host}/ws/karaoke?sessionId=${sessionId}&isHost=${isHost}${tokenQuery}`);

      socket.onopen = () => {
        // Re-fetch authoritative state on connect/reconnect
        fetchState();
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch(msg.type) {
            case 'PING':
              if (socket?.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'PONG' }));
              }
              break;
            case 'HEARTBEAT_ACK':
              break;
            case 'STATE_UPDATE':
              if (typeof msg.payload?.playing === 'boolean') setPlaying(msg.payload.playing);
              if (msg.payload?.variant) setVariant(msg.payload.variant);
              if (typeof msg.payload?.lrcOffset === 'number') setLrcOffset(msg.payload.lrcOffset);
              if (typeof msg.payload?.elrcOffset === 'number') setElrcOffset(msg.payload.elrcOffset);
              if (msg.payload?.lyricSettings) {
                const resolved = resolveLyricsSettings(msg.payload.lyricSettings);
                setLyricsSettings(resolved);
                prevSettingsJsonRef.current = JSON.stringify(resolved);
              }
              fetchState();
              break;
            case 'QUEUE_UPDATED':
            case 'QUEUE_EMPTY':
              fetchState();
              break;
            case 'PLAYING':
              setPlaying(true);
              break;
            case 'PAUSED':
              setPlaying(false);
              break;
            case 'RESTARTED':
              if (audioRef.current) {
                audioRef.current.currentTime = 0;
                setCurrentTime(0);
              }
              break;
            case 'SONG_CHANGED':
              if (typeof msg.payload?.lrcOffset === 'number') {
                setLrcOffset(msg.payload.lrcOffset);
              }
              if (typeof msg.payload?.elrcOffset === 'number') {
                setElrcOffset(msg.payload.elrcOffset);
              }
              fetchState();
              setPlaying(true);
              break;
            case 'VARIANT_CHANGED':
              setVariant(msg.payload.variant);
              if (msg.payload.position !== undefined) {
                setCurrentTime(msg.payload.position);
              }
              if (msg.payload.playing !== undefined) {
                setPlaying(msg.payload.playing);
              }
              break;
            case 'OFFSET_CHANGED':
              if (msg.payload?.format === 'elrc') {
                if (typeof msg.payload.offset === 'number') setElrcOffset(msg.payload.offset);
              } else if (msg.payload?.format === 'lrc') {
                if (typeof msg.payload.offset === 'number') setLrcOffset(msg.payload.offset);
              } else {
                if (typeof msg.payload?.lrcOffset === 'number') setLrcOffset(msg.payload.lrcOffset);
                if (typeof msg.payload?.elrcOffset === 'number') setElrcOffset(msg.payload.elrcOffset);
              }
              break;
            case 'LYRIC_SETTINGS_UPDATED':
            case 'LYRIC_SETTINGS_CHANGED':
              if (msg.payload?.settings) {
                const resolved = resolveLyricsSettings(msg.payload.settings);
                setLyricsSettings(resolved);
                prevSettingsJsonRef.current = JSON.stringify(resolved);
              }
              break;
            case 'SESSION_CLOSED':
              isClosedIntentionally = true;
              setValidationStatus('expired');
              setErrorMessage('The host has closed the session.');
              break;
          }
        } catch (err) {
          console.error('[WS] Parse error:', err);
        }
      };

      socket.onclose = () => {
        socket = null;
        if (!isClosedIntentionally && validationStatus === 'valid') {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            connect();
          }, 2000);
        }
      };

      socket.onerror = () => {
        // Handled via onclose reconnect loop
      };

      setWs(socket);
    }

    connect();

    const handleTabRecheck = () => {
      if (document.visibilityState === 'visible' && !isClosedIntentionally && validationStatus === 'valid') {
        if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          connect();
        }
      }
    };

    document.addEventListener('visibilitychange', handleTabRecheck);
    window.addEventListener('pageshow', handleTabRecheck);
    window.addEventListener('online', handleTabRecheck);

    return () => {
      isClosedIntentionally = true;
      document.removeEventListener('visibilitychange', handleTabRecheck);
      window.removeEventListener('pageshow', handleTabRecheck);
      window.removeEventListener('online', handleTabRecheck);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket) socket.close();
    };
  }, [validationStatus, sessionId, isHost]);

  // 4. Host Heartbeat Loop to prevent session timeouts
  useEffect(() => {
    if (!isHost || validationStatus !== 'valid' || !sessionId) return;

    const sendHeartbeat = async () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'HEARTBEAT', timestamp: Date.now() }));
        } catch (e) {
          // ignore
        }
      }
      try {
        await fetch(`/api/karaoke/sessions/${sessionId}/heartbeat`, { method: 'POST' });
      } catch (e) {
        // ignore network glitches
      }
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 15000);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        sendHeartbeat();
        fetchState();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);
    window.addEventListener('pageshow', handleVisibilityOrFocus);
    window.addEventListener('online', handleVisibilityOrFocus);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      window.removeEventListener('pageshow', handleVisibilityOrFocus);
      window.removeEventListener('online', handleVisibilityOrFocus);
    };
  }, [isHost, validationStatus, sessionId, ws]);

  // Determine current song: only select an item that has a valid songId and is eligible to play.
  // Prefer an item with status === 'playing', followed by an eligible pending item.
  // Do not select items that are downloading, processing, or failed, and do not fall back to queue[0].
  const currentSong = queue.find(q => q.status === 'playing' && q.songId !== null && q.songId !== undefined) ||
    queue.find(q => 
      q.status === 'pending' && 
      q.songId !== null && 
      q.songId !== undefined && 
      q.downloadStatus !== 'downloading' && 
      q.downloadStatus !== 'processing' && 
      q.downloadStatus !== 'failed'
    );

  // Fetch song details and lyrics whenever currentSong changes
  useEffect(() => {
    let isCancelled = false;

    if (lastSongIdRef.current !== null && lastSongIdRef.current !== currentSong?.songId) {
      const currentSettings = getLyricsSettings();
      const currentJson = JSON.stringify(currentSettings);
      if (currentJson !== prevSettingsJsonRef.current && prevSettingsJsonRef.current !== '') {
        console.warn('[LyricSettings] WARNING: settings changed during song transition');
      }
    }
    lastSongIdRef.current = currentSong?.songId ?? null;

    // Reset lyrics and clear previous audio error upon song switch
    setLyrics([]);
    setAudioError(null);

    if (currentSong?.songId) {
      const songId = currentSong.songId;

      Promise.allSettled([
        fetch(`/api/songs/${songId}`).then(async res => {
          if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
            return await res.json();
          }
          return null;
        }),
        fetch(`/api/songs/${songId}/lyrics`).then(async res => {
          if (!res.ok) throw new Error('No lyrics');
          return await res.text();
        })
      ]).then(([detailsResult, lyricsResult]) => {
        if (isCancelled) return;

        const data = detailsResult.status === 'fulfilled' ? detailsResult.value : null;
        const lyricsText = lyricsResult.status === 'fulfilled' ? lyricsResult.value : null;

        if (data) {
          setCurrentSongDetails(data);
          const lrc = typeof data.lrcOffset === 'number' ? data.lrcOffset : (data.lyricOffset ?? 0);
          const elrc = typeof data.elrcOffset === 'number' ? data.elrcOffset : (data.lyricOffset ?? 0);
          setLrcOffset(lrc);
          setElrcOffset(elrc);
        }

        if (lyricsText) {
          rawLyricsRef.current = lyricsText;
          const hasElrcMarker = lyricsText.includes('<') && lyricsText.includes('>');
          const isElrc = Boolean(data?.hasElrc || hasElrcMarker);
          const format = isElrc ? 'elrc' : 'lrc';
          setLyricsFormat(format);
          const parsed = parseLrc(lyricsText, format);
          setLyrics(parsed);
        } else {
          rawLyricsRef.current = '';
          setLyrics([]);
          setLyricsFormat(data?.hasElrc ? 'elrc' : 'lrc');
        }
      }).catch(err => {
        if (!isCancelled) {
          console.error('Failed to load song resources:', err);
        }
      });
    } else {
      setCurrentSongDetails(null);
      setLyrics([]);
    }

    return () => {
      isCancelled = true;
    };
  }, [currentSong?.songId]);

  // Load songs for song picker modal (guests only)
  useEffect(() => {
    if (showLibrary) {
      fetch('/api/karaoke/songs')
        .then(async res => {
          if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
            return await res.json();
          }
          return [];
        })
        .then(data => setAvailableSongs(Array.isArray(data) ? data : []))
        .catch(err => console.error('Failed to load songs:', err));
    }
  }, [showLibrary]);

  // Debounced search for library and external songs
  useEffect(() => {
    if (!searchQuery.trim()) {
      setLibrarySearchResults([]);
      setExternalSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const handler = setTimeout(() => {
      fetch(`/api/karaoke/search?q=${encodeURIComponent(searchQuery)}`)
        .then(async res => {
          if (res.ok) {
            return await res.json();
          }
          return { library: [], external: [] };
        })
        .then(data => {
          setLibrarySearchResults(data.library || []);
          setExternalSearchResults(data.external || []);
        })
        .catch(err => console.error('Failed to search songs:', err))
        .finally(() => setIsSearching(false));
    }, 400);

    return () => clearTimeout(handler);
  }, [searchQuery]);

  const handleAddTrackToQueue = async (track: any) => {
    if (!sessionId) return;
    try {
      const trackId = `dl_${track.title}_${track.artist}`;
      setAddingSongId(trackId as any);
      const res = await fetch(`/api/karaoke/sessions/${sessionId}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          track,
          controllerId: controllerId || undefined
        })
      });

      if (res.ok) {
        setAddedSongId(trackId as any);
        setTimeout(() => setAddedSongId(null), 2000);
        fetchState();
      } else {
        alert('Failed to add song to queue');
      }
    } catch (e) {
      console.error(e);
      alert('Failed to add song to queue');
    } finally {
      setAddingSongId(null);
    }
  };

  function parseLrc(lrcText: string, mode: 'elrc' | 'lrc' = 'elrc'): LyricLine[] {
    if (!lrcText || typeof lrcText !== 'string') return [];
    const lines = lrcText.split('\n');
    const result: LyricLine[] = [];

    function parseTimestamp(minStr: string, secStr: string, milliStr?: string): number {
      const minutes = parseInt(minStr, 10);
      const seconds = parseInt(secStr, 10);
      const millis = milliStr ? parseInt(milliStr.padEnd(3, '0').slice(0, 3), 10) : 0;
      return minutes * 60 + seconds + millis / 1000;
    }

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      if (/^\[(by|re|ti|ar|al|au|length|offset|tool|ve|kana):/i.test(trimmed)) {
        continue;
      }

      // Match leading bracketed timestamp(s) at the start of the line
      const leadingMatch = trimmed.match(/^(\s*\[\d{1,2}:\d{2}(?:\.\d{1,3})?\])+/);
      if (!leadingMatch) continue;

      const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
      let match;
      const lineTimestamps: number[] = [];

      while ((match = timeRegex.exec(leadingMatch[0])) !== null) {
        lineTimestamps.push(parseTimestamp(match[1], match[2], match[3]));
      }

      if (lineTimestamps.length === 0) {
        continue;
      }

      const remainder = trimmed.slice(leadingMatch[0].length).trim();

      // Check for word timestamps: <mm:ss.xx>word
      const wordRegex = /<(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?>([^<]+)/g;
      let wordMatch;
      const words: { text: string; start: number }[] = [];

      if (mode === 'elrc') {
        while ((wordMatch = wordRegex.exec(remainder)) !== null) {
          const wTime = parseTimestamp(wordMatch[1], wordMatch[2], wordMatch[3]);
          const wText = wordMatch[4].replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();
          if (wText) {
            words.push({ text: wText, start: wTime });
          }
        }
      }

      const cleanText = remainder
        .replace(/<[^>]+>/g, '')
        .replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, '')
        .trim();

      if (mode === 'elrc' && words.length > 0) {
        const fullText = words.map(w => w.text).join(' ');
        // For eLRC lines with word timestamps, use the first leading line timestamp
        result.push({
          time: lineTimestamps[0],
          text: fullText,
          words: words,
        });
      } else if (cleanText) {
        // For normal LRC lines, or when mode === 'lrc', multiple leading timestamps indicate repeated lines
        for (const t of lineTimestamps) {
          result.push({
            time: t,
            text: cleanText,
          });
        }
      }
    }

    return result.sort((a, b) => a.time - b.time);
  }

  // Explicitly End Session (Host Only)
  const handleExplicitEndSession = async () => {
    setShowEndSessionModal(false);
    if (!sessionId) return;
    try {
      await fetch(`/api/karaoke/sessions/${sessionId}/end`, { method: 'POST' });
    } catch (e) {
      console.error('Failed to end session:', e);
    }
    if (ws) {
      ws.close();
      setWs(null);
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setPlaying(false);
    setCurrentTime(0);
    setLyrics([]);
    setCurrentSongDetails(null);
    setQueue([]);
    setSession(null);
    setValidationStatus('expired');
  };

  // Start New Real Karaoke Session (Host Only)
  const handleStartNewSession = async () => {
    if (!isHost || isRestartingSession) return;
    setIsRestartingSession(true);
    try {
      if (ws) {
        try {
          ws.close();
        } catch (e) {}
      }
      if (audioRef.current) {
        try {
          audioRef.current.pause();
        } catch (e) {}
      }
      setPlaying(false);
      setCurrentTime(0);
      setLyrics([]);
      setCurrentSongDetails(null);
      setQueue([]);

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
      let newSession: any = {};
      if (res.headers.get('content-type')?.includes('application/json')) {
        try {
          newSession = await res.json();
        } catch (e) {
          console.error('Failed to parse new session response', e);
        }
      }
      if (!res.ok) throw new Error(newSession.error || 'Failed to create session');

      setSession(newSession);
      setValidationStatus('valid');
      navigate(`/rooms/${newSession.id}?role=host`, { replace: true });
    } catch (err) {
      console.error('Failed to start new session:', err);
      alert('Failed to start a new session. Please try again.');
    } finally {
      setIsRestartingSession(false);
    }
  };

  // Safe play helper for iOS Safari and modern browsers
  const safePlay = useCallback((audio: HTMLAudioElement | null) => {
    if (!audio) return;
    try {
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {
            setAudioAutoplayBlocked(false);
          })
          .catch((err: any) => {
            console.warn('[AUDIO] Autoplay prevented or waiting for interaction:', err);
            setAudioAutoplayBlocked(true);
          });
      } else {
        // Legacy WebKit (iOS 10 Safari) returns undefined synchronously when play() succeeds
        setAudioAutoplayBlocked(false);
      }
    } catch (err) {
      console.warn('[AUDIO] Synchronous play failed:', err);
      setAudioAutoplayBlocked(true);
    }
  }, []);

  // Host Control actions
  const togglePlay = () => {
    if (!isHost) return;
    const nextPlaying = !playing;
    setPlaying(nextPlaying);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: nextPlaying ? 'PLAY' : 'PAUSE' }));
    }
    // Direct, synchronous playback initiation within the user's tap gesture
    if (audioRef.current && currentSong) {
      if (nextPlaying) {
        safePlay(audioRef.current);
      } else {
        try {
          audioRef.current.pause();
        } catch (e) {}
        setAudioAutoplayBlocked(false);
      }
    }
  };

  const handleSkip = async () => {
    if (!isHost) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'SKIP' }));
    } else if (sessionId) {
      try {
        await fetch(`/api/karaoke/sessions/${sessionId}/skip`, { method: 'POST' });
      } catch (e) {
        console.error('Failed to skip track via REST:', e);
      }
    }
    fetchState();
  };

  const handleRestart = () => {
    if (!isHost) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'RESTART' }));
    }
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      setCurrentTime(0);
      if (playing) {
        safePlay(audioRef.current);
      }
    }
  };

  const handleToggleInstrumental = () => {
    if (!isHost) return;
    if (!currentSongDetails?.hasInstrumental && variant === 'original') {
      alert('Instrumental version not available for this song.');
      return;
    }
    
    const currentPos = audioRef.current ? audioRef.current.currentTime : currentTime;
    const wasPlaying = playing;
    
    const newVariant = variant === 'original' ? 'instrumental' : 'original';
    setVariant(newVariant);
    
    restorePositionRef.current = { time: currentPos, playing: wasPlaying };
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ 
        type: 'VARIANT_CHANGED', 
        payload: { 
          variant: newVariant,
          position: currentPos,
          playing: wasPlaying
        } 
      }));
    }
  };

  const handleOffsetChange = (delta: number) => {
    if (!isHost) return;
    const currentSongId = currentSong?.songId;
    const currentFormat = lyricsFormat;
    const currentVal = currentFormat === 'elrc' ? elrcOffset : lrcOffset;
    const newOffset = currentVal + delta;

    if (currentFormat === 'elrc') {
      setElrcOffset(newOffset);
    } else {
      setLrcOffset(newOffset);
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ 
        type: 'OFFSET_CHANGED', 
        payload: { 
          offset: newOffset,
          format: currentFormat,
          lrcOffset: currentFormat === 'lrc' ? newOffset : lrcOffset,
          elrcOffset: currentFormat === 'elrc' ? newOffset : elrcOffset,
          songId: currentSongId 
        } 
      }));
    }
    if (currentSongId) {
      fetch(`/api/songs/${currentSongId}/lyrics/offset`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offset: newOffset,
          format: currentFormat,
          lrcOffset: currentFormat === 'lrc' ? newOffset : lrcOffset,
          elrcOffset: currentFormat === 'elrc' ? newOffset : elrcOffset
        }),
      }).catch(err => console.warn('[OFFSET] Failed to save song lyric offset:', err));
    }
  };

  const handleSyncReset = () => {
    if (!isHost) return;
    const currentSongId = currentSong?.songId;
    const currentFormat = lyricsFormat;
    const newOffset = 0;

    if (currentFormat === 'elrc') {
      setElrcOffset(newOffset);
    } else {
      setLrcOffset(newOffset);
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ 
        type: 'OFFSET_CHANGED', 
        payload: { 
          offset: newOffset,
          format: currentFormat,
          lrcOffset: currentFormat === 'lrc' ? newOffset : lrcOffset,
          elrcOffset: currentFormat === 'elrc' ? newOffset : elrcOffset,
          songId: currentSongId 
        } 
      }));
    }
    if (currentSongId) {
      fetch(`/api/songs/${currentSongId}/lyrics/offset`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offset: newOffset,
          format: currentFormat,
          lrcOffset: currentFormat === 'lrc' ? newOffset : lrcOffset,
          elrcOffset: currentFormat === 'elrc' ? newOffset : elrcOffset
        }),
      }).catch(err => console.warn('[OFFSET] Failed to save song lyric offset reset:', err));
    }
  };

  const handleSongEnded = async () => {
    if (!isHost) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'SONG_FINISHED' }));
    } else if (sessionId) {
      try {
        await fetch(`/api/karaoke/sessions/${sessionId}/skip`, { method: 'POST' });
      } catch (e) {
        console.error('Failed to finish song via REST:', e);
      }
    }
    fetchState();
  };

  // Host Audio Playback Synchronization Effect
  useEffect(() => {
    if (!isHost || !audioRef.current || !currentSong) return;

    if (playing) {
      if (audioRef.current.paused) {
        safePlay(audioRef.current);
      }
    } else {
      try {
        audioRef.current.pause();
      } catch (e) {}
      setAudioAutoplayBlocked(false);
    }
  }, [playing, currentSong?.songId, variant, isHost, safePlay]);

  const handleEnableAudio = () => {
    if (audioRef.current) {
      safePlay(audioRef.current);
    }
  };

  // High-frequency smooth animation loop for lyric sweep and position
  useEffect(() => {
    if (!isHost || !playing) return;
    let rafId: number;
    const updateLoop = () => {
      if (audioRef.current && !audioRef.current.paused) {
        setCurrentTime(audioRef.current.currentTime);
      }
      rafId = requestAnimationFrame(updateLoop);
    };
    rafId = requestAnimationFrame(updateLoop);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [isHost, playing]);

  const handleSeek = (e: ChangeEvent<HTMLInputElement>) => {
    if (!isHost || !audioRef.current) return;
    const newTime = parseFloat(e.target.value);
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  // Add song to queue from picker modal (Guests only)
  const handleAddSongToQueue = async (songId: number) => {
    if (!sessionId) return;
    try {
      setAddingSongId(songId);
      const res = await fetch(`/api/karaoke/sessions/${sessionId}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          songId,
          controllerId: controllerId || undefined
        })
      });

      if (res.ok) {
        setAddedSongId(songId);
        setTimeout(() => setAddedSongId(null), 2000);
        fetchState();
      } else {
        alert('Failed to add song to queue');
      }
    } catch (e) {
      console.error(e);
      alert('Failed to add song to queue');
    } finally {
      setAddingSongId(null);
    }
  };

  // Playback is considered active only when playing is true or currentTime has progressed significantly (>0.05s)
  const isPlaybackActive = playing || currentTime > 0.05;
  const activeOffset = lyricsFormat === 'elrc' ? elrcOffset : lrcOffset;
  const adjustedTime = currentTime + (activeOffset / 1000);

  // Active lyric index: only valid if playback has started AND adjustedTime has reached the first lyric's timestamp
  const firstLyricTime = lyrics[0]?.time ?? 0;
  let activeLyricIndex = -1;
  if (isPlaybackActive && lyrics.length > 0 && adjustedTime >= firstLyricTime) {
    activeLyricIndex = lyrics.findIndex((l, idx) => {
      const nextLine = lyrics[idx + 1];
      return adjustedTime >= l.time && (!nextLine || adjustedTime < nextLine.time);
    });
  }

  // Is highlighting active? True only if activeLyricIndex >= 0 AND highlight toggle in settings is enabled
  const isHighlighted = activeLyricIndex >= 0 && (lyricsSettings.highlightCurrentLine !== false);

  // Focus line index: when playing, points to activeLyricIndex; when waiting/idle/pre-intro, points to 0 (the first line preview)
  const focusIndex = activeLyricIndex >= 0 ? activeLyricIndex : 0;

  // Visible lines support (1, 3, or 5 lines)
  const visibleLinesCount = lyricsSettings.visibleLines ?? 3;

  // Compute surrounding lines based on focusIndex
  const prev2Line = focusIndex >= 2 ? lyrics[focusIndex - 2] : null;
  const prev1Line = focusIndex >= 1 ? lyrics[focusIndex - 1] : null;
  const currLine = lyrics.length > 0 ? (lyrics[focusIndex] || null) : null;
  const next1Line = focusIndex + 1 < lyrics.length ? lyrics[focusIndex + 1] : null;
  const next2Line = focusIndex + 2 < lyrics.length ? lyrics[focusIndex + 2] : null;
  const animDuration = lyricsSettings.animationDuration ?? 0.25;

  const filteredSongs = filterSongs(availableSongs, searchQuery);

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // -------------------------------------------------------------
  // Render: Loading State
  // -------------------------------------------------------------
  if (validationStatus === 'loading') {
    return (
      <div className="min-h-screen bg-[#08090E] text-white flex flex-col items-center justify-center p-6 font-sans">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="w-16 h-16 rounded-2xl bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 flex items-center justify-center shadow-lg shadow-[#FF4FA3]/20">
            <Music className="w-8 h-8 text-[#FF4FA3] animate-pulse" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-white">Connecting to Karaoke Room</h2>
          <p className="text-xs text-zinc-400">Synchronizing live lyrics and room session...</p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // Render: Guest Room Experience
  // -------------------------------------------------------------
  if (!isHost) {
    return (
      <GuestRoom
        sessionId={sessionId!}
        roomCode={session?.roomCode || ''}
        guestUsername={guestUsername}
        controllerId={controllerId || ''}
        queue={queue}
        onRefreshState={fetchState}
        isSessionClosed={validationStatus !== 'valid' || session?.status === 'closed'}
      />
    );
  }

  // -------------------------------------------------------------
  // Render: Host Room - No Active Session View
  // -------------------------------------------------------------
  if (isHost && (validationStatus !== 'valid' || !session || session.status === 'closed')) {
    return (
      <div className="min-h-screen bg-[#08090E] text-white flex flex-col items-center justify-center p-6 font-sans select-none relative overflow-hidden">
        {/* Ambient Top Glow */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#FF4FA3]/10 rounded-full blur-3xl pointer-events-none" />

        <div className="w-full max-w-md bg-[#12131D] border border-white/10 rounded-3xl p-8 shadow-2xl text-center relative z-10">
          <div className="w-16 h-16 rounded-2xl bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 flex items-center justify-center mx-auto mb-5 text-[#FF4FA3] shadow-lg shadow-[#FF4FA3]/20">
            <Mic className="w-8 h-8" />
          </div>

          <div className="text-[11px] font-extrabold uppercase tracking-widest text-[#FF4FA3] mb-1">
            HOST ROOM
          </div>

          <h2 className="text-2xl md:text-3xl font-black text-white mb-2 tracking-tight">
            No Active Session
          </h2>

          <p className="text-xs text-zinc-400 mb-8 leading-relaxed max-w-xs mx-auto">
            Start a new session to host karaoke, display your room QR code, and sync lyrics live with guests.
          </p>

          <button
            data-tv-id="start-session-button"
            onClick={handleStartNewSession}
            disabled={isRestartingSession}
            className="w-full py-4 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white font-bold text-base rounded-xl transition-all shadow-lg shadow-[#FF4FA3]/25 flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 focus:outline-none focus:ring-4 focus:ring-[#FF4FA3] focus:ring-offset-2 focus:ring-offset-[#08090E]"
          >
            <RefreshCw className={`w-5 h-5 ${isRestartingSession ? 'animate-spin' : ''}`} />
            <span>{isRestartingSession ? 'Creating Session...' : 'Start New Session'}</span>
          </button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // Render: Guest Room - Error / Not Found / Expired States
  // -------------------------------------------------------------
  if (validationStatus !== 'valid') {
    return (
      <div className="min-h-screen bg-[#08090E] text-white flex flex-col items-center justify-center p-6 font-sans select-none">
        <div className="w-full max-w-md bg-[#12131D] border border-white/10 rounded-3xl p-8 shadow-2xl text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-950/50 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto mb-5">
            <AlertCircle className="w-8 h-8" />
          </div>

          <h2 className="text-2xl font-bold text-white mb-2">
            This room is no longer available.
          </h2>

          <p className="text-xs text-zinc-400 mb-8 leading-relaxed">
            Please ask the host for an active room QR code or link to join.
          </p>

          <div className="flex flex-col gap-3">
            <button
              onClick={() => navigate('/join')}
              className="w-full py-3.5 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white font-semibold rounded-xl transition-all shadow-lg shadow-[#FF4FA3]/25 flex items-center justify-center gap-2"
            >
              <Mic className="w-4 h-4" />
              <span>Join A Room</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // Render: Active Karaoke Room Experience
  // -------------------------------------------------------------
  return (
    <div id="room-session-root" className="fixed inset-0 flex h-full w-full bg-[#08090E] text-white overflow-hidden flex-col font-sans select-none">
      {/* Room Song Catalog / Add to Queue Modal (Guests Only) */}
      {!isHost && showLibrary && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 md:p-8">
          <div className="w-full max-w-3xl bg-[#12131D] border border-white/10 rounded-3xl flex flex-col h-[85vh] shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-white/5 bg-[#0D0E17] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 rounded-xl text-[#FF4FA3]">
                  <LibraryIcon className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Song Catalog</h2>
                  <p className="text-xs text-zinc-400">Search and queue songs to the live room</p>
                </div>
              </div>
              <button 
                data-tv-id="library-close"
                onClick={() => setShowLibrary(false)}
                className="p-2 text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-colors focus:outline-none focus:ring-4 focus:ring-[#FF4FA3]"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search Input */}
            <div className="p-4 border-b border-white/5 bg-[#0F101A] shrink-0">
              <div className="relative">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input 
                  data-tv-id="library-search"
                  type="text"
                  placeholder="Search song title, artist, or album..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#08090E] border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-[#FF4FA3] focus:ring-2 focus:ring-[#FF4FA3]"
                />
              </div>
            </div>

            {/* Song List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {!searchQuery.trim() ? (
                availableSongs.map((song) => {
                  const isAdding = addingSongId === song.id;
                  const isAdded = addedSongId === song.id;
                  const durationMin = song.duration ? Math.floor(song.duration / 60) : 0;
                  const durationSec = song.duration ? song.duration % 60 : 0;
                  const durationStr = song.duration ? `${durationMin}:${durationSec < 10 ? '0' : ''}${durationSec}` : '';

                  return (
                    <div 
                      key={song.id}
                      className="p-3.5 bg-[#0D0E17] hover:bg-[#1A1C2C] border border-white/5 rounded-2xl flex items-center justify-between gap-3 transition-colors group"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-xl bg-[#181926] border border-white/5 flex items-center justify-center shrink-0">
                          <Music className="w-5 h-5 text-zinc-400 group-hover:text-[#FF4FA3] transition-colors" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-medium text-sm text-white truncate">{song.title}</h4>
                          <div className="flex items-center gap-2 text-xs text-zinc-400 truncate">
                            <span>{song.artist || 'Unknown Artist'}</span>
                            {song.album && <span>• {song.album}</span>}
                            {durationStr && <span>• {durationStr}</span>}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {song.hasLrc && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-[#FF4FA3]/15 text-[#FF4FA3] border border-[#FF4FA3]/25">
                            LRC
                          </span>
                        )}
                        <button
                          onClick={() => handleAddSongToQueue(song.id)}
                          disabled={isAdding || isAdded}
                          className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                            isAdded 
                              ? 'bg-[#FF4FA3] text-white' 
                              : 'bg-[#FF4FA3]/15 hover:bg-[#FF4FA3] text-[#FF4FA3] hover:text-white border border-[#FF4FA3]/30'
                          }`}
                        >
                          {isAdded ? (
                            <>
                              <Check className="w-3.5 h-3.5" /> Added
                            </>
                          ) : (
                            <>
                              <Plus className="w-3.5 h-3.5" /> Add to Queue
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <>
                  {librarySearchResults.length > 0 && (
                    <div className="text-xs font-bold text-[#FF4FA3] uppercase tracking-wider mb-2 mt-4 px-1">
                      In Library ({librarySearchResults.length})
                    </div>
                  )}
                  {librarySearchResults.map((song) => {
                    const isAdding = addingSongId === song.id;
                    const isAdded = addedSongId === song.id;
                    const durationMin = song.duration ? Math.floor(song.duration / 60) : 0;
                    const durationSec = song.duration ? song.duration % 60 : 0;
                    const durationStr = song.duration ? `${durationMin}:${durationSec < 10 ? '0' : ''}${durationSec}` : '';

                    return (
                      <div 
                        key={`lib-${song.id}`}
                        className="p-3.5 bg-[#0D0E17] hover:bg-[#1A1C2C] border border-white/5 rounded-2xl flex items-center justify-between gap-3 transition-colors group"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-10 h-10 rounded-xl bg-[#181926] border border-white/5 flex items-center justify-center shrink-0">
                            <Music className="w-5 h-5 text-zinc-400 group-hover:text-[#FF4FA3] transition-colors" />
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-medium text-sm text-white truncate">{song.title}</h4>
                            <div className="flex items-center gap-2 text-xs text-zinc-400 truncate">
                              <span>{song.artist || 'Unknown Artist'}</span>
                              {song.album && <span>• {song.album}</span>}
                              {durationStr && <span>• {durationStr}</span>}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {song.hasLrc && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-[#FF4FA3]/15 text-[#FF4FA3] border border-[#FF4FA3]/25">
                              LRC
                            </span>
                          )}
                          <button
                            onClick={() => handleAddSongToQueue(song.id)}
                            disabled={isAdding || isAdded}
                            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                              isAdded 
                                ? 'bg-[#FF4FA3] text-white' 
                                : 'bg-[#FF4FA3]/15 hover:bg-[#FF4FA3] text-[#FF4FA3] hover:text-white border border-[#FF4FA3]/30'
                            }`}
                          >
                            {isAdded ? (
                              <>
                                <Check className="w-3.5 h-3.5" /> Added
                              </>
                            ) : (
                              <>
                                <Plus className="w-3.5 h-3.5" /> Add to Queue
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {externalSearchResults.length > 0 && (
                    <div className="text-xs font-bold text-[#FF4FA3] uppercase tracking-wider mb-2 mt-6 px-1">
                      Available for Download ({externalSearchResults.length})
                    </div>
                  )}
                  {externalSearchResults.map((track) => {
                    const trackId = `dl_${track.title}_${track.artist}`;
                    const isAdding = addingSongId === (trackId as any);
                    const isAdded = addedSongId === (trackId as any);
                    const durationMin = track.duration ? Math.floor(track.duration / 60) : 0;
                    const durationSec = track.duration ? track.duration % 60 : 0;
                    const durationStr = track.duration ? `${durationMin}:${durationSec < 10 ? '0' : ''}${durationSec}` : '';

                    return (
                      <div 
                        key={trackId}
                        className="p-3.5 bg-[#0D0E17] hover:bg-[#1A1C2C] border border-white/5 rounded-2xl flex items-center justify-between gap-3 transition-colors group"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-10 h-10 rounded-xl bg-[#181926] border border-white/5 overflow-hidden flex items-center justify-center shrink-0">
                            {track.artworkUrl ? (
                              <img src={track.artworkUrl} className="w-full h-full object-cover" alt="" />
                            ) : (
                              <Music className="w-5 h-5 text-zinc-400 group-hover:text-[#FF4FA3] transition-colors" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-medium text-sm text-white truncate">{track.title}</h4>
                            <div className="flex items-center gap-2 text-xs text-zinc-400 truncate">
                              <span>{track.artist || 'Unknown Artist'}</span>
                              {track.album && <span>• {track.album}</span>}
                              {durationStr && <span>• {durationStr}</span>}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleAddTrackToQueue(track)}
                            disabled={isAdding || isAdded}
                            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                              isAdded 
                                ? 'bg-[#FF4FA3] text-white' 
                                : 'bg-[#FF4FA3]/15 hover:bg-[#FF4FA3] text-[#FF4FA3] hover:text-white border border-[#FF4FA3]/30'
                            }`}
                          >
                            {isAdded ? (
                              <>
                                <Check className="w-3.5 h-3.5" /> Queued
                              </>
                            ) : isAdding ? (
                              <>
                                <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> Queuing...
                              </>
                            ) : (
                              <>
                                <Plus className="w-3.5 h-3.5" /> Download & Queue
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {isSearching && (
                    <div className="py-8 text-center text-zinc-400">
                      <div className="w-6 h-6 border-2 border-[#FF4FA3] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                      <p className="text-xs">Searching library and web...</p>
                    </div>
                  )}

                  {!isSearching && librarySearchResults.length === 0 && externalSearchResults.length === 0 && (
                    <div className="py-16 text-center text-zinc-500">
                      <Music className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm font-medium">No songs found</p>
                      <p className="text-xs text-zinc-600 mt-1">Try another search term</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Top Room Navigation Bar */}
      <header id="room-session-header" className="px-4 md:px-6 py-3 border-b border-white/5 bg-[#0D0E17]/95 backdrop-blur-md flex items-center justify-between relative z-50 shrink-0 select-none">
        {/* Left Side: ↻ Start New Session, Room Code, [ LIVE ] */}
        <div className="flex items-center gap-3 md:gap-4 min-w-0">
          {/* ↻ Start New Session Button */}
          {isHost ? (
            <button 
              data-tv-id="header-start-session-button"
              onClick={handleStartNewSession}
              disabled={isRestartingSession}
              className="p-2 bg-white/5 hover:bg-[#FF4FA3]/20 hover:text-[#FF4FA3] text-zinc-300 rounded-xl transition-all border border-white/10 flex items-center justify-center shrink-0 focus:outline-none focus:ring-4 focus:ring-[#FF4FA3] focus:ring-offset-2 focus:ring-offset-[#08090E]"
              title="Start New Session"
            >
              <RefreshCw className={`w-4 h-4 ${isRestartingSession ? 'animate-spin text-[#FF4FA3]' : ''}`} />
            </button>
          ) : (
            <button 
              onClick={() => navigate(session?.roomCode ? `/join?session=${session.roomCode.replace(/\s+/g, '')}` : '/join')}
              className="p-2 hover:bg-white/5 rounded-xl text-zinc-400 hover:text-white transition-colors shrink-0"
              title="Re-join / Change Name"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          
          {/* Room Code */}
          <span className="text-base md:text-xl font-mono font-black text-white tracking-widest shrink-0">
            {session?.roomCode}
          </span>

          {/* [ LIVE ] Badge */}
          <span className="px-2.5 py-0.5 rounded-full bg-[#FF4FA3]/15 text-[#FF4FA3] text-[11px] font-bold border border-[#FF4FA3]/30 flex items-center gap-1.5 shrink-0 uppercase tracking-wider">
            <Radio className="w-2.5 h-2.5 animate-pulse" /> LIVE
          </span>
        </div>

        {/* Right Side: Instrumental Toggle, Offset Controls, Fullscreen */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {isHost && (
            <>
              {/* Instrumental Toggle in Top Navigation */}
              <button 
                data-tv-id="inst-toggle-button"
                onClick={handleToggleInstrumental}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all border focus:outline-none focus:ring-4 focus:ring-[#FF4FA3] focus:ring-offset-2 focus:ring-offset-[#08090E] ${
                  variant === 'instrumental' 
                    ? 'bg-[#FF4FA3] text-white border-[#FF4FA3] shadow-lg shadow-[#FF4FA3]/25' 
                    : 'bg-white/5 text-zinc-300 border-white/10 hover:bg-white/10'
                }`}
                title="Switch between Original Vocal and Instrumental backing track"
              >
                <Music className="w-3.5 h-3.5" />
                <span className="hidden xs:inline">Inst:</span> {variant === 'instrumental' ? 'ON' : 'OFF'}
              </button>

              {/* Lyrics Format Toggle (eLRC / LRC) */}
              <button 
                data-tv-id="lyrics-format-toggle"
                onClick={handleToggleLyricsFormat}
                disabled={!currentSongDetails?.hasElrc}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all border focus:outline-none focus:ring-4 focus:ring-[#FF4FA3] focus:ring-offset-2 focus:ring-offset-[#08090E] ${
                  !currentSongDetails?.hasElrc 
                    ? 'opacity-50 cursor-not-allowed bg-white/5 text-zinc-500 border-white/5'
                    : lyricsFormat === 'elrc'
                    ? 'bg-cyan-500 text-white border-cyan-500 shadow-lg shadow-cyan-500/25'
                    : 'bg-white/5 text-zinc-300 border-white/10 hover:bg-white/10'
                }`}
                title={
                  !currentSongDetails?.hasElrc
                    ? 'Enhanced LRC (eLRC) not available for this song (LRC mode active)'
                    : `Switch lyric format (Current: ${lyricsFormat.toUpperCase()})`
                }
              >
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                <span className="hidden xs:inline">Lyrics:</span> {lyricsFormat.toUpperCase()}
              </button>

              {/* Offset Tuner in Top Navigation */}
              <div className="hidden sm:flex items-center gap-1 bg-[#08090E] px-2 py-1 rounded-xl border border-white/10 text-xs">
                <span className="text-zinc-500 text-[11px] font-medium hidden md:inline pl-1">
                  {lyricsFormat.toUpperCase()} Offset
                </span>
                <button 
                  data-tv-id="offset-minus-button"
                  onClick={() => handleOffsetChange(-250)}
                  className="px-1.5 py-0.5 bg-[#181926] hover:bg-[#222436] text-zinc-300 hover:text-white rounded text-[10px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[#FF4FA3]"
                  title="-250ms"
                >
                  -250ms
                </button>
                <button
                  data-tv-id="offset-sync-button"
                  onClick={handleSyncReset}
                  className="px-1.5 py-0.5 font-mono text-[#FF4FA3] hover:text-[#ff7ab8] font-bold text-[11px] rounded hover:bg-white/5 transition-colors focus:outline-none focus:ring-2 focus:ring-[#FF4FA3]"
                  title={`Reset ${lyricsFormat.toUpperCase()} offset to 0ms`}
                >
                  {activeOffset > 0 ? `+${activeOffset}` : activeOffset}ms
                </button>
                <button 
                  data-tv-id="offset-plus-button"
                  onClick={() => handleOffsetChange(250)}
                  className="px-1.5 py-0.5 bg-[#181926] hover:bg-[#222436] text-zinc-300 hover:text-white rounded text-[10px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[#FF4FA3]"
                  title="+250ms"
                >
                  +250ms
                </button>
              </div>
            </>
          )}

          {/* Fullscreen Toggle Button */}
          <button
            data-tv-id="fullscreen-toggle-button"
            onClick={toggleFullscreen}
            className="p-2 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white rounded-xl transition-colors border border-white/10 focus:outline-none focus:ring-4 focus:ring-[#FF4FA3] focus:ring-offset-2 focus:ring-offset-[#08090E]"
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          {/* Session Info Button (Host Only) */}
          {isHost && (
            <button
              data-tv-id="session-info-button"
              onClick={() => setShowSessionInfoModal(true)}
              className="p-2 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white rounded-xl transition-colors border border-white/10 focus:outline-none focus:ring-4 focus:ring-[#FF4FA3] focus:ring-offset-2 focus:ring-offset-[#08090E]"
              title="Session Info"
            >
              <Info className="w-4 h-4" />
            </button>
          )}

          {/* End Session Button (Host Only) */}
          {isHost && (
            <button
              data-tv-id="end-session-button"
              onClick={() => setShowEndSessionModal(true)}
              className="p-2 bg-white/5 hover:bg-red-500/10 text-red-400 hover:text-red-300 rounded-xl transition-colors border border-white/10 focus:outline-none focus:ring-4 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-[#08090E]"
              title="End Session"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* Main Container */}
      <div 
        id="room-session-content"
        className="flex-1 min-h-0 flex overflow-hidden relative w-full p-3 lg:p-4 gap-3 lg:gap-4"
      >
        {/* Main Stage: Lyrics Card Container */}
        <main 
          id="room-session-main"
          className="relative overflow-hidden rounded-2xl md:rounded-3xl bg-gradient-to-br from-[#171827] via-[#1b172a] to-[#141522] border border-white/10 shadow-xl flex-1 flex flex-col justify-between h-full min-h-0 min-w-0 transition-all select-none"
        >
          {/* Ambient Glow matching Homepage & Sidebar Feature Cards */}
          <div className="absolute top-0 right-0 w-80 h-80 bg-[#FF4FA3]/10 rounded-full blur-3xl pointer-events-none -mr-16 -mt-16" />
          <div className="absolute bottom-0 left-0 w-80 h-80 bg-[#FF4FA3]/5 rounded-full blur-3xl pointer-events-none -ml-16 -mb-16" />

          {/* Card Top Header */}
          <div className="relative z-10 flex items-center justify-between p-3.5 sm:p-4 lg:p-5 pb-0 shrink-0">
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 text-[#FF4FA3] text-[10px] font-bold uppercase tracking-wider">
                <Mic className="w-3 h-3" />
                <span>Live Lyrics</span>
              </div>
              {isHost && audioError && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/20 border border-red-500/40 text-red-300 text-[10px] font-bold">
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                  <span>{audioError}</span>
                  <button
                    type="button"
                    onClick={handleSkip}
                    className="ml-1 text-white underline hover:text-[#FF4FA3] transition-colors"
                  >
                    Skip
                  </button>
                </div>
              )}
              {isHost && !audioError && audioAutoplayBlocked && (
                <button
                  type="button"
                  onClick={handleEnableAudio}
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#FF4FA3] text-white text-[10px] font-bold uppercase tracking-wider animate-pulse hover:bg-[#ff6eb3] transition-colors shadow-lg shadow-[#FF4FA3]/40"
                  title="Tap to enable sound"
                >
                  <Volume2 className="w-3 h-3" />
                  <span>Tap to Enable Audio</span>
                </button>
              )}
            </div>
            {currentSong && (
              <div className="text-xs text-zinc-400 font-medium truncate max-w-[200px] sm:max-w-xs md:max-w-md">
                <span className="text-white font-bold">{currentSong.songTitle}</span>
                <span className="mx-1.5 text-zinc-600">•</span>
                <span>{currentSong.artistName}</span>
              </div>
            )}
          </div>

          {/* Centered Auto-Responsive Lyrics Stage */}
          <div className="w-full flex-1 flex flex-col justify-center items-center px-2 sm:px-6 z-10 overflow-hidden min-h-0 py-2">
            {currentSong ? (
              lyrics.length > 0 ? (
                <AutoResponsiveLyrics
                  lyrics={lyrics}
                  focusIndex={focusIndex}
                  lyricsSettings={lyricsSettings}
                  isHighlighted={isHighlighted}
                  animDuration={animDuration}
                  prev2Line={prev2Line}
                  prev1Line={prev1Line}
                  currLine={currLine}
                  next1Line={next1Line}
                  next2Line={next2Line}
                  visibleLinesCount={visibleLinesCount}
                  applyTextCase={applyTextCase}
                  getFontFamilyStyle={getFontFamilyStyle}
                  getAlignmentClass={getAlignmentClass}
                  currentTime={currentTime}
                  lyricOffset={activeOffset}
                />
              ) : (
                /* Fallback when no synced LRC is available */
                <div className="text-center z-10 py-8 px-6 flex flex-col items-center max-w-2xl mx-auto">
                  <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-5 shadow-xl">
                    <Mic className="w-7 h-7 text-[#FF4FA3] animate-pulse" />
                  </div>
                  <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-white mb-2 tracking-tight">
                    {currentSong.songTitle}
                  </h2>
                  <p className="text-base sm:text-lg text-zinc-400 font-medium mb-4">
                    {currentSong.artistName}
                  </p>
                  <div className="px-4 py-2 rounded-full bg-white/5 border border-white/10 text-xs text-zinc-400 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-zinc-500" />
                    <span>Instrumental / plain audio playback (No synchronized LRC lyrics available)</span>
                  </div>
                </div>
              )
            ) : (
              /* Queue is Empty State (Clean & Centered) */
              <div className="text-center z-10 py-12 px-6 max-w-md mx-auto flex flex-col items-center justify-center">
                <div className="w-16 h-16 rounded-3xl bg-[#12131D] border border-white/10 flex items-center justify-center mx-auto mb-5 shadow-xl">
                  <Music className="w-8 h-8 text-[#FF4FA3]" />
                </div>
                <h2 className="text-2xl md:text-3xl font-extrabold text-white mb-2">Queue is Empty</h2>
                <p className="text-zinc-400 text-xs md:text-sm leading-relaxed">
                  Waiting for someone to choose a song...
                </p>
              </div>
            )}
          </div>

          {/* Centered Playback Controls & Timeline (Horizontally centered in lyrics area) */}
          {isHost ? (
            <div className="w-full z-20 pb-4 sm:pb-6 px-4">
              <div className="max-w-xl mx-auto flex flex-col items-center space-y-3">
                {/* Timeline Progress Slider */}
                {currentSong && (
                  <div className="w-full flex items-center gap-3 px-2">
                    <span className="text-[11px] font-mono text-zinc-500 w-10 text-right">
                      {formatTime(currentTime)}
                    </span>
                    <input
                      data-tv-id="timeline-slider"
                      type="range"
                      min="0"
                      max={duration || 100}
                      step="0.1"
                      value={currentTime}
                      onChange={handleSeek}
                      className="flex-1 h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#FF4FA3] focus:outline-none focus:ring-2 focus:ring-[#FF4FA3]"
                    />
                    <span className="text-[11px] font-mono text-zinc-500 w-10">
                      {formatTime(duration)}
                    </span>
                  </div>
                )}

                {/* Bottom Controls: [ ↶ ] [ ▶ ] [ ⏭ ] */}
                <div className="flex items-center gap-5">
                  <button 
                    data-tv-id="restart-button"
                    onClick={handleRestart}
                    disabled={!currentSong}
                    className="p-3 bg-[#181926] hover:bg-[#222436] text-white rounded-full transition-all disabled:opacity-30 border border-white/10 hover:scale-105 active:scale-95 shadow-md focus:outline-none focus:ring-4 focus:ring-[#FF4FA3] focus:ring-offset-2 focus:ring-offset-[#08090E]"
                    title="Restart Track"
                  >
                    <RotateCcw className="w-5 h-5" />
                  </button>
                  
                  <button 
                    ref={playButtonRef}
                    data-tv-id="play-button"
                    onClick={togglePlay}
                    disabled={!currentSong}
                    className="w-14 h-14 bg-white hover:bg-zinc-200 text-black rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-xl disabled:opacity-30 focus:outline-none focus:ring-4 focus:ring-[#FF4FA3] focus:ring-offset-2 focus:ring-offset-[#08090E] focus:scale-110 focus:shadow-[0_0_35px_rgba(255,79,163,0.9)]"
                    title={playing ? 'Pause' : 'Play'}
                  >
                    {playing ? <Pause className="w-6 h-6 fill-black" /> : <Play className="w-6 h-6 fill-black ml-0.5" />}
                  </button>

                  <button 
                    data-tv-id="skip-button"
                    onClick={handleSkip}
                    disabled={!currentSong}
                    className="p-3 bg-[#181926] hover:bg-[#222436] text-white rounded-full transition-all disabled:opacity-30 border border-white/10 hover:scale-105 active:scale-95 shadow-md focus:outline-none focus:ring-4 focus:ring-[#FF4FA3] focus:ring-offset-2 focus:ring-offset-[#08090E]"
                    title="Skip Track"
                  >
                    <SkipForward className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Singer / Guest Controller Action Bar */
            <div className="p-4 bg-[#0D0E17] border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3 z-20">
              <button
                onClick={() => setShowLibrary(true)}
                className="w-full sm:w-auto px-6 py-3 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#FF4FA3]/25"
              >
                <LibraryIcon className="w-5 h-5" />
                <span>Browse & Queue Songs</span>
              </button>
              <div className="text-xs text-zinc-500 font-medium text-center">
                Lyrics synchronized live with karaoke host
              </div>
            </div>
          )}

          {/* Audio Player for Host */}
          {isHost && (
            <audio 
              ref={audioRef}
              src={currentSong && currentSong.songId ? `/api/songs/${currentSong.songId}/audio?type=${variant}` : undefined}
              preload="auto"
              playsInline
              onTimeUpdate={() => {
                if (audioRef.current) {
                  setCurrentTime(audioRef.current.currentTime);
                }
              }}
              onLoadedMetadata={() => {
                if (audioRef.current) {
                  setDuration(audioRef.current.duration);
                  if (restorePositionRef.current) {
                    audioRef.current.currentTime = restorePositionRef.current.time;
                    if (restorePositionRef.current.playing) {
                      safePlay(audioRef.current);
                    } else {
                      try {
                        audioRef.current.pause();
                      } catch (e) {}
                    }
                    restorePositionRef.current = null;
                  }
                }
              }}
              onEnded={handleSongEnded}
              onError={(e) => {
                const err = audioRef.current?.error;
                console.warn('[AUDIO] Loading error for current song:', err?.code, err?.message);
                if (variant === 'instrumental' && currentSong) {
                  console.warn('[AUDIO] Instrumental audio unavailable on disk, falling back to original variant');
                  setVariant('original');
                  return;
                }
                setPlaying(false);
                setAudioAutoplayBlocked(false);
                setAudioError('Audio track could not be loaded or is unavailable on disk. Tap Skip to continue.');
              }}
              className="hidden"
            />
          )}
        </main>

        {/* Floating Join Room / Queue Card Area (Landscape = 20% width, Portrait = Hidden) */}
        {isHost && (
          <aside 
            id="room-session-sidebar"
            className="hidden landscape:flex portrait:hidden flex-col h-full landscape:w-[20%] min-w-[210px] max-w-[320px] bg-[#0A0B12]/80 backdrop-blur-xl border-l border-white/10 p-3 lg:p-4 gap-3 lg:gap-4 shadow-2xl z-20 select-none overflow-hidden shrink-0"
          >
            {/* Card 1: Join Session / QR Code Card */}
            <div id="room-session-qr-card" className="relative overflow-hidden rounded-2xl md:rounded-3xl bg-gradient-to-br from-[#171827] via-[#1b172a] to-[#141522] border border-white/10 p-3.5 lg:p-4 shadow-xl flex flex-col items-center shrink-0">
              {/* Ambient Glow matching Homepage Feature Card */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#FF4FA3]/15 rounded-full blur-2xl pointer-events-none -mr-10 -mt-10" />

              <div className="relative z-10 flex flex-col items-center w-full">
                {/* Header Pill */}
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 text-[#FF4FA3] text-[10px] font-bold uppercase tracking-wider mb-2.5">
                  <QrCode className="w-3 h-3" />
                  <span>Join Session</span>
                </div>

                {/* QR Code Container */}
                {qrCodeDataUrl ? (
                  <div id="room-session-qr-element" className="bg-white p-2 rounded-xl shadow-md mx-auto w-24 h-24 sm:w-28 sm:h-28 flex items-center justify-center">
                    <img 
                      src={qrCodeDataUrl} 
                      alt="Join Room QR Code" 
                      className="w-full h-full object-contain"
                    />
                  </div>
                ) : (
                  <div id="room-session-qr-element" className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                    <span className="text-[10px] text-zinc-500 font-mono">Loading QR...</span>
                  </div>
                )}

                {/* Session Code */}
                <div className="text-sm md:text-base font-mono font-black text-white tracking-widest mt-2 text-center">
                  {session?.roomCode}
                </div>

                {/* Subtitle */}
                <div className="text-[10px] text-zinc-400 font-medium text-center mt-0.5">
                  Scan to Join & Queue
                </div>
              </div>
            </div>

            {/* Card 2: UP NEXT Queue Card */}
            <div className="relative overflow-hidden rounded-2xl md:rounded-3xl bg-gradient-to-br from-[#171827] via-[#1b172a] to-[#141522] border border-white/10 p-3.5 lg:p-4 shadow-xl flex-1 flex flex-col min-h-0">
              {/* Subtle Ambient Glow */}
              <div className="absolute bottom-0 right-0 w-32 h-32 bg-[#FF4FA3]/10 rounded-full blur-2xl pointer-events-none -mr-10 -mb-10" />

              {/* Queue Header */}
              <div className="relative z-10 flex items-center justify-between px-0.5 mb-2.5 shrink-0">
                <div className="flex items-center gap-1.5 text-xs font-bold text-white tracking-wide">
                  <Music className="w-3.5 h-3.5 text-[#FF4FA3]" />
                  <span>UP NEXT</span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-white/10 border border-white/5 font-mono font-bold text-zinc-300">
                  {queue.length}
                </span>
              </div>

              {/* Scrollable Queue Items */}
              <div className="relative z-10 flex-1 overflow-y-auto space-y-2 pr-0.5 scrollbar-thin min-h-0">
                {queue.map((item, index) => {
                  const isPlaying = item.status === 'playing' && item.songId !== null && item.songId !== undefined;
                  const singerName = item.userName || (item.userId ? `Singer ${item.userId}` : 'Guest');
                  const isDownloading = item.songId === null && item.downloadStatus === 'downloading';
                  const isProcessing = item.songId === null && item.downloadStatus === 'processing';
                  const isFailed = item.songId === null && item.downloadStatus === 'failed';

                  return (
                    <div 
                      key={item.id || index}
                      className={`p-2.5 rounded-xl border transition-all ${
                        isPlaying 
                          ? 'bg-[#1e192c] border-[#FF4FA3]/40 shadow-sm' 
                          : 'bg-[#10121d]/80 hover:bg-[#151726] border-white/5'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <h4 className="font-bold text-xs text-white truncate flex-1">
                          {item.songTitle}
                        </h4>
                        {isPlaying && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-[#FF4FA3] text-white shrink-0">
                            LIVE
                          </span>
                        )}
                        {isDownloading && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-yellow-500/20 text-yellow-500 shrink-0">
                            DOWNLOADING
                          </span>
                        )}
                        {isProcessing && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-400 shrink-0 animate-pulse">
                            PROCESSING
                          </span>
                        )}
                        {isFailed && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-red-500/20 text-red-500 shrink-0">
                            FAILED
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-400 truncate">
                        {singerName}
                      </p>
                    </div>
                  );
                })}

                {queue.length === 0 && (
                  <div className="py-6 text-center text-zinc-500">
                    <p className="text-xs font-medium">Queue is empty</p>
                    <p className="text-[10px] text-zinc-600 mt-0.5">Scan to add songs</p>
                  </div>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Confirmation Modal: End Session */}
      <AnimatePresence>
        {showEndSessionModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-sm bg-[#12131D] border border-white/10 rounded-3xl p-6 shadow-2xl text-center relative overflow-hidden"
            >
              <div className="w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto mb-4">
                <LogOut className="w-6 h-6" />
              </div>

              <h3 className="text-xl font-bold text-white mb-2">End this session?</h3>
              <p className="text-xs text-zinc-400 leading-relaxed mb-6">
                All guests will be disconnected and the queue will be cleared.
              </p>

              <div className="flex items-center gap-3">
                <button
                  data-tv-id="end-session-cancel"
                  onClick={() => setShowEndSessionModal(false)}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-zinc-300 font-semibold text-sm rounded-xl transition-colors border border-white/10 focus:outline-none focus:ring-4 focus:ring-[#FF4FA3]"
                >
                  Cancel
                </button>
                <button
                  data-tv-id="end-session-confirm"
                  onClick={handleExplicitEndSession}
                  className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white font-bold text-sm rounded-xl transition-all shadow-lg shadow-red-600/25 focus:outline-none focus:ring-4 focus:ring-red-400"
                >
                  End Session
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Info Modal: Session Info */}
      <AnimatePresence>
        {showSessionInfoModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-sm bg-[#12131D] border border-white/10 rounded-3xl p-6 shadow-2xl text-center relative overflow-hidden"
            >
              <div className="w-10 h-10 rounded-2xl bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 text-[#FF4FA3] flex items-center justify-center mx-auto mb-3">
                <Info className="w-5 h-5" />
              </div>

              <h3 className="text-lg font-bold text-white mb-1">Session Info</h3>
              <p className="text-xs text-zinc-400 mb-4">Active Karaoke Session Details</p>

              <div className="bg-[#08090E] border border-white/10 rounded-2xl p-4 text-left space-y-3 mb-6 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500 font-medium">Room Code:</span>
                  <span className="font-mono font-bold text-white text-sm">{session?.roomCode}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500 font-medium">Status:</span>
                  <span className="text-[#FF4FA3] font-bold uppercase tracking-wider text-[11px]">ACTIVE</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500 font-medium">Queue Length:</span>
                  <span className="text-zinc-300 font-semibold">{queue.length} items</span>
                </div>
              </div>

              <button
                data-tv-id="session-info-close"
                onClick={() => setShowSessionInfoModal(false)}
                className="w-full py-3 bg-[#FF4FA3] hover:bg-[#ff69b2] text-white font-bold text-sm rounded-xl transition-all shadow-lg shadow-[#FF4FA3]/25 focus:outline-none focus:ring-4 focus:ring-[#FF4FA3]"
              >
                Close
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
