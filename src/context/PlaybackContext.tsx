/**
 * PlaybackContext.tsx
 * Single authoritative playback engine and persistent state management for Yimly Jukebox.
 * Supports cross-route persistence and cross-tab synchronisation via BroadcastChannel.
 */

import React, { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from 'react';

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

  // Single HTML Audio element ref
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  // Persist state to localStorage for hydration
  const persistState = useCallback(() => {
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
    persistState();
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

  // Audio Engine Lifecycle
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.volume = volume;
    audioRef.current = audio;

    // Analyse the existing playback element (never create a second audio player).
    // The analyser is connected back to the destination so audio keeps playing normally.
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let frequencyData: Uint8Array | null = null;
    let animationFrame = 0;
    let lastSampleAt = 0;
    let smoothedBass = 0;
    let previousSpectrum = new Uint8Array(0);
    let smoothedTransient = 0;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        audioContext = new AudioContextClass();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.72;
        frequencyData = new Uint8Array(analyser.frequencyBinCount);
        previousSpectrum = new Uint8Array(analyser.frequencyBinCount);
        const source = audioContext.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(audioContext.destination);
      }
    } catch (error) {
      // Keep playback unaffected on browsers that cannot provide Web Audio analysis.
      console.warn('[PlaybackContext] Bass visualizer unavailable:', error);
      audioContext = null;
      analyser = null;
      frequencyData = null;
    }

    const stopBassSampling = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
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
      if (timestamp - lastSampleAt < 40) return;
      lastSampleAt = timestamp;
      analyser.getByteFrequencyData(frequencyData);
      // Use broad-spectrum energy so vocals, percussion, guitars, synths and bass
      // can all drive the artwork. Ignore the very lowest bins and extreme high-end noise.
      const startBin = 2;
      const endBin = Math.max(startBin + 1, Math.floor(frequencyData.length * 0.72));
      let sum = 0;
      let weightTotal = 0;
      let positiveFlux = 0;
      let fluxWeightTotal = 0;
      // Spectral-flux-based transient detection algorithm:
      // Computes positive magnitude changes between consecutive spectral frames
      // across weighted frequency bins to isolate sharp drum attacks, kick drums,
      // and percussive transients from sustained vocals or pads.
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
      
      // Smooth energy envelope for slow continuous breathing, and transient level for sharp percussive pulses
      smoothedBass = smoothedBass * 0.78 + rawEnergy * 0.22;
      smoothedTransient = smoothedTransient * 0.35 + rawTransient * 0.65;
      setBassLevel(smoothedBass);
      setTransientLevel(smoothedTransient);
    };

    const onTimeUpdate = () => {
      if (leaderTabIdRef.current === tabId) {
        const time = audio.currentTime;
        setCurrentTime(time);
        // Periodically broadcast progress
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
      if (audioContext?.state === 'suspended') audioContext.resume().catch(() => {});
      if (analyser && !animationFrame) animationFrame = requestAnimationFrame(sampleBass);
      setIsPlaying(true);
      setPlaybackError(null);
      if (leaderTabIdRef.current === tabId) {
        broadcastSync({ isPlaying: true });
      }
    };

    const onPause = () => {
      stopBassSampling();
      setIsPlaying(false);
      if (leaderTabIdRef.current === tabId) {
        broadcastSync({ isPlaying: false });
      }
    };

    const onError = () => {
      const err = audio.error?.message || 'Error streaming audio file';
      setPlaybackError(err);
      setIsPlaying(false);
      if (leaderTabIdRef.current === tabId) {
        broadcastSync({ isPlaying: false });
      }
    };

    const onEnded = () => {
      if (leaderTabIdRef.current === tabId) {
        handleTrackEnded();
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
      if (audioContext) audioContext.close().catch(() => {});
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
            // If this tab is the leader, respond with current state
            if (leaderTabIdRef.current === tabId) {
              broadcastSync();
            }
            break;
          }

          case 'CLAIM_LEADERSHIP': {
            // Another tab has taken leadership; yield local audio element
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
            // Remote leader broadcasted its state; update local display mirrors
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
            // If this tab is the leader, execute the requested action
            if (leaderTabIdRef.current === tabId) {
              executeCommand(data.action, data.payload);
            }
            break;
          }

          case 'LEADER_CLOSING': {
            // Former leader is closing; if user interacts with this tab, it will take over
            if (leaderTabIdRef.current === data.fromTabId) {
              leaderTabIdRef.current = '';
              setIsLeader(true);
            }
            break;
          }
        }
      };

      // Request state from any active leader on mount
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
      // Send command to the active leader tab
      if (channelRef.current) {
        channelRef.current.postMessage({
          type: 'COMMAND',
          fromTabId: tabId,
          action,
          payload,
        });
      }
    } else {
      // We are leader or taking over leadership
      claimLeadership();
      if (localFn) localFn();
    }
  };

  // Play a specific song immediately, optionally setting or appending to the queue
  const playSong = useCallback((song: PlaybackSong, newQueue?: PlaybackSong[], indexInQueue?: number) => {
    claimLeadership();
    const audio = audioRef.current;
    if (!audio) return;

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
      // Check if song is already in queue
      const existingIdx = queue.findIndex(s => s.id === song.id);
      if (existingIdx !== -1) {
        updatedIndex = existingIdx;
        setQueueIndex(existingIdx);
      } else {
        // Prepend or set as first in queue
        updatedQueue = [song, ...queue];
        updatedIndex = 0;
        setQueue(updatedQueue);
        setQueueIndex(0);
      }
    }

    const audioUrl = `/api/songs/${song.id}/audio`;
    audio.src = audioUrl;
    audio.currentTime = 0;
    audio.play().then(() => {
      setIsPlaying(true);
      broadcastSync({
        currentSong: song,
        isPlaying: true,
        currentTime: 0,
        queue: updatedQueue,
        queueIndex: updatedIndex,
      });
    }).catch(err => {
      console.warn('[PlaybackContext] Audio play was blocked or failed:', err);
      setIsPlaying(false);
      broadcastSync({ currentSong: song, isPlaying: false });
    });
  }, [broadcastSync, claimLeadership, queue]);

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

      if (!audio.src || !audio.src.includes(`/api/songs/${currentSong.id}/audio`)) {
        audio.src = `/api/songs/${currentSong.id}/audio`;
      }

      audio.play().then(() => {
        setIsPlaying(true);
        broadcastSync({ isPlaying: true });
      }).catch(err => {
        console.warn('[PlaybackContext] Resume failed:', err);
        setIsPlaying(false);
      });
    });
  }, [broadcastSync, currentSong, dispatchOrExecute, playSong, queue, queueIndex]);

  const pause = useCallback(() => {
    dispatchOrExecute('pause', undefined, () => {
      const audio = audioRef.current;
      if (audio) {
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
        // Pick random different song
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
        audio.currentTime = 0;
        audio.play().then(() => {
          setIsPlaying(true);
          setCurrentTime(0);
          broadcastSync({ currentTime: 0, isPlaying: true });
        }).catch(err => {
          console.warn('[PlaybackContext] Repeat One replay failed:', err);
        });
      }
      return;
    }
    next();
  }, [broadcastSync, next]);

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
          // If removing currently playing track, keep index bounds safe
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

  // Expose the web player to supported OS/car Bluetooth media controls via Media Session.
  // Actual availability depends on the browser and the phone/car integration.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    const mediaSession = navigator.mediaSession;
    try {
      mediaSession.metadata = currentSong
        ? new MediaMetadata({
            title: currentSong.title || 'Unknown title',
            artist: currentSong.artist || 'Unknown artist',
            album: currentSong.album || 'Yimly Karaoke',
            artwork: currentSong.hasArtwork
              ? [
                  { src: `/api/songs/${currentSong.id}/artwork`, sizes: '96x96', type: 'image/jpeg' },
                  { src: `/api/songs/${currentSong.id}/artwork`, sizes: '512x512', type: 'image/jpeg' },
                ]
              : [],
          })
        : null;
    } catch (error) {
      console.warn('[PlaybackContext] Media Session metadata unavailable:', error);
    }

    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => resume()],
      ['pause', () => pause()],
      ['previoustrack', () => previous()],
      ['nexttrack', () => next()],
      ['seekto', (details) => {
        if (typeof details.seekTime === 'number' && Number.isFinite(details.seekTime)) {
          seek(details.seekTime);
        }
      }],
    ];

    const registered: MediaSessionAction[] = [];
    for (const [action, handler] of handlers) {
      try {
        mediaSession.setActionHandler(action, handler);
        registered.push(action);
      } catch {
        // Browsers expose different subsets of the Media Session actions.
      }
    }

    try {
      mediaSession.playbackState = isPlaying ? 'playing' : currentSong ? 'paused' : 'none';
    } catch {}

    return () => {
      for (const action of registered) {
        try { mediaSession.setActionHandler(action, null); } catch {}
      }
    };
  }, [currentSong, isPlaying, next, pause, previous, resume, seek]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const mediaSession = navigator.mediaSession;
    try {
      if (duration > 0 && Number.isFinite(duration) && typeof mediaSession.setPositionState === 'function') {
        mediaSession.setPositionState({
          duration,
          playbackRate: 1,
          position: Math.min(currentTime, duration),
        });
      } else if (typeof mediaSession.setPositionState === 'function') {
        mediaSession.setPositionState();
      }
    } catch {
      // Position reporting is optional and browser-dependent.
    }
  }, [currentTime, duration]);

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
