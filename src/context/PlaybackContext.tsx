/**
 * PlaybackContext.tsx
 * Single authoritative playback engine and persistent state management for Yimly Jukebox.
 * Supports cross-route persistence, cross-tab synchronisation via BroadcastChannel,
 * direct hardware audio routing for mobile background playback stability,
 * robust Media Session lock-screen integration, and proactive track preloading.
 */

import React, { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from 'react';
import { detectDeviceType } from '../lib/deviceDetection.ts';

export interface PlaybackSong {
  id: number;
  title: string;
  artist: string;
  artists?: Array<{ id: number | null; name: string }>;
  album?: string;
  albumId?: number | null;
  duration?: number;
  hasArtwork?: boolean;
  artworkPath?: string | null;
  variant?: string;
}

export interface PlaybackContextType {
  currentSong: PlaybackSong | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  queue: PlaybackSong[];
  queueIndex: number;
  isShuffle: boolean;
  repeatMode: 'off' | 'all' | 'one';
  playbackError: string | null;
  isLeader: boolean;
  bassLevel: number;
  transientLevel: number;

  // Actions
  playSong: (song: PlaybackSong, newQueue?: PlaybackSong[], indexInQueue?: number) => void;
  playQueue: (songs: PlaybackSong[], startIndex?: number) => void;
  togglePlay: () => void;
  pause: () => void;
  resume: () => void;
  seek: (timeSeconds: number) => void;
  next: () => void;
  previous: () => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  addToQueue: (song: PlaybackSong | PlaybackSong[]) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  jumpToQueueIndex: (index: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
}

const PlaybackContext = createContext<PlaybackContextType | null>(null);

const CHANNEL_NAME = 'yimly_jukebox_playback';
const STORAGE_KEY = 'yimly_jukebox_state';

export function PlaybackProvider({ children }: { children: ReactNode }) {
  // Generate unique tab ID for leadership election
  const tabIdRef = useRef<string>('tab_' + Math.random().toString(36).slice(2, 9));
  const tabId = tabIdRef.current;

  // Playback state
  const [currentSong, setCurrentSong] = useState<PlaybackSong | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.currentSong || null;
      }
    } catch {}
    return null;
  });

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolumeState] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.volume === 'number') return parsed.volume;
      }
    } catch {}
    return 0.8;
  });
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [queue, setQueue] = useState<PlaybackSong[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.queue)) return parsed.queue;
      }
    } catch {}
    return [];
  });
  const [queueIndex, setQueueIndex] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.queueIndex === 'number') return parsed.queueIndex;
      }
    } catch {}
    return -1;
  });
  const [isShuffle, setIsShuffle] = useState<boolean>(false);
  const [repeatMode, setRepeatMode] = useState<'off' | 'all' | 'one'>('off');
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [bassLevel, setBassLevel] = useState<number>(0);
  const [transientLevel, setTransientLevel] = useState<number>(0);

  // Tab leadership: Only the leader tab actually controls its HTMLAudioElement
  const [isLeader, setIsLeader] = useState<boolean>(true);
  const leaderTabIdRef = useRef<string>(tabId);

  // Single authoritative HTMLAudioElement ref
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Secondary audio element for preloading next track without interrupting active stream
  const preloadAudioRef = useRef<HTMLAudioElement | null>(null);

  // Desktop Web Audio references (optional, conditional on device type)
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number>(0);

  // Guard flag to differentiate programmatic track transitions from user pauses.
  // Setting audio.src fires a native DOM 'pause' event; this flag prevents reporting
  // an unintentional 'paused' state to Android Chrome during song changes.
  const isChangingTrackRef = useRef<boolean>(false);
  // Bounded retry counter for transient background network interruptions
  const retryCountRef = useRef<number>(0);

  // Keep the ended-event listener pointed at the latest transition logic
  const handleTrackEndedRef = useRef<() => void>(() => {});
  // Storage write throttle timestamp to prevent synchronous I/O blocking during background playback
  const lastPersistTimeRef = useRef<number>(0);

  // Ref to track latest state for BroadcastChannel handlers without stale closures
  const stateRef = useRef({
    currentSong,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    queue,
    queueIndex,
    isShuffle,
    repeatMode,
    isLeader,
  });

  stateRef.current = {
    currentSong,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    queue,
    queueIndex,
    isShuffle,
    repeatMode,
    isLeader,
  };

  // Broadcast channel for cross-tab synchronisation
  const channelRef = useRef<BroadcastChannel | null>(null);

  // Persist state to localStorage for hydration with rate-limiting
  const persistState = useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - lastPersistTimeRef.current < 4000) return;
    lastPersistTimeRef.current = now;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          currentSong: stateRef.current.currentSong,
          volume: stateRef.current.volume,
          queue: stateRef.current.queue,
          queueIndex: stateRef.current.queueIndex,
          repeatMode: stateRef.current.repeatMode,
          isShuffle: stateRef.current.isShuffle,
        })
      );
    } catch {}
  }, []);

  // Broadcast state changes to all other tabs
  const broadcastSync = useCallback((customOverrides?: Partial<typeof stateRef.current>) => {
    if (!channelRef.current) return;
    const currentState = { ...stateRef.current, ...customOverrides };
    channelRef.current.postMessage({
      type: 'SYNC_STATE',
      fromTabId: tabId,
      state: {
        currentSong: currentState.currentSong,
        isPlaying: currentState.isPlaying,
        currentTime: currentState.currentTime,
        duration: currentState.duration,
        volume: currentState.volume,
        isMuted: currentState.isMuted,
        queue: currentState.queue,
        queueIndex: currentState.queueIndex,
        isShuffle: currentState.isShuffle,
        repeatMode: currentState.repeatMode,
      },
    });
    persistState(false);
  }, [persistState, tabId]);

  // Take leadership and ensure audio element is ready
  const claimLeadership = useCallback(() => {
    setIsLeader(true);
    leaderTabIdRef.current = tabId;
    if (channelRef.current) {
      channelRef.current.postMessage({
        type: 'CLAIM_LEADERSHIP',
        fromTabId: tabId,
      });
    }
  }, [tabId]);

  // Preload the next upcoming track in background so browser cache has headers/chunks ready
  const scheduleNextTrackPreload = useCallback((
    currentQ: PlaybackSong[],
    currentIdx: number,
    shuffle: boolean,
    repeat: 'off' | 'all' | 'one'
  ) => {
    if (leaderTabIdRef.current !== tabId || currentQ.length === 0) return;

    if (repeat === 'one') {
      // Current track repeats; source already cached in main player
      return;
    }

    let nextIdx = currentIdx + 1;
    if (shuffle && currentQ.length > 1) {
      nextIdx = (currentIdx + 1) % currentQ.length;
    } else if (nextIdx >= currentQ.length) {
      if (repeat === 'all') {
        nextIdx = 0;
      } else {
        return; // End of queue
      }
    }

    const nextSong = currentQ[nextIdx];
    if (!nextSong) return;

    try {
      if (!preloadAudioRef.current) {
        const pAudio = new Audio();
        pAudio.preload = 'auto';
        pAudio.muted = true;
        pAudio.volume = 0;
        preloadAudioRef.current = pAudio;
      }
      const preloadUrl = `/api/songs/${nextSong.id}/audio`;
      const fullUrl = window.location.origin + preloadUrl;
      if (preloadAudioRef.current.src !== fullUrl) {
        console.log(`[PlaybackContext] Preloading upcoming track: "${nextSong.title}" (ID: ${nextSong.id})`);
        preloadAudioRef.current.src = preloadUrl;
        preloadAudioRef.current.load();
      }
    } catch (e) {
      console.warn('[PlaybackContext] Next track preloading error:', e);
    }
  }, [tabId]);

  // Audio Engine Lifecycle
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.volume = volume;
    audioRef.current = audio;

    const deviceType = detectDeviceType();
    const isDesktop = deviceType === 'desktop';

    // On mobile devices (Android/iOS) and TVs, keep the HTMLAudioElement directly connected to
    // native hardware output. NEVER hijack the element with createMediaElementSource on mobile,
    // as Android Chrome power management suspends Web Audio context when the screen is locked,
    // which drops the Android Foreground Service and causes ForegroundServiceStartNotAllowedException.
    // On desktop browsers, initialize AudioContext for artwork spectrum analysis.
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let frequencyData: Uint8Array | null = null;
    let animationFrame = 0;
    let lastSampleAt = 0;
    let smoothedBass = 0;
    let previousSpectrum = new Uint8Array(0);
    let smoothedTransient = 0;

    if (isDesktop) {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          audioContext = new AudioContextClass();
          audioContextRef.current = audioContext;
          analyser = audioContext.createAnalyser();
          analyserRef.current = analyser;
          analyser.fftSize = 1024;
          analyser.smoothingTimeConstant = 0.72;
          frequencyData = new Uint8Array(analyser.frequencyBinCount);
          previousSpectrum = new Uint8Array(analyser.frequencyBinCount);
          const source = audioContext.createMediaElementSource(audio);
          source.connect(analyser);
          analyser.connect(audioContext.destination);
          console.log('[PlaybackContext] Desktop AudioContext visualiser connected');
        }
      } catch (error) {
        console.warn('[PlaybackContext] Desktop Web Audio visualiser unavailable, continuing with direct hardware output:', error);
        audioContext = null;
        audioContextRef.current = null;
        analyser = null;
        analyserRef.current = null;
        frequencyData = null;
      }
    } else {
      console.log(`[PlaybackContext] Direct hardware audio output configured for ${deviceType} (optimized for background playback & lock screen)`);
    }

    const stopBassSampling = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      animationFrameRef.current = 0;
      smoothedBass = 0;
      smoothedTransient = 0;
      previousSpectrum.fill(0);
      setBassLevel(0);
      setTransientLevel(0);
    };

    const sampleBass = (timestamp: number) => {
      if (!analyser || !frequencyData || audio.paused || audio.ended) {
        stopBassSampling();
        return;
      }
      animationFrame = requestAnimationFrame(sampleBass);
      animationFrameRef.current = animationFrame;
      if (timestamp - lastSampleAt < 40) return;
      lastSampleAt = timestamp;
      analyser.getByteFrequencyData(frequencyData);

      const startBin = 2;
      const endBin = Math.max(startBin + 1, Math.floor(frequencyData.length * 0.72));
      let sum = 0;
      let weightTotal = 0;
      let positiveFlux = 0;
      let fluxWeightTotal = 0;

      for (let i = startBin; i < endBin; i++) {
        const weight = i < frequencyData.length * 0.18 ? 1.2 : 1;
        sum += frequencyData[i] * weight;
        weightTotal += weight;

        const fluxWeight = i < frequencyData.length * 0.48 ? 1.15 : 0.8;
        positiveFlux += Math.max(0, frequencyData[i] - previousSpectrum[i]) * fluxWeight;
        fluxWeightTotal += fluxWeight;
      }
      const rawEnergy = Math.min(1, (sum / Math.max(1, weightTotal)) / 115);
      const rawTransient = Math.min(1, (positiveFlux / Math.max(1, fluxWeightTotal)) / 18);
      previousSpectrum.set(frequencyData);

      smoothedBass = smoothedBass * 0.78 + rawEnergy * 0.22;
      smoothedTransient = smoothedTransient * 0.35 + rawTransient * 0.65;
      setBassLevel(smoothedBass);
      setTransientLevel(smoothedTransient);
    };

    const onTimeUpdate = () => {
      if (leaderTabIdRef.current === tabId) {
        const time = audio.currentTime;
        setCurrentTime(time);
        broadcastSync({ currentTime: time });
      }
    };

    const onLoadedMetadata = () => {
      const dur = audio.duration || 0;
      setDuration(dur);
      setPlaybackError(null);
      if (leaderTabIdRef.current === tabId) {
        broadcastSync({ duration: dur });
      }
    };

    const onPlay = () => {
      isChangingTrackRef.current = false;
      retryCountRef.current = 0;
      if (audioContext?.state === 'suspended') {
        audioContext.resume().catch(() => {});
      }
      if (analyser && !animationFrame) {
        animationFrame = requestAnimationFrame(sampleBass);
        animationFrameRef.current = animationFrame;
      }
      setIsPlaying(true);
      setPlaybackError(null);
      if (leaderTabIdRef.current === tabId) {
        broadcastSync({ isPlaying: true });
      }
    };

    const onPause = () => {
      // Prevent synthetic pause events dispatched by audio.src = ... from tearing down the
      // active media notification or falsely signaling to Android OS that music is paused.
      if (isChangingTrackRef.current) {
        console.log('[PlaybackContext] Ignoring synthetic pause during track transition');
        return;
      }
      stopBassSampling();
      setIsPlaying(false);
      if (leaderTabIdRef.current === tabId) {
        broadcastSync({ isPlaying: false });
      }
    };

    const onError = () => {
      const mediaErr = audio.error;
      const code = mediaErr?.code;
      const message = mediaErr?.message || 'Error streaming audio file';
      console.warn(`[PlaybackContext] Audio error encountered: code ${code} (${message}), song ID: ${stateRef.current.currentSong?.id}`);

      // If a network interruption occurred during programmatic track change, attempt 1 bounded recovery
      if (code === 2 && isChangingTrackRef.current && retryCountRef.current < 1 && stateRef.current.currentSong) {
        retryCountRef.current++;
        console.log(`[PlaybackContext] Attempting single network recovery retry for song #${stateRef.current.currentSong.id}...`);
        setTimeout(() => {
          if (audioRef.current && stateRef.current.currentSong && leaderTabIdRef.current === tabId) {
            audioRef.current.src = `/api/songs/${stateRef.current.currentSong.id}/audio`;
            audioRef.current.play().then(() => {
              isChangingTrackRef.current = false;
              setIsPlaying(true);
              setPlaybackError(null);
            }).catch((err) => {
              isChangingTrackRef.current = false;
              setIsPlaying(false);
              setPlaybackError(`Network retry failed: ${err.message || 'Stream error'}`);
            });
          }
        }, 1000);
        return;
      }

      isChangingTrackRef.current = false;
      setPlaybackError(message);
      setIsPlaying(false);
      if (leaderTabIdRef.current === tabId) {
        broadcastSync({ isPlaying: false });
      }
    };

    const onEnded = () => {
      if (leaderTabIdRef.current === tabId) {
        handleTrackEndedRef.current();
      }
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onError);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('ended', onEnded);
      stopBassSampling();
      if (audioContext) {
        audioContext.close().catch(() => {});
        audioContextRef.current = null;
        analyserRef.current = null;
      }
      if (preloadAudioRef.current) {
        try {
          preloadAudioRef.current.src = '';
        } catch {}
        preloadAudioRef.current = null;
      }
      try {
        audio.pause();
        audio.src = '';
      } catch {}
    };
  }, []);

  // Broadcast Channel setup for Cross-Tab Coordination
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(CHANNEL_NAME);
      channelRef.current = bc;

      bc.onmessage = (event) => {
        const data = event.data;
        if (!data || data.fromTabId === tabId) return;

        switch (data.type) {
          case 'REQUEST_STATE': {
            if (leaderTabIdRef.current === tabId) {
              broadcastSync();
            }
            break;
          }

          case 'CLAIM_LEADERSHIP': {
            if (data.fromTabId !== tabId) {
              leaderTabIdRef.current = data.fromTabId;
              setIsLeader(false);
              if (audioRef.current && !audioRef.current.paused) {
                try {
                  audioRef.current.pause();
                } catch {}
              }
            }
            break;
          }

          case 'SYNC_STATE': {
            if (data.fromTabId !== tabId) {
              leaderTabIdRef.current = data.fromTabId;
              setIsLeader(false);
              const s = data.state;
              if (s) {
                if (s.currentSong !== undefined) setCurrentSong(s.currentSong);
                if (s.isPlaying !== undefined) setIsPlaying(s.isPlaying);
                if (s.currentTime !== undefined) setCurrentTime(s.currentTime);
                if (s.duration !== undefined) setDuration(s.duration);
                if (s.volume !== undefined) setVolumeState(s.volume);
                if (s.isMuted !== undefined) setIsMuted(s.isMuted);
                if (s.queue !== undefined) setQueue(s.queue);
                if (s.queueIndex !== undefined) setQueueIndex(s.queueIndex);
                if (s.isShuffle !== undefined) setIsShuffle(s.isShuffle);
                if (s.repeatMode !== undefined) setRepeatMode(s.repeatMode);
              }
            }
            break;
          }

          case 'COMMAND': {
            if (leaderTabIdRef.current === tabId) {
              executeCommand(data.action, data.payload);
            }
            break;
          }

          case 'LEADER_CLOSING': {
            if (leaderTabIdRef.current === data.fromTabId) {
              leaderTabIdRef.current = '';
              setIsLeader(true);
            }
            break;
          }
        }
      };

      bc.postMessage({ type: 'REQUEST_STATE', fromTabId: tabId });
    } catch (e) {
      console.warn('[PlaybackContext] BroadcastChannel unavailable, using single-tab mode:', e);
    }

    const onBeforeUnload = () => {
      if (channelRef.current && leaderTabIdRef.current === tabId) {
        channelRef.current.postMessage({
          type: 'LEADER_CLOSING',
          fromTabId: tabId,
        });
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (bc) {
        try {
          bc.close();
        } catch {}
      }
    };
  }, [broadcastSync, tabId]);

  // Command executor for remote cross-tab calls
  const executeCommand = (action: string, payload?: any) => {
    switch (action) {
      case 'togglePlay':
        togglePlay();
        break;
      case 'pause':
        pause();
        break;
      case 'resume':
        resume();
        break;
      case 'seek':
        if (typeof payload === 'number') seek(payload);
        break;
      case 'next':
        next();
        break;
      case 'previous':
        previous();
        break;
      case 'setVolume':
        if (typeof payload === 'number') setVolume(payload);
        break;
      case 'toggleMute':
        toggleMute();
        break;
      case 'playSong':
        if (payload?.song) playSong(payload.song, payload.newQueue, payload.indexInQueue);
        break;
      case 'playQueue':
        if (Array.isArray(payload?.songs)) playQueue(payload.songs, payload.startIndex);
        break;
      case 'removeFromQueue':
        if (typeof payload === 'number') removeFromQueue(payload);
        break;
      case 'clearQueue':
        clearQueue();
        break;
      case 'jumpToQueueIndex':
        if (typeof payload === 'number') jumpToQueueIndex(payload);
        break;
      case 'toggleShuffle':
        toggleShuffle();
        break;
      case 'cycleRepeat':
        cycleRepeat();
        break;
    }
  };

  // Helper to send command if not leader, or execute locally
  const dispatchOrExecute = (action: string, payload?: any, localFn?: () => void) => {
    if (leaderTabIdRef.current && leaderTabIdRef.current !== tabId) {
      if (channelRef.current) {
        channelRef.current.postMessage({
          type: 'COMMAND',
          fromTabId: tabId,
          action,
          payload,
        });
      }
    } else {
      claimLeadership();
      if (localFn) localFn();
    }
  };

  // Play a specific song immediately, optionally setting or appending to the queue
  const playSong = useCallback((song: PlaybackSong, newQueue?: PlaybackSong[], indexInQueue?: number) => {
    claimLeadership();
    const audio = audioRef.current;
    if (!audio) return;

    // Guard programmatic source change so synthetic pause event does not tear down lock-screen controls
    isChangingTrackRef.current = true;
    retryCountRef.current = 0;

    setCurrentSong(song);
    setPlaybackError(null);
    setCurrentTime(0);

    let updatedQueue = queue;
    let updatedIndex = 0;

    if (newQueue && newQueue.length > 0) {
      updatedQueue = newQueue;
      updatedIndex = typeof indexInQueue === 'number' ? indexInQueue : newQueue.findIndex(s => s.id === song.id);
      if (updatedIndex === -1) updatedIndex = 0;
      setQueue(updatedQueue);
      setQueueIndex(updatedIndex);
    } else {
      const existingIdx = queue.findIndex(s => s.id === song.id);
      if (existingIdx !== -1) {
        updatedIndex = existingIdx;
        setQueueIndex(existingIdx);
      } else {
        updatedQueue = [song, ...queue];
        updatedIndex = 0;
        setQueue(updatedQueue);
        setQueueIndex(0);
      }
    }

    const audioUrl = `/api/songs/${song.id}/audio`;
    audio.src = audioUrl;

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.then(() => {
        isChangingTrackRef.current = false;
        setIsPlaying(true);
        broadcastSync({
          currentSong: song,
          isPlaying: true,
          currentTime: 0,
          queue: updatedQueue,
          queueIndex: updatedIndex,
        });
        scheduleNextTrackPreload(updatedQueue, updatedIndex, isShuffle, repeatMode);
      }).catch(err => {
        isChangingTrackRef.current = false;
        if (err.name === 'AbortError') {
          console.log('[PlaybackContext] Audio play was superseded (AbortError)');
          return;
        }
        console.warn('[PlaybackContext] Audio play was blocked or failed:', err);
        setIsPlaying(false);
        setPlaybackError('Failed to play track: ' + (err.message || 'unknown error'));
        broadcastSync({ currentSong: song, isPlaying: false });
      });
    }
  }, [broadcastSync, claimLeadership, isShuffle, queue, repeatMode, scheduleNextTrackPreload]);

  // Play a full list of songs from a given start index
  const playQueue = useCallback((songs: PlaybackSong[], startIndex = 0) => {
    if (!songs || songs.length === 0) return;
    const targetIdx = Math.max(0, Math.min(startIndex, songs.length - 1));
    const targetSong = songs[targetIdx];
    playSong(targetSong, songs, targetIdx);
  }, [playSong]);

  const resume = useCallback(() => {
    dispatchOrExecute('resume', undefined, () => {
      const audio = audioRef.current;
      if (!audio) return;

      if (!currentSong) {
        if (queue.length > 0) {
          const nextIdx = queueIndex >= 0 ? queueIndex : 0;
          playSong(queue[nextIdx], queue, nextIdx);
        }
        return;
      }

      const expectedUrl = `/api/songs/${currentSong.id}/audio`;
      if (!audio.src || !audio.src.endsWith(expectedUrl)) {
        isChangingTrackRef.current = true;
        audio.src = expectedUrl;
      }

      audio.play().then(() => {
        isChangingTrackRef.current = false;
        setIsPlaying(true);
        broadcastSync({ isPlaying: true });
      }).catch(err => {
        isChangingTrackRef.current = false;
        if (err.name === 'AbortError') return;
        console.warn('[PlaybackContext] Resume failed:', err);
        setIsPlaying(false);
      });
    });
  }, [broadcastSync, currentSong, dispatchOrExecute, playSong, queue, queueIndex]);

  const pause = useCallback(() => {
    dispatchOrExecute('pause', undefined, () => {
      const audio = audioRef.current;
      if (audio) {
        isChangingTrackRef.current = false;
        audio.pause();
        setIsPlaying(false);
        broadcastSync({ isPlaying: false });
      }
    });
  }, [broadcastSync, dispatchOrExecute]);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      resume();
    }
  }, [isPlaying, pause, resume]);

  const seek = useCallback((timeSeconds: number) => {
    dispatchOrExecute('seek', timeSeconds, () => {
      const audio = audioRef.current;
      if (audio && Number.isFinite(timeSeconds)) {
        audio.currentTime = timeSeconds;
        setCurrentTime(timeSeconds);
        broadcastSync({ currentTime: timeSeconds });
      }
    });
  }, [broadcastSync, dispatchOrExecute]);

  // Skip to next track
  const next = useCallback(() => {
    dispatchOrExecute('next', undefined, () => {
      const currentState = stateRef.current;
      const currentQueue = currentState.queue;
      const currentIndex = currentState.queueIndex;
      const shuffle = currentState.isShuffle;
      const repeat = currentState.repeatMode;

      if (currentQueue.length === 0) return;

      let nextIndex = currentIndex + 1;

      if (shuffle && currentQueue.length > 1) {
        let randomIdx = Math.floor(Math.random() * currentQueue.length);
        if (randomIdx === currentIndex) {
          randomIdx = (randomIdx + 1) % currentQueue.length;
        }
        nextIndex = randomIdx;
      }

      if (nextIndex >= currentQueue.length) {
        if (repeat === 'all') {
          nextIndex = 0;
        } else {
          // Reached end of queue without repeat all
          pause();
          seek(0);
          return;
        }
      }

      const nextSong = currentQueue[nextIndex];
      if (nextSong) {
        console.log(`[PlaybackContext] Next track transition: ended index ${currentIndex} -> next index ${nextIndex}, song ID ${nextSong.id}, repeat: ${repeat}, shuffle: ${shuffle}`);
        playSong(nextSong, currentQueue, nextIndex);
      }
    });
  }, [dispatchOrExecute, pause, playSong, seek]);

  // Previous track (if >3s into song, restarts; otherwise goes to previous index)
  const previous = useCallback(() => {
    dispatchOrExecute('previous', undefined, () => {
      const audio = audioRef.current;
      const currentState = stateRef.current;
      const currentQueue = currentState.queue;
      const currentIndex = currentState.queueIndex;
      const repeat = currentState.repeatMode;

      if (audio && audio.currentTime > 3) {
        audio.currentTime = 0;
        setCurrentTime(0);
        broadcastSync({ currentTime: 0 });
        return;
      }

      if (currentQueue.length === 0) return;

      let prevIndex = currentIndex - 1;
      if (prevIndex < 0) {
        if (repeat === 'all') {
          prevIndex = currentQueue.length - 1;
        } else {
          prevIndex = 0;
        }
      }

      const prevSong = currentQueue[prevIndex];
      if (prevSong) {
        playSong(prevSong, currentQueue, prevIndex);
      }
    });
  }, [broadcastSync, dispatchOrExecute, playSong]);

  // Handle track naturally finishing
  const handleTrackEnded = useCallback(() => {
    const currentState = stateRef.current;
    const repeat = currentState.repeatMode;
    const currentIndex = currentState.queueIndex;
    const endedSong = currentState.currentSong;

    console.log(`[PlaybackContext] Track ended: song ID ${endedSong?.id}, index ${currentIndex}, repeat mode: ${repeat}`);

    if (repeat === 'one') {
      const audio = audioRef.current;
      if (audio && endedSong) {
        isChangingTrackRef.current = true;
        audio.currentTime = 0;
        audio.play().then(() => {
          isChangingTrackRef.current = false;
          setIsPlaying(true);
          setCurrentTime(0);
          broadcastSync({ currentTime: 0, isPlaying: true });
        }).catch(err => {
          isChangingTrackRef.current = false;
          console.warn('[PlaybackContext] Repeat One replay failed:', err);
        });
      }
      return;
    }
    next();
  }, [broadcastSync, next]);

  // Update the callback ref every render; the long-lived audio listener reads this ref.
  handleTrackEndedRef.current = handleTrackEnded;

  const setVolume = useCallback((vol: number) => {
    const clamped = Math.max(0, Math.min(1, vol));
    dispatchOrExecute('setVolume', clamped, () => {
      setVolumeState(clamped);
      setIsMuted(clamped === 0);
      const audio = audioRef.current;
      if (audio) {
        audio.volume = clamped;
        audio.muted = clamped === 0;
      }
      broadcastSync({ volume: clamped, isMuted: clamped === 0 });
    });
  }, [broadcastSync, dispatchOrExecute]);

  const toggleMute = useCallback(() => {
    dispatchOrExecute('toggleMute', undefined, () => {
      const audio = audioRef.current;
      const nextMute = !isMuted;
      setIsMuted(nextMute);
      if (audio) {
        audio.muted = nextMute;
      }
      broadcastSync({ isMuted: nextMute });
    });
  }, [broadcastSync, dispatchOrExecute, isMuted]);

  const addToQueue = useCallback((items: PlaybackSong | PlaybackSong[]) => {
    const toAdd = Array.isArray(items) ? items : [items];
    if (toAdd.length === 0) return;

    setQueue(prev => {
      const updated = [...prev, ...toAdd];
      broadcastSync({ queue: updated });
      return updated;
    });
  }, [broadcastSync]);

  const removeFromQueue = useCallback((index: number) => {
    dispatchOrExecute('removeFromQueue', index, () => {
      setQueue(prev => {
        const updated = prev.filter((_, i) => i !== index);
        let newIdx = queueIndex;
        if (index < queueIndex) {
          newIdx = queueIndex - 1;
          setQueueIndex(newIdx);
        } else if (index === queueIndex) {
          newIdx = Math.min(queueIndex, updated.length - 1);
          setQueueIndex(newIdx);
        }
        broadcastSync({ queue: updated, queueIndex: newIdx });
        return updated;
      });
    });
  }, [broadcastSync, dispatchOrExecute, queueIndex]);

  const clearQueue = useCallback(() => {
    dispatchOrExecute('clearQueue', undefined, () => {
      if (currentSong) {
        setQueue([currentSong]);
        setQueueIndex(0);
        broadcastSync({ queue: [currentSong], queueIndex: 0 });
      } else {
        setQueue([]);
        setQueueIndex(-1);
        broadcastSync({ queue: [], queueIndex: -1 });
      }
    });
  }, [broadcastSync, currentSong, dispatchOrExecute]);

  const jumpToQueueIndex = useCallback((index: number) => {
    dispatchOrExecute('jumpToQueueIndex', index, () => {
      if (index >= 0 && index < queue.length) {
        playSong(queue[index], queue, index);
      }
    });
  }, [dispatchOrExecute, playSong, queue]);

  const toggleShuffle = useCallback(() => {
    dispatchOrExecute('toggleShuffle', undefined, () => {
      const nextShuffle = !isShuffle;
      setIsShuffle(nextShuffle);
      broadcastSync({ isShuffle: nextShuffle });
    });
  }, [broadcastSync, dispatchOrExecute, isShuffle]);

  const cycleRepeat = useCallback(() => {
    dispatchOrExecute('cycleRepeat', undefined, () => {
      const modes: Array<'off' | 'all' | 'one'> = ['off', 'all', 'one'];
      const nextMode = modes[(modes.indexOf(repeatMode) + 1) % modes.length];
      setRepeatMode(nextMode);
      broadcastSync({ repeatMode: nextMode });
    });
  }, [broadcastSync, dispatchOrExecute, repeatMode]);

  // Keep a stable ref of playback actions so Media Session action handlers can be registered
  // once on mount without constant teardown and re-registration churn.
  const actionsRef = useRef({
    play: resume,
    pause: pause,
    previoustrack: previous,
    nexttrack: next,
    seekto: seek,
  });

  useEffect(() => {
    actionsRef.current = {
      play: resume,
      pause: pause,
      previoustrack: previous,
      nexttrack: next,
      seekto: seek,
    };
  });

  // Register Media Session action handlers ONCE on mount with stable lifecycle
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const mediaSession = navigator.mediaSession;

    const actionMap: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => actionsRef.current.play()],
      ['pause', () => actionsRef.current.pause()],
      ['previoustrack', () => actionsRef.current.previoustrack()],
      ['nexttrack', () => actionsRef.current.nexttrack()],
      ['seekto', (details) => {
        if (typeof details.seekTime === 'number' && Number.isFinite(details.seekTime)) {
          actionsRef.current.seekto(details.seekTime);
        }
      }],
    ];

    for (const [action, handler] of actionMap) {
      try {
        mediaSession.setActionHandler(action, handler);
      } catch (err) {
        // Some platforms do not support all MediaSession actions
        console.warn(`[PlaybackContext] Media Session action handler unsupported: ${action}`, err);
      }
    }

    return () => {
      for (const [action] of actionMap) {
        try {
          mediaSession.setActionHandler(action, null);
        } catch {}
      }
    };
  }, []);

  // Update Media Session metadata when the active song changes
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const mediaSession = navigator.mediaSession;
    try {
      if (currentSong) {
        const artwork: MediaImage[] = currentSong.hasArtwork
          ? [
              { src: `/api/songs/${currentSong.id}/artwork`, sizes: '96x96', type: 'image/jpeg' },
              { src: `/api/songs/${currentSong.id}/artwork`, sizes: '128x128', type: 'image/jpeg' },
              { src: `/api/songs/${currentSong.id}/artwork`, sizes: '192x192', type: 'image/jpeg' },
              { src: `/api/songs/${currentSong.id}/artwork`, sizes: '256x256', type: 'image/jpeg' },
              { src: `/api/songs/${currentSong.id}/artwork`, sizes: '512x512', type: 'image/jpeg' },
            ]
          : [
              { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
              { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            ];

        mediaSession.metadata = new MediaMetadata({
          title: currentSong.title || 'Unknown title',
          artist: currentSong.artist || 'Unknown artist',
          album: currentSong.album || 'Yimly Karaoke',
          artwork,
        });
      } else {
        mediaSession.metadata = null;
      }
    } catch (error) {
      console.warn('[PlaybackContext] Media Session metadata update error:', error);
    }
  }, [currentSong?.id, currentSong?.title, currentSong?.artist, currentSong?.album, currentSong?.hasArtwork]);

  // Update Media Session playback state with continuous transition preservation
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const mediaSession = navigator.mediaSession;
    try {
      if (isChangingTrackRef.current) {
        // While loading the next track, maintain 'playing' so Android OS does not tear down the notification
        mediaSession.playbackState = 'playing';
      } else {
        mediaSession.playbackState = isPlaying ? 'playing' : currentSong ? 'paused' : 'none';
      }
    } catch {}
  }, [isPlaying, currentSong]);

  // Update Media Session position state safely
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const mediaSession = navigator.mediaSession;
    try {
      if (duration > 0 && Number.isFinite(duration) && typeof mediaSession.setPositionState === 'function') {
        mediaSession.setPositionState({
          duration,
          playbackRate: 1,
          position: Math.min(Math.max(0, currentTime), duration),
        });
      } else if (typeof mediaSession.setPositionState === 'function') {
        mediaSession.setPositionState();
      }
    } catch {}
  }, [currentTime, duration]);

  // Lifecycle & visibility recovery: when phone is unlocked or tab becomes visible again,
  // ensure audio state, element playback, and desktop visualizer are immediately reconciled.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[PlaybackContext] Document visible; checking audio state reconciliation');
        if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
          audioContextRef.current.resume().catch(() => {});
        }
        const audio = audioRef.current;
        if (audio && leaderTabIdRef.current === tabId) {
          if (!audio.paused && !isPlaying) {
            setIsPlaying(true);
          } else if (audio.paused && isPlaying && !isChangingTrackRef.current) {
            setIsPlaying(false);
          }
          if (Number.isFinite(audio.currentTime)) {
            setCurrentTime(audio.currentTime);
          }
        }
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isPlaying, tabId]);

  const value: PlaybackContextType = {
    currentSong,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    queue,
    queueIndex,
    isShuffle,
    repeatMode,
    playbackError,
    isLeader,
    bassLevel,
    transientLevel,
    playSong,
    playQueue,
    togglePlay,
    pause,
    resume,
    seek,
    next,
    previous,
    setVolume,
    toggleMute,
    addToQueue,
    removeFromQueue,
    clearQueue,
    jumpToQueueIndex,
    toggleShuffle,
    cycleRepeat,
  };

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

export function usePlayback() {
  const ctx = useContext(PlaybackContext);
  if (!ctx) {
    throw new Error('usePlayback must be used within a PlaybackProvider');
  }
  return ctx;
}
