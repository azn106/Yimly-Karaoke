import { useState, useEffect, useRef, useCallback } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { Search, Play, Pause, Music, Disc, Mic, RefreshCw, Calendar, FileText, ChevronRight, ChevronLeft, ArrowLeft, AlertCircle, ListMusic, Trash2, Plus, Heart } from 'lucide-react';
import { Playlist, PlaylistSongItem } from '../types';
import CreatePlaylistModal from '../components/playlist/CreatePlaylistModal';
import EditPlaylistModal from '../components/playlist/EditPlaylistModal';
import LyricsEditorModal from '../components/LyricsEditorModal';
import SharePlaylistModal from '../components/playlist/SharePlaylistModal';
import AddSongsModal from '../components/playlist/AddSongsModal';
import PlaylistsGrid from '../components/playlist/PlaylistsGrid';
import PlaylistDetailView from '../components/playlist/PlaylistDetailView';
import LyricBadges from '../components/LyricBadges';
import EqualizerIndicator from '../components/EqualizerIndicator';
import { clearAuthToken } from '../lib/auth';
import { usePlayback, PlaybackSong } from '../context/PlaybackContext';


export default function Library() {
  const { user } = useOutletContext<{ user: any }>() || {};
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as 'home' | 'artists' | 'albums' | 'songs' | 'playlists' | null;
  const tab = tabParam && ['home', 'artists', 'albums', 'songs', 'playlists'].includes(tabParam) ? tabParam : 'home';

  const setTab = (newTab: 'home' | 'artists' | 'albums' | 'songs' | 'playlists') => {
    if (newTab === 'home') {
      setSearchParams({});
    } else {
      setSearchParams({ tab: newTab });
    }
  };

  const [search, setSearch] = useState('');
  const [stats, setStats] = useState({ artists: 0, albums: 0, songs: 0, playlists: 0 });
  
  const [artists, setArtists] = useState<any[]>([]);
  const [albums, setAlbums] = useState<any[]>([]);
  const [songs, setSongs] = useState<any[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [searchResults, setSearchResults] = useState<any[]>([]);

  // Detailed view states
  const [selectedArtist, setSelectedArtist] = useState<any | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<any | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);

  // Sidebar Jukebox navigation must exit detail views even if the target URL is unchanged.
  useEffect(() => {
    const clearLibraryDetail = () => {
      setSelectedArtist(null);
      setSelectedAlbum(null);
      setSelectedPlaylist(null);
    };

    window.addEventListener('yimly:navigate-library-section', clearLibraryDetail);
    return () => window.removeEventListener('yimly:navigate-library-section', clearLibraryDetail);
  }, []);

  // Modals state
  const [isCreatePlaylistOpen, setIsCreatePlaylistOpen] = useState(false);
  const [isEditPlaylistOpen, setIsEditPlaylistOpen] = useState(false);
  const [editorState, setEditorState] = useState<{isOpen: boolean, songId: number | null, title: string, format: 'lrc'|'elrc'}>({isOpen: false, songId: null, title: '', format: 'lrc'});
  const [isSharePlaylistOpen, setIsSharePlaylistOpen] = useState(false);
  const [isAddSongsOpen, setIsAddSongsOpen] = useState(false);
  const [activeModalPlaylist, setActiveModalPlaylist] = useState<Playlist | null>(null);

  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queuedSongId, setQueuedSongId] = useState<number | null>(null);
  const [playingAll, setPlayingAll] = useState(false);
  // Horizontal featured-playlist rail. Cards are sized to roughly twice an album card.
  const playlistRailRef = useRef<HTMLDivElement | null>(null);
  const scrollPlaylistRail = (direction: -1 | 1) => {
    playlistRailRef.current?.scrollBy({
      left: direction * Math.max(320, Math.round((playlistRailRef.current?.clientWidth || 360) * 0.75)),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  };

  // Favourites tracking state
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set());
  const [favoritingSongIds, setFavoritingSongIds] = useState<Set<number>>(new Set());

  const handleToggleFavorite = async (songId: number) => {
    if (favoritingSongIds.has(songId)) return;
    const isCurrentlyFavorited = favoriteIds.has(songId);

    // Optimistic update
    setFavoriteIds(prev => {
      const next = new Set(prev);
      if (isCurrentlyFavorited) {
        next.delete(songId);
      } else {
        next.add(songId);
      }
      return next;
    });

    setFavoritingSongIds(prev => new Set(prev).add(songId));

    try {
      const res = await fetch(`/api/favorites/${songId}`, {
        method: isCurrentlyFavorited ? 'DELETE' : 'POST',
      });
      if (!res.ok) {
        throw new Error('Failed to update favorite status');
      }
    } catch (err) {
      console.error('Error toggling favorite:', err);
      // Rollback on failure
      setFavoriteIds(prev => {
        const next = new Set(prev);
        if (isCurrentlyFavorited) {
          next.add(songId);
        } else {
          next.delete(songId);
        }
        return next;
      });
    } finally {
      setFavoritingSongIds(prev => {
        const next = new Set(prev);
        next.delete(songId);
        return next;
      });
    }
  };

  const { 
    currentSong: jukeboxCurrentSong, 
    isPlaying: jukeboxIsPlaying, 
    playSong: playJukeboxSong, 
    playQueue: playJukeboxQueue, 
    togglePlay: toggleJukeboxPlay, 
    addToQueue: addSongToJukeboxQueue 
  } = usePlayback();

  const handlePlayInJukebox = (song: any, songList?: any[], index?: number) => {
    if (jukeboxCurrentSong?.id === song.id) {
      toggleJukeboxPlay();
      return;
    }
    const formatted: PlaybackSong = {
      id: song.id,
      title: song.title,
      artist: song.artist || 'Unknown Artist',
      artists: song.artists,
      album: song.album,
      albumId: song.albumId,
      duration: song.duration,
      hasArtwork: song.hasArtwork,
      artworkPath: song.artworkPath,
      variant: song.variant,
    };
    const formattedList = (songList || [song]).map(s => ({
      id: s.id,
      title: s.title,
      artist: s.artist || 'Unknown Artist',
      artists: s.artists,
      album: s.album,
      albumId: s.albumId,
      duration: s.duration,
      hasArtwork: s.hasArtwork,
      artworkPath: s.artworkPath,
      variant: s.variant,
    }));
    playJukeboxSong(formatted, formattedList, index);
  };

  const handleQueueInJukebox = (song: any) => {
    addSongToJukeboxQueue({
      id: song.id,
      title: song.title,
      artist: song.artist || 'Unknown Artist',
      artists: song.artists,
      album: song.album,
      albumId: song.albumId,
      duration: song.duration,
      hasArtwork: song.hasArtwork,
      artworkPath: song.artworkPath,
      variant: song.variant,
    });
  };

  const handlePlayPlaylistInJukebox = async (playlist: Playlist) => {
    try {
      let playlistSongs = playlist.songs;
      if (!playlistSongs) {
        const response = await fetch('/api/playlists/' + playlist.id);
        if (!response.ok) throw new Error('Could not load playlist songs.');
        const details: Playlist = await response.json();
        playlistSongs = details.songs;
      }

      if (!playlistSongs?.length) {
        alert('This playlist has no songs to play yet.');
        return;
      }

      playJukeboxQueue(playlistSongs.map(song => ({
        id: song.id,
        title: song.title,
        artist: song.artist || 'Unknown Artist',
        artists: song.artists,
        album: song.album,
        albumId: song.albumId,
        duration: song.duration,
        hasArtwork: song.hasArtwork,
        variant: song.variant,
      })), 0);
    } catch (err: any) {
      console.error('Could not play playlist in Jukebox:', err);
      alert(err?.message || 'Could not play this playlist.');
    }
  };

  useEffect(() => {
    loadAllData();
  }, [tab]);

  const loadAllData = async () => {
    setLoading(true);
    setError(null);

    const fetchWithRetry = async (url: string, retries = 2, delayMs = 500): Promise<Response> => {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const res = await fetch(url, { credentials: 'same-origin' });
          if (res.ok) return res;
          if (res.status === 401) {
            // Do not retry 401 Unauthorized continuously
            return res;
          }
          if (attempt < retries) {
            await new Promise(r => setTimeout(r, delayMs));
            continue;
          }
          return res;
        } catch (err) {
          if (attempt < retries) {
            await new Promise(r => setTimeout(r, delayMs));
            continue;
          }
          throw err;
        }
      }
      throw new Error('Failed to connect to server');
    };

    try {
      // 1. Fetch stats
      try {
        const statsRes = await fetchWithRetry('/api/libraries/stats', 1, 300);
        if (statsRes.ok && statsRes.headers.get('content-type')?.includes('application/json')) {
          const statsData = await statsRes.json();
          setStats(prev => ({ ...prev, ...statsData }));
        }
      } catch (e) {
        console.warn('Failed to load library stats:', e);
      }

      // 2. Fetch tab data
      if (tab === 'home') {
        const [songsRes, artistsRes, albumsRes, playlistsRes, favsRes] = await Promise.all([
          fetchWithRetry('/api/songs', 1, 300),
          fetchWithRetry('/api/artists', 1, 300),
          fetchWithRetry('/api/albums', 1, 300),
          fetchWithRetry('/api/playlists', 1, 300),
          fetchWithRetry('/api/favorites', 1, 300).catch(() => null),
        ]);
        if (songsRes.ok) setSongs(await songsRes.json().catch(() => []));
        if (artistsRes.ok) setArtists(await artistsRes.json().catch(() => []));
        if (albumsRes.ok) setAlbums(await albumsRes.json().catch(() => []));
        if (playlistsRes.ok) setPlaylists(await playlistsRes.json().catch(() => []));
        if (favsRes && favsRes.ok) {
          const favs = await favsRes.json().catch(() => []);
          if (Array.isArray(favs)) {
            setFavoriteIds(new Set(favs.map((f: any) => f.id)));
          }
        }
      } else {
        const endpoint = 
          tab === 'artists' ? '/api/artists' : 
          tab === 'albums' ? '/api/albums' : 
          tab === 'songs' ? '/api/songs' : 
          '/api/playlists';

        const dataRes = await fetchWithRetry(endpoint, 2, 500);
        if (!dataRes.ok) {
          if (dataRes.status === 401) {
            clearAuthToken();
            setError('Session expired or unauthorized. Please log in again.');
            setLoading(false);
            return;
          }
          let serverError = '';
          if (dataRes.headers.get('content-type')?.includes('application/json')) {
            const errJson = await dataRes.json().catch(() => ({}));
            serverError = errJson.error || errJson.message || '';
          }
          throw new Error(serverError || `Failed to fetch ${tab} catalog (${dataRes.status})`);
        }

        if (!dataRes.headers.get('content-type')?.includes('application/json')) {
          throw new Error(`Invalid response format received for ${tab}`);
        }

        const data = await dataRes.json();

        if (tab === 'artists') setArtists(Array.isArray(data) ? data : []);
        else if (tab === 'albums') setAlbums(Array.isArray(data) ? data : []);
        else if (tab === 'songs') {
          setSongs(Array.isArray(data) ? data : []);
          try {
            const favsRes = await fetchWithRetry('/api/favorites', 1, 300);
            if (favsRes.ok) {
              const favs = await favsRes.json().catch(() => []);
              if (Array.isArray(favs)) {
                setFavoriteIds(new Set(favs.map((f: any) => f.id)));
              }
            }
          } catch (e) {}
        }
        else if (tab === 'playlists') setPlaylists(Array.isArray(data) ? data : []);
      }

      setLoading(false);
    } catch (err: any) {
      console.error('Library loading error:', err);
      setError(err.message || 'Failed to load library data');
      setLoading(false);
    }
  };

  const handleDeleteSong = async (song: any) => {
    const songTitle = song.title || 'this song';

    const confirmed = window.confirm(
      `Delete "${songTitle}"?\n\n` +
      `This will permanently delete:\n` +
      `• The main song\n` +
      `• The instrumental, if available\n` +
      `• The .lrc lyrics, if available\n` +
      `• The .elrc.lrc lyrics, if available\n` +
      `• Playlist, favorite and queue associations\n\n` +
      `This cannot be undone.`
    );

    if (!confirmed) return;

    try {
      const res = await fetch(`/api/songs/${song.id}`, {
        method: 'DELETE',
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error('You do not have permission to delete this song.');
        }

        throw new Error(data.error || 'Failed to delete song');
      }

      // Remove from main Songs list
      setSongs(prev => prev.filter(s => s.id !== song.id));

      // Remove from search results
      setSearchResults(prev =>
        prev.filter(item => !(item.type === 'song' && item.id === song.id))
      );

      // Remove from selected Artist view
      setSelectedArtist(prev => {
        if (!prev?.songs) return prev;

        return {
          ...prev,
          songs: prev.songs.filter((s: any) => s.id !== song.id),
        };
      });

      // Remove from selected Album view
      setSelectedAlbum(prev => {
        if (!prev?.songs) return prev;

        return {
          ...prev,
          songs: prev.songs.filter((s: any) => s.id !== song.id),
        };
      });

      // Update song count
      setStats(prev => ({
        ...prev,
        songs: Math.max(0, prev.songs - 1),
      }));

      // Clear queued state if this was the deleted song
      setQueuedSongId(prev => (prev === song.id ? null : prev));

    } catch (error: any) {
      console.error('Failed to delete song:', error);
      alert(error.message || 'Failed to delete song');
    }
  };

  const handleLyricsUpdated = (updatedSongId?: number, format?: 'lrc' | 'elrc', exists?: boolean) => {
    if (updatedSongId && format !== undefined && exists !== undefined) {
      // 1. Immediately update Main Songs list
      setSongs(prev => prev.map(s => {
        if (s.id === updatedSongId) {
          return {
            ...s,
            hasLrc: format === 'lrc' ? exists : s.hasLrc,
            hasElrc: format === 'elrc' ? exists : s.hasElrc,
          };
        }
        return s;
      }));

      // 2. Immediately update Selected Artist tracks
      setSelectedArtist((prev: any) => {
        if (!prev || !prev.songs) return prev;
        return {
          ...prev,
          songs: prev.songs.map((s: any) => {
            if (s.id === updatedSongId) {
              return {
                ...s,
                hasLrc: format === 'lrc' ? exists : s.hasLrc,
                hasElrc: format === 'elrc' ? exists : s.hasElrc,
              };
            }
            return s;
          })
        };
      });

      // 3. Immediately update Selected Album tracks
      setSelectedAlbum((prev: any) => {
        if (!prev || !prev.songs) return prev;
        return {
          ...prev,
          songs: prev.songs.map((s: any) => {
            if (s.id === updatedSongId) {
              return {
                ...s,
                hasLrc: format === 'lrc' ? exists : s.hasLrc,
                hasElrc: format === 'elrc' ? exists : s.hasElrc,
              };
            }
            return s;
          })
        };
      });

      // 4. Immediately update Selected Playlist tracks
      setSelectedPlaylist((prev: any) => {
        if (!prev || !prev.songs) return prev;
        return {
          ...prev,
          songs: prev.songs.map((s: any) => {
            if (s.id === updatedSongId) {
              return {
                ...s,
                hasLrc: format === 'lrc' ? exists : s.hasLrc,
                hasElrc: format === 'elrc' ? exists : s.hasElrc,
              };
            }
            return s;
          })
        };
      });

      // 5. Immediately update Search Results tracks
      setSearchResults(prev => prev.map((item: any) => {
        if (item.type === 'song' && item.id === updatedSongId) {
          return {
            ...item,
            hasLrc: format === 'lrc' ? exists : item.hasLrc,
            hasElrc: format === 'elrc' ? exists : item.hasElrc,
          };
        }
        return item;
      }));
    }

    // Background sync without disrupting current UI view
    fetch('/api/songs')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setSongs(data);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (search.trim()) {
      fetch(`/api/search?q=${encodeURIComponent(search)}`)
        .then(async res => {
          if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
            return await res.json();
          }
          return [];
        })
        .then(data => setSearchResults(Array.isArray(data) ? data : []))
        .catch(err => console.error('Search failed:', err));
    } else {
      setSearchResults([]);
    }
  }, [search]);

  const triggerScan = async () => {
    try {
      setScanning(true);
      const libsRes = await fetch('/api/libraries');
      if (!libsRes.ok || !libsRes.headers.get('content-type')?.includes('application/json')) {
        throw new Error('Failed to fetch libraries');
      }
      const libs = await libsRes.json();
      if (libs.length === 0) {
        alert('No libraries configured. Please add a library in Settings first.');
        setScanning(false);
        return;
      }
      for (const lib of libs) {
        const scanRes = await fetch(`/api/libraries/${lib.id}/scan`, { method: 'POST' });
        if (!scanRes.ok) {
          throw new Error(`Scan failed for library ${lib.id}`);
        }
      }
      setTimeout(() => {
        loadAllData();
        setScanning(false);
      }, 2000);
    } catch (e: any) {
      console.error(e);
      alert(e.message || 'Library scan failed');
      setScanning(false);
    }
  };

  const openArtist = async (artistId: number) => {
    try {
      const res = await fetch(`/api/artists/${artistId}`);
      if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) {
        throw new Error('Failed to fetch artist details');
      }
      const data = await res.json();
      setSelectedArtist(data);
      setSelectedAlbum(null);
      setSelectedPlaylist(null);
    } catch (e: any) {
      console.error(e);
      alert(e.message || 'Could not load artist details');
    }
  };

  const openAlbum = async (albumId: number) => {
    try {
      const res = await fetch(`/api/albums/${albumId}`);
      if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) {
        throw new Error('Failed to fetch album details');
      }
      const data = await res.json();
      setSelectedAlbum(data);
      setSelectedArtist(null);
      setSelectedPlaylist(null);
    } catch (e: any) {
      console.error(e);
      alert(e.message || 'Could not load album details');
    }
  };

  const openPlaylist = async (playlistId: number) => {
    try {
      const res = await fetch(`/api/playlists/${playlistId}`);
      if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) {
        throw new Error('Failed to fetch playlist details');
      }
      const data: Playlist = await res.json();
      setSelectedPlaylist(data);
      setSelectedArtist(null);
      setSelectedAlbum(null);
    } catch (e: any) {
      console.error(e);
      alert(e.message || 'Could not load playlist details');
    }
  };

  const addToQueue = async (songId: number) => {
    try {
      const activeRoomsRes = await fetch('/api/karaoke/active-sessions');
      if (!activeRoomsRes.ok || !activeRoomsRes.headers.get('content-type')?.includes('application/json')) {
        alert("No active karaoke rooms found. Please host or join a room first from Karaoke Rooms.");
        return;
      }
      const rooms = await activeRoomsRes.json();
      if (!Array.isArray(rooms) || rooms.length === 0) {
        alert("No active karaoke rooms found. Please host or join a room first from Karaoke Rooms.");
        return;
      }
      const sessionId = rooms[0].id;
      
      const res = await fetch(`/api/karaoke/sessions/${sessionId}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId })
      });
      if (res.ok) {
        setQueuedSongId(songId);
        setTimeout(() => setQueuedSongId(null), 2000);
      } else {
        alert('Failed to add to room queue');
      }
    } catch (e) {
      console.error(e);
      alert('Failed to add song to queue');
    }
  };

  const handlePlayAll = async (playlist: Playlist) => {
    try {
      setPlayingAll(true);
      const activeRoomsRes = await fetch('/api/karaoke/active-sessions');
      if (!activeRoomsRes.ok || !activeRoomsRes.headers.get('content-type')?.includes('application/json')) {
        alert("No active karaoke rooms found. Please host or join a room first from Karaoke Rooms.");
        setPlayingAll(false);
        return;
      }
      const rooms = await activeRoomsRes.json();
      if (!Array.isArray(rooms) || rooms.length === 0) {
        alert("No active karaoke rooms found. Please host or join a room first from Karaoke Rooms.");
        setPlayingAll(false);
        return;
      }
      const sessionId = rooms[0].id;

      // Ensure we have playlist songs
      let targetSongs = playlist.songs;
      if (!targetSongs) {
        const pRes = await fetch(`/api/playlists/${playlist.id}`);
        if (pRes.ok) {
          const pData = await pRes.json();
          targetSongs = pData.songs;
        }
      }

      if (!targetSongs || targetSongs.length === 0) {
        alert("This playlist has no songs to play.");
        setPlayingAll(false);
        return;
      }

      // Add each song sequentially into room queue
      let count = 0;
      for (const s of targetSongs) {
        await fetch(`/api/karaoke/sessions/${sessionId}/queue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ songId: s.id }),
        });
        count++;
      }

      alert(`Added ${count} songs from "${playlist.name}" to the active Karaoke room queue!`);
    } catch (e: any) {
      console.error(e);
      alert('Failed to play all songs in room');
    } finally {
      setPlayingAll(false);
    }
  };

  const handleDuplicatePlaylist = async (playlist: Playlist) => {
    try {
      const res = await fetch(`/api/playlists/${playlist.id}/duplicate`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Duplicate failed' }));
        throw new Error(data.error || 'Failed to duplicate playlist');
      }
      const cloned = await res.json();
      setPlaylists(prev => [cloned, ...prev]);
      setStats(prev => ({ ...prev, playlists: prev.playlists + 1 }));
    } catch (e: any) {
      alert(e.message || 'Failed to duplicate playlist');
    }
  };

  const handleClearPlaylist = async (playlist: Playlist) => {
    if (!confirm(`Are you sure you want to remove all songs from "${playlist.name}"?`)) {
      return;
    }
    try {
      const res = await fetch(`/api/playlists/${playlist.id}/clear`, {
        method: 'POST',
      });
      if (!res.ok) {
        throw new Error('Failed to clear playlist songs');
      }
      if (selectedPlaylist?.id === playlist.id) {
        setSelectedPlaylist(prev => prev ? { ...prev, songs: [], songCount: 0 } : null);
      }
      setPlaylists(prev => prev.map(p => p.id === playlist.id ? { ...p, songCount: 0, songs: [] } : p));
    } catch (e: any) {
      alert(e.message || 'Failed to clear playlist');
    }
  };

  const handleDeletePlaylist = async (playlist: Playlist) => {
    if (!confirm(`Are you sure you want to delete playlist "${playlist.name}"? This action cannot be undone.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/playlists/${playlist.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Delete failed' }));
        throw new Error(data.error || 'Failed to delete playlist');
      }
      if (selectedPlaylist?.id === playlist.id) {
        setSelectedPlaylist(null);
      }
      setPlaylists(prev => prev.filter(p => p.id !== playlist.id));
      setStats(prev => ({ ...prev, playlists: Math.max(0, prev.playlists - 1) }));
    } catch (e: any) {
      alert(e.message || 'Failed to delete playlist');
    }
  };

  const handleCoverUpload = async (playlistId: number, file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const res = await fetch(`/api/playlists/${playlistId}/cover`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'image/jpeg' },
        body: buffer,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(data.error || 'Failed to upload cover');
      }
      const updated = await res.json();
      const newImageUrl = `/api/playlists/${playlistId}/cover?t=${Date.now()}`;

      if (selectedPlaylist?.id === playlistId) {
        setSelectedPlaylist(prev => prev ? { ...prev, ...updated, coverImageUrl: newImageUrl } : null);
      }
      setPlaylists(prev => prev.map(p => p.id === playlistId ? { ...p, ...updated, coverImageUrl: newImageUrl } : p));
    } catch (e: any) {
      alert(e.message || 'Failed to upload cover image');
    }
  };

  const handleCoverRemove = async (playlistId: number) => {
    if (!confirm('Are you sure you want to remove the cover artwork for this playlist?')) {
      return;
    }
    try {
      const res = await fetch(`/api/playlists/${playlistId}/cover`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error('Failed to remove cover');
      }
      if (selectedPlaylist?.id === playlistId) {
        setSelectedPlaylist(prev => prev ? { ...prev, coverPath: null, coverImageUrl: null } : null);
      }
      setPlaylists(prev => prev.map(p => p.id === playlistId ? { ...p, coverPath: null, coverImageUrl: null } : p));
    } catch (e: any) {
      alert(e.message || 'Failed to remove cover');
    }
  };

  const handleRemoveSong = async (playlistSongId: number) => {
    if (!selectedPlaylist) return;
    try {
      const res = await fetch(`/api/playlists/${selectedPlaylist.id}/songs/${playlistSongId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error('Failed to remove song');
      }
      setSelectedPlaylist(prev => {
        if (!prev) return null;
        const newSongs = (prev.songs || []).filter(s => s.playlistSongId !== playlistSongId);
        return { ...prev, songs: newSongs, songCount: newSongs.length };
      });
      setPlaylists(prev => prev.map(p => {
        if (p.id === selectedPlaylist.id) {
          const count = Math.max(0, (p.songCount || 1) - 1);
          return { ...p, songCount: count };
        }
        return p;
      }));
    } catch (e: any) {
      alert(e.message || 'Failed to remove song');
    }
  };

  const handleReorderSong = async (playlistSongId: number, direction: 'up' | 'down') => {
    if (!selectedPlaylist || !selectedPlaylist.songs) return;
    const currentSongs = [...selectedPlaylist.songs];
    const currentIndex = currentSongs.findIndex(s => s.playlistSongId === playlistSongId);
    if (currentIndex === -1) return;

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= currentSongs.length) return;

    // Swap items locally
    const [moved] = currentSongs.splice(currentIndex, 1);
    currentSongs.splice(targetIndex, 0, moved);

    // Recalculate positions
    const reordered = currentSongs.map((s, idx) => ({ ...s, position: idx }));
    setSelectedPlaylist({ ...selectedPlaylist, songs: reordered });

    // Send to backend
    try {
      const songOrders = reordered.map((s, idx) => ({
        playlistSongId: s.playlistSongId,
        position: idx,
      }));
      await fetch(`/api/playlists/${selectedPlaylist.id}/songs/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songOrders }),
      });
    } catch (e) {
      console.error('Failed to save song reorder:', e);
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const renderArtistLinks = (item: any) => {
    if (item.artists && Array.isArray(item.artists) && item.artists.length > 0) {
      return (
        <span className="inline-flex items-center flex-wrap gap-x-1">
          {item.artists.map((art: any, i: number) => (
            <span key={art.id || i} className="inline-flex items-center">
              {art.id ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openArtist(art.id);
                  }}
                  className="text-zinc-300 hover:text-[#F472B6] hover:underline transition-colors text-left"
                >
                  {art.name}
                </button>
              ) : (
                <span className="text-zinc-300">{art.name}</span>
              )}
              {i < item.artists.length - 1 && <span className="text-zinc-500 mr-0.5">,</span>}
            </span>
          ))}
        </span>
      );
    }
    return <span className="text-zinc-300">{item.artist || 'Unknown Artist'}</span>;
  };

  // -----------------------------------------------------------------
  // VIEW: Selected Playlist Drill-down
  // -----------------------------------------------------------------
  if (selectedPlaylist) {
    return (
      <>
        <PlaylistDetailView
          playlist={selectedPlaylist}
          currentUser={user}
          onBack={() => setSelectedPlaylist(null)}
          onOpenArtist={openArtist}
          onOpenAlbum={openAlbum}
          onAddToQueue={addToQueue}
          onPlayAll={handlePlayAll}
          onOpenAddSongs={() => {
            setActiveModalPlaylist(selectedPlaylist);
            setIsAddSongsOpen(true);
          }}
          onOpenEdit={() => {
            setActiveModalPlaylist(selectedPlaylist);
            setIsEditPlaylistOpen(true);
          }}
          onOpenShare={() => {
            setActiveModalPlaylist(selectedPlaylist);
            setIsSharePlaylistOpen(true);
          }}
          onDuplicate={() => handleDuplicatePlaylist(selectedPlaylist)}
          onClear={() => handleClearPlaylist(selectedPlaylist)}
          onDelete={() => handleDeletePlaylist(selectedPlaylist)}
          onCoverUpload={(file) => handleCoverUpload(selectedPlaylist.id, file)}
          onCoverRemove={() => handleCoverRemove(selectedPlaylist.id)}
          onRemoveSong={handleRemoveSong}
          onReorderSong={handleReorderSong}
          queuedSongId={queuedSongId}
          playingAll={playingAll}
          onOpenLyrics={(songId, title, format) => {
            setEditorState({ isOpen: true, songId, title, format });
          }}
          onSongAdded={(song) => {
            setSelectedPlaylist(prev => {
              if (!prev) return null;
              const newSongs = [...(prev.songs || []), song];
              return { ...prev, songs: newSongs, songCount: newSongs.length };
            });
            setPlaylists(prev => prev.map(p => {
              if (p.id === selectedPlaylist.id) {
                return { ...p, songCount: (p.songCount || 0) + 1 };
              }
              return p;
            }));
          }}
        />

        <AddSongsModal
          isOpen={isAddSongsOpen}
          playlist={activeModalPlaylist || selectedPlaylist}
          onClose={() => {
            setIsAddSongsOpen(false);
            setActiveModalPlaylist(null);
          }}
          onSongAdded={(song) => {
            setSelectedPlaylist(prev => {
              if (!prev) return null;
              const newSongs = [...(prev.songs || []), song];
              return { ...prev, songs: newSongs, songCount: newSongs.length };
            });
            setPlaylists(prev => prev.map(p => {
              if (p.id === selectedPlaylist.id) {
                return { ...p, songCount: (p.songCount || 0) + 1 };
              }
              return p;
            }));
          }}
        />

        <EditPlaylistModal
          isOpen={isEditPlaylistOpen}
          playlist={activeModalPlaylist || selectedPlaylist}
          currentUser={user}
          onClose={() => {
            setIsEditPlaylistOpen(false);
            setActiveModalPlaylist(null);
          }}
          onUpdated={(updated) => {
            setSelectedPlaylist(prev => prev ? { ...prev, ...updated } : null);
            setPlaylists(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p));
          }}
        />
      

        <SharePlaylistModal
          isOpen={isSharePlaylistOpen}
          playlist={activeModalPlaylist || selectedPlaylist}
          currentUser={user}
          onClose={() => {
            setIsSharePlaylistOpen(false);
            setActiveModalPlaylist(null);
          }}
          onUpdated={(updated) => {
            setSelectedPlaylist(prev => prev ? { ...prev, ...updated } : null);
            setPlaylists(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p));
          }}
        />

        <LyricsEditorModal
          isOpen={editorState.isOpen}
          songId={editorState.songId}
          songTitle={editorState.title}
          format={editorState.format}
          onClose={() => setEditorState(prev => ({ ...prev, isOpen: false }))}
          onSave={handleLyricsUpdated}
        />
      </>
    );
  }

  // -----------------------------------------------------------------
  // VIEW: Selected Artist Drill-down
  // -----------------------------------------------------------------
  if (selectedArtist) {
    return (
      <div className="p-6 md:p-10 max-w-6xl mx-auto space-y-8">
        <button 
          onClick={() => setSelectedArtist(null)}
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Library
        </button>

        {/* Artist Hero */}
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 bg-[#141622] p-8 rounded-3xl border border-white/5 shadow-xl">
          <div className="w-28 h-28 rounded-full bg-gradient-to-br from-[#1E2033] to-[#12131F] flex items-center justify-center shrink-0 border border-white/10 shadow-lg shadow-[#F472B6]/10 overflow-hidden relative">
            <Mic className="w-12 h-12 text-[#F472B6] absolute" />
            <img
              src={`/api/artists/${selectedArtist.id}/artwork`}
              alt={selectedArtist.name}
              className="relative z-10 h-full w-full object-cover yk-artwork-image yk-artwork-image"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
          <div className="text-center sm:text-left flex-1">
            <span className="text-xs uppercase tracking-widest text-[#F472B6] font-bold">Artist</span>
            <h1 className="text-3xl md:text-4xl font-extrabold text-white mt-1 mb-2">{selectedArtist.name}</h1>
            <p className="text-sm text-zinc-400 font-medium mb-2">
              {selectedArtist.albums?.length || 0} Albums • {selectedArtist.songs?.length || 0} Songs
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {selectedArtist.songs?.length > 0 && (
                <button
                  onClick={() => playJukeboxQueue(selectedArtist.songs.map((s: any) => ({
                    id: s.id,
                    title: s.title,
                    artist: selectedArtist.name,
                    album: s.album,
                    duration: s.duration,
                    hasArtwork: s.hasArtwork,
                    variant: s.variant,
                  })), 0)}
                  className="px-4 py-2 bg-[#F472B6] hover:bg-[#DB2777] text-white text-xs font-bold rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-[#F472B6]/25 active:scale-95"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Play All Songs</span>
                </button>
              )}

            </div>
          </div>
        </div>

        {/* Albums by Artist */}
        {selectedArtist.albums?.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-white tracking-tight">Discography & Albums</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {selectedArtist.albums.map((album: any) => (
                <div 
                  key={album.id}
                  onClick={() => openAlbum(album.id)}
                  className="group w-44 shrink-0 snap-start cursor-pointer rounded-2xl border border-white/5 bg-[#141622] p-3 transition hover:border-[#F472B6]/30 hover:bg-[#1A1C2C]"
                >
                  <div className="w-full aspect-square bg-[#1C1E2D] rounded-xl mb-3 flex items-center justify-center relative overflow-hidden group-hover:border-[#F472B6]/20 border border-white/5">
                    {album.hasArtwork ? (
                      <img
                        src={`/api/albums/${album.id}/artwork`}
                        alt={album.title}
                        className="h-[70%] w-[70%] object-cover yk-artwork-image yk-artwork-image"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <Disc className="w-10 h-10 text-zinc-600 group-hover:text-[#F472B6] transition-colors" />
                    )}
                  </div>
                  <h3 className="font-semibold text-sm text-white truncate group-hover:text-[#F472B6] transition-colors">{album.title}</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">{album.year || 'Album'}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Songs by Artist */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-white tracking-tight">Songs</h2>
          <div className="overflow-x-auto rounded-xl border border-white/[0.06] bg-[#141416]">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-white/[0.06] bg-[#17171B] text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-5 py-3.5">Title</th>
                  <th className="px-5 py-3.5">Duration</th>
                  <th className="px-5 py-3.5">Variant</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {selectedArtist.songs?.map((song: any, idx: number) => {
                  const isCurrent = jukeboxCurrentSong?.id === song.id;
                  const isThisPlaying = isCurrent && jukeboxIsPlaying;
                  return (
                    <tr key={song.id} className={`transition-colors group ${isCurrent ? 'bg-[#F472B6]/10' : 'hover:bg-[#1A1C2C]/60'}`}>
                      <td className="px-5 py-3.5 font-medium text-white flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => handlePlayInJukebox(song, selectedArtist.songs, idx)}
                          className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center shrink-0 overflow-hidden relative group/play cursor-pointer border border-white/5 hover:border-[#F472B6]/40 transition-colors"
                          title={isThisPlaying ? 'Pause' : 'Play in Jukebox'}
                        >
                          {song.hasArtwork ? (
                            <img
                              src={`/api/songs/${song.id}/artwork`}
                              alt={song.title}
                              className="w-full h-full object-cover yk-artwork-image yk-artwork-image"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <Music className="w-4 h-4 text-zinc-400 group-hover:text-[#F472B6] transition-colors" />
                          )}
                          <div className={`absolute inset-0 bg-black/60 flex items-center justify-center transition-opacity ${isThisPlaying ? 'opacity-100' : 'opacity-0 group-hover/play:opacity-100'}`}>
                            {isThisPlaying ? (
                              <Pause className="w-4 h-4 text-[#F472B6] fill-current" />
                            ) : (
                              <Play className="w-4 h-4 text-white fill-current ml-0.5" />
                            )}
                          </div>
                        </button>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`truncate ${isCurrent ? 'text-[#F472B6] font-semibold' : ''}`} title={song.title}>{song.title}</span>
                          {isCurrent && <EqualizerIndicator isPlaying={isThisPlaying} />}
                          <LyricBadges
                            hasLrc={song.hasLrc}
                            hasElrc={song.hasElrc}
                            onOpenLyrics={(format) => setEditorState({ isOpen: true, songId: song.id, title: song.title, format })}
                          />
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-zinc-400 text-xs font-mono">{formatDuration(song.duration)}</td>
                      <td className="px-5 py-3.5 text-zinc-400 text-xs capitalize">{song.variant}</td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handlePlayInJukebox(song, selectedArtist.songs, idx)}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-all ${
                              isThisPlaying 
                                ? 'bg-[#F472B6] text-white shadow-sm' 
                                : 'bg-white/5 hover:bg-white/15 text-zinc-200 hover:text-white border border-white/5'
                            }`}
                            title={isThisPlaying ? 'Pause song' : 'Play song in Jukebox'}
                          >
                            {isThisPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                            <span>{isThisPlaying ? 'Pause' : 'Play'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleQueueInJukebox(song)}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/5 transition-colors"
                            title="Add to Jukebox queue"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteSong(song)}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-all bg-transparent text-zinc-500 hover:bg-red-500/10 hover:text-red-400 border border-transparent hover:border-red-500/20 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                            title="Delete song from library"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <LyricsEditorModal
          isOpen={editorState.isOpen}
          songId={editorState.songId}
          songTitle={editorState.title}
          format={editorState.format}
          onClose={() => setEditorState(prev => ({ ...prev, isOpen: false }))}
          onSave={handleLyricsUpdated}
        />
      </div>
    );
  }

  // -----------------------------------------------------------------
  // VIEW: Selected Album Drill-down
  // -----------------------------------------------------------------
  if (selectedAlbum) {
    return (
      <div className="p-6 md:p-10 max-w-6xl mx-auto space-y-8">
        <button 
          onClick={() => setSelectedAlbum(null)}
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Library
        </button>

        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 bg-[#141622] p-8 rounded-3xl border border-white/5 shadow-xl">
          <div className="w-32 h-32 rounded-2xl bg-gradient-to-br from-[#1E2033] to-[#12131F] flex items-center justify-center shrink-0 border border-white/10 shadow-lg shadow-[#F472B6]/10 overflow-hidden">
            {selectedAlbum.hasArtwork ? (
              <img
                src={`/api/albums/${selectedAlbum.id}/artwork`}
                alt={selectedAlbum.title}
                className="w-full h-full object-cover yk-artwork-image yk-artwork-image"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <Disc className="w-16 h-16 text-[#F472B6]" />
            )}
          </div>
          <div className="text-center sm:text-left flex-1">
            <span className="text-xs uppercase tracking-widest text-[#F472B6] font-bold">Album</span>
            <h1 className="text-3xl md:text-4xl font-extrabold text-white mt-1 mb-1">{selectedAlbum.title}</h1>
            <p className="text-zinc-300 font-medium text-base mb-1">{selectedAlbum.artist}</p>
            <p className="text-xs text-zinc-400 mb-4">
              {selectedAlbum.year || 'Unknown Year'} • {selectedAlbum.songs?.length || 0} Tracks
            </p>
            {selectedAlbum.songs?.length > 0 && (
              <button
                onClick={() => playJukeboxQueue(selectedAlbum.songs.map((s: any) => ({
                  id: s.id,
                  title: s.title,
                  artist: selectedAlbum.artist,
                  album: selectedAlbum.title,
                  duration: s.duration,
                  hasArtwork: s.hasArtwork,
                  variant: s.variant,
                })), 0)}
                className="px-4 py-2 bg-[#F472B6] hover:bg-[#DB2777] text-white text-xs font-bold rounded-xl transition-all inline-flex items-center gap-2 shadow-lg shadow-[#F472B6]/25 active:scale-95"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Play Album</span>
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-white/[0.06] bg-[#141416]">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-white/[0.06] bg-[#17171B] text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-5 py-3.5 w-16">#</th>
                <th className="px-5 py-3.5">Title</th>
                <th className="px-5 py-3.5">Duration</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {selectedAlbum.songs?.map((song: any, idx: number) => {
                const isCurrent = jukeboxCurrentSong?.id === song.id;
                const isThisPlaying = isCurrent && jukeboxIsPlaying;
                return (
                  <tr key={song.id} className={`transition-colors group ${isCurrent ? 'bg-[#F472B6]/10' : 'hover:bg-[#1A1C2C]/60'}`}>
                    <td className="px-5 py-3.5 text-zinc-500 font-mono text-xs">
                      <button
                        type="button"
                        onClick={() => handlePlayInJukebox(song, selectedAlbum.songs, idx)}
                        className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
                        title={isThisPlaying ? 'Pause' : 'Play'}
                      >
                        {isThisPlaying ? (
                          <Pause className="w-3.5 h-3.5 text-[#F472B6] fill-current" />
                        ) : (
                          <span className="group-hover:hidden">{song.trackNumber || idx + 1}</span>
                        )}
                        {!isThisPlaying && (
                          <Play className="w-3.5 h-3.5 fill-current hidden group-hover:block ml-0.5" />
                        )}
                      </button>
                    </td>
                    <td className="px-5 py-3.5 font-medium text-white flex items-center gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`truncate ${isCurrent ? 'text-[#F472B6] font-semibold' : ''}`} title={song.title}>{song.title}</span>
                        {isCurrent && <EqualizerIndicator isPlaying={isThisPlaying} />}
                        <LyricBadges
                          hasLrc={song.hasLrc}
                          hasElrc={song.hasElrc}
                          onOpenLyrics={(format) => setEditorState({ isOpen: true, songId: song.id, title: song.title, format })}
                        />
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-zinc-400 font-mono text-xs">{formatDuration(song.duration)}</td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handlePlayInJukebox(song, selectedAlbum.songs, idx)}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-all ${
                            isThisPlaying 
                              ? 'bg-[#F472B6] text-white shadow-sm' 
                              : 'bg-white/5 hover:bg-white/15 text-zinc-200 hover:text-white border border-white/5'
                          }`}
                          title={isThisPlaying ? 'Pause track' : 'Play track in Jukebox'}
                        >
                          {isThisPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                          <span>{isThisPlaying ? 'Pause' : 'Play'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleQueueInJukebox(song)}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/5 transition-colors"
                          title="Add to Jukebox queue"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteSong(song)}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-all bg-transparent text-zinc-500 hover:bg-red-500/10 hover:text-red-400 border border-transparent hover:border-red-500/20 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                          title="Delete song from library"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <LyricsEditorModal
          isOpen={editorState.isOpen}
          songId={editorState.songId}
          songTitle={editorState.title}
          format={editorState.format}
          onClose={() => setEditorState(prev => ({ ...prev, isOpen: false }))}
          onSave={handleLyricsUpdated}
        />
      </div>
    );
  }

  // -----------------------------------------------------------------
  // MAIN VIEW: Library Catalogs & Search
  // -----------------------------------------------------------------
  return (
    <div className="w-full max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8 xl:p-10 pb-24 md:pb-8 space-y-7">
      {/* Search */}
      <div className="flex justify-end">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-80">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input 
              type="text" 
              placeholder="Search artists, albums, or songs..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-[#141622] border border-white/10 rounded-full text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-[#F472B6] focus:ring-1 focus:ring-[#F472B6] transition-all"
            />
          </div>
          {user?.role === 'administrator' && (
            <button 
              onClick={triggerScan}
              disabled={scanning}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#1C1E2D] hover:bg-[#25283C] text-white rounded-full text-xs font-semibold border border-white/10 transition-colors disabled:opacity-50 shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin text-[#F472B6]' : ''}`} />
              <span>{scanning ? 'Scanning...' : 'Scan Media'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Error state alert banner */}
      {error && (
        <div className="p-4 bg-red-950/40 border border-red-500/30 rounded-2xl flex items-center justify-between gap-4 text-red-300">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
            <div>
              <p className="font-semibold text-red-200 text-sm">Failed to load library data</p>
              <p className="text-xs text-red-300/80">{error}</p>
            </div>
          </div>
          <button 
            onClick={loadAllData}
            className="px-3.5 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-semibold transition-colors shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && !error && (
        <div className="py-24 text-center">
          <RefreshCw className="w-8 h-8 text-[#F472B6] animate-spin mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">Loading media catalog...</p>
        </div>
      )}

      {/* Search results view if searching */}
      {search.trim() && !loading && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-white">Search Results for "{search}"</h2>
          <div className="overflow-x-auto rounded-xl border border-white/[0.06] bg-[#141416]">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-white/[0.06] bg-[#17171B] text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-5 py-3.5">Type</th>
                  <th className="px-5 py-3.5">Name / Title</th>
                  <th className="px-5 py-3.5">Details</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {searchResults.map((item: any, idx: number) => (
                  <tr key={idx} className="hover:bg-[#1A1C2C]/60 transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#F472B6]/15 text-[#F472B6] border border-[#F472B6]/25">
                        {item.type}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-medium text-white flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0 overflow-hidden">
                        {item.hasArtwork ? (
                          <img
                            src={
                              item.type === 'artist'
                                ? `/api/artists/${item.id}/artwork`
                                : item.type === 'album'
                                ? `/api/albums/${item.id}/artwork`
                                : `/api/songs/${item.id}/artwork`
                            }
                            alt={item.title || item.name}
                            className="w-full h-full object-cover yk-artwork-image yk-artwork-image"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        ) : item.type === 'artist' ? (
                          <Mic className="w-4 h-4 text-zinc-400" />
                        ) : item.type === 'album' ? (
                          <Disc className="w-4 h-4 text-zinc-400" />
                        ) : (
                          <Music className="w-4 h-4 text-zinc-400" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`truncate ${item.type === 'song' && jukeboxCurrentSong?.id === item.id ? 'text-[#F472B6] font-semibold' : ''}`}>{item.title || item.name}</span>
                        {item.type === 'song' && jukeboxCurrentSong?.id === item.id && (
                          <EqualizerIndicator isPlaying={jukeboxIsPlaying} />
                        )}
                        {item.type === 'song' && (
                          <LyricBadges
                            hasLrc={item.hasLrc}
                            hasElrc={item.hasElrc}
                            onOpenLyrics={(format) => setEditorState({ isOpen: true, songId: item.id, title: item.title, format })}
                          />
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-zinc-400 text-xs">
                      {item.type === 'song' ? renderArtistLinks(item) : (item.artist || item.album || '—')}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {item.type === 'artist' && (
                        <button onClick={() => openArtist(item.id)} className="px-3 py-1.5 bg-white/5 hover:bg-white/15 text-white rounded-lg text-xs font-medium">View</button>
                      )}
                      {item.type === 'album' && (
                        <button onClick={() => openAlbum(item.id)} className="px-3 py-1.5 bg-white/5 hover:bg-white/15 text-white rounded-lg text-xs font-medium">View</button>
                      )}
                      {item.type === 'song' && (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handlePlayInJukebox(item)}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-all ${
                              jukeboxCurrentSong?.id === item.id && jukeboxIsPlaying
                                ? 'bg-[#F472B6] text-white shadow-sm'
                                : 'bg-white/5 hover:bg-white/15 text-zinc-200 hover:text-white border border-white/5'
                            }`}
                            title={jukeboxCurrentSong?.id === item.id && jukeboxIsPlaying ? 'Pause song' : 'Play song in Jukebox'}
                          >
                            {jukeboxCurrentSong?.id === item.id && jukeboxIsPlaying ? (
                              <Pause className="w-3.5 h-3.5 fill-current" />
                            ) : (
                              <Play className="w-3.5 h-3.5 fill-current" />
                            )}
                            <span>{jukeboxCurrentSong?.id === item.id && jukeboxIsPlaying ? 'Pause' : 'Play'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleQueueInJukebox(item)}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/5 transition-colors"
                            title="Add to Jukebox queue"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteSong(item)}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-all bg-transparent text-zinc-500 hover:bg-red-500/10 hover:text-red-400 border border-transparent hover:border-red-500/20 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                            title="Delete song from library"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {searchResults.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-10 text-center text-zinc-500 text-sm">No matching items found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && !error && (

        <>

          {/* Jukebox Overview Dashboard */}
          {tab === 'home' && (() => {
            return (
              <div className="space-y-10">
                {/* 1. Featured Playlists: one horizontal row, swipe/scroll to browse. */}
                <section className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-bold text-white">Featured Playlists</h2>
                      <p className="mt-1 text-xs text-zinc-500">Swipe or scroll to discover a playlist.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => scrollPlaylistRail(-1)} disabled={playlists.length < 2} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white transition hover:bg-white/10 disabled:opacity-30" aria-label="Previous featured playlists">
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => scrollPlaylistRail(1)} disabled={playlists.length < 2} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white transition hover:bg-white/10 disabled:opacity-30" aria-label="Next featured playlists">
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {playlists.length ? (
                    <div ref={playlistRailRef} className="yk-horizontal-rail flex items-stretch gap-4 overflow-x-auto pb-3 snap-x snap-mandatory">
                      {playlists.map((playlist) => {
                        return (
                          <button
                            key={playlist.id}
                            type="button"
                            onClick={() => openPlaylist(playlist.id)}
                            className="group relative h-[7.5rem] w-[min(44vw,11.5rem)] shrink-0 snap-start overflow-hidden rounded-xl border border-white/10 bg-[#141416] text-left shadow-lg shadow-black/20 sm:h-32"
                            aria-label={`Open playlist ${playlist.name}`}
                          >
                            {playlist.coverImageUrl || playlist.coverPath ? (
                              <img
                                key={playlist.id}
                                src={playlist.coverImageUrl && /^(https?:|data:)/i.test(playlist.coverImageUrl) ? playlist.coverImageUrl : `/api/playlists/${playlist.id}/cover`}
                                alt=""
                                className="absolute inset-0 h-full w-full object-cover yk-artwork-image yk-artwork-image"
                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                              />
                            ) : (
                              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#24242B] to-[#111114]">
                                <ListMusic className="h-8 w-8 text-white/20" strokeWidth={1} />
                              </div>
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-transparent" />
                            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2">
                              <div className="min-w-0">
                                <span className="mb-0.5 block text-[8px] font-bold uppercase tracking-[0.1em] text-[#F472B6]">Featured playlist</span>
                                <h3 className="truncate text-sm font-bold text-white">{playlist.name}</h3>
                                <p className="mt-0.5 text-[10px] text-white/70">{playlist.songCount || playlist.songs?.length || 0} songs</p>
                              </div>
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F472B6] text-white shadow-lg shadow-[#F472B6]/25 transition-transform group-hover:scale-105">
                                <ChevronRight className="h-4 w-4" />
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex h-60 w-full max-w-3xl flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-[#141416] p-6 text-center">
                      <ListMusic className="mb-3 h-12 w-12 text-zinc-600" />
                      <h3 className="text-lg font-bold text-white">No playlists yet</h3>
                      <p className="mb-4 mt-1 text-xs text-zinc-400">Create your first playlist to feature it here.</p>
                      <button type="button" onClick={(e) => { e.stopPropagation(); setIsCreatePlaylistOpen(true); }} className="rounded-full bg-[#F472B6] px-5 py-2.5 text-xs font-bold text-white transition hover:bg-[#DB2777]">Create Playlist</button>
                    </div>
                  )}
                </section>

                {/* 2. Artists Row (immediately below featured playlist) */}
                <section className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-bold text-white">Artists</h2>
                      <p className="mt-1 text-xs text-zinc-500">Explore music by artist.</p>
                    </div>
                    <button type="button" onClick={() => setTab('artists')} className="shrink-0 text-xs font-semibold text-[#F472B6] hover:text-white">
                      View all <ChevronRight className="ml-1 inline h-4 w-4" />
                    </button>
                  </div>
                  {artists.length ? (
                    <div className="yk-horizontal-rail flex items-center gap-4 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-none">
                      {artists.map(artist => (
                        <button
                          type="button"
                          key={artist.id}
                          onClick={() => openArtist(artist.id)}
                          className="yk-artist-carousel-card group flex flex-col items-center shrink-0 w-28 snap-start text-center transition hover:opacity-90 cursor-pointer"
                        >
                          <div className="relative mb-2.5 flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-[#1C1E2D] border border-white/10 group-hover:border-[#F472B6]/40 transition-colors shadow-md">
                            <Mic className="absolute h-8 w-8 text-zinc-600 group-hover:text-[#F472B6] transition-colors" />
                            <img
                              src={'/api/artists/' + artist.id + '/artwork'}
                              alt={artist.name}
                              className="relative z-10 h-full w-full object-cover yk-artwork-image"
                              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                            />
                          </div>
                          <span className="w-full truncate text-xs font-semibold text-white group-hover:text-[#F472B6] transition-colors">{artist.name}</span>
                          <span className="mt-0.5 text-[11px] text-zinc-500">{artist.songCount || 0} songs</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-zinc-500">No artists yet. Artists will appear after songs are scanned.</div>
                  )}
                </section>

                {/* 3. Albums carousel */}
                <section className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-bold text-white">Albums</h2>
                      <p className="mt-1 text-xs text-zinc-500">Browse albums from your collection.</p>
                    </div>
                    <button type="button" onClick={() => setTab('albums')} className="shrink-0 text-xs font-semibold text-[#F472B6] hover:text-white">
                      View all <ChevronRight className="ml-1 inline h-4 w-4" />
                    </button>
                  </div>
                  {albums.length ? (
                    <div className="yk-horizontal-rail flex items-start gap-4 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-none">
                      {albums.map(album => (
                        <button
                          type="button"
                          key={album.id}
                          onClick={() => openAlbum(album.id)}
                          className="group w-[6.3rem] sm:w-[7rem] shrink-0 snap-start rounded-xl p-2 text-left transition hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F472B6]"
                          aria-label={`Open album ${album.title}`}
                        >
                          <div className="relative mb-3 flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-white/5 bg-[#1A1C2C] shadow-inner transition-colors group-hover:border-[#F472B6]/40">
                            {album.hasArtwork ? (
                              <img
                                src={`/api/albums/${album.id}/artwork`}
                                alt={album.title}
                                className="h-full w-full object-cover yk-artwork-image"
                                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                              />
                            ) : (
                              <Disc className="h-10 w-10 text-zinc-500 transition-colors group-hover:text-[#F472B6]" />
                            )}
                          </div>
                          <span className="block truncate text-xs font-semibold text-white transition-colors group-hover:text-[#F472B6]">{album.title}</span>
                          <span className="mt-0.5 block truncate text-[11px] text-zinc-400">{album.artist || 'Unknown Artist'}</span>
                          <span className="mt-1 block text-[10px] text-zinc-500">{album.songCount || 0} tracks</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-zinc-500">No albums yet. Albums will appear after songs are scanned.</div>
                  )}
                </section>

                {/* 4. Recently Added (below Albums) */}
                <section className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-bold text-white">Recently Added</h2>
                      <p className="mt-1 text-xs text-zinc-500">Pick up where your collection is growing.</p>
                    </div>
                    <button type="button" onClick={() => setTab('songs')} className="shrink-0 text-xs font-semibold text-[#F472B6] hover:text-white">
                      View all <ChevronRight className="ml-1 inline h-4 w-4" />
                    </button>
                  </div>
                  {songs.length ? (
                    <div className="yk-horizontal-rail flex items-start gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-none">
                      {songs.slice(0, 10).map((song, idx) => (
                        <div
                          key={song.id}
                          className="group flex flex-col shrink-0 w-[6.3rem] snap-start rounded-xl p-2 transition hover:bg-white/[0.04] cursor-pointer"
                          onClick={() => handlePlayInJukebox(song, songs, idx)}
                        >
                          <div className="relative mb-2 aspect-square w-full overflow-hidden rounded-lg bg-[#1C1E2D] flex items-center justify-center">
                            {song.hasArtwork ? (
                              <img
                                src={'/api/songs/' + song.id + '/artwork'}
                                alt=""
                                className="h-full w-full object-cover yk-artwork-image yk-artwork-image transition"
                                onError={e => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
                              />
                            ) : (
                              <Music className="h-7 w-7 text-zinc-600" />
                            )}
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <div className="w-8 h-8 rounded-full bg-[#F472B6] text-white flex items-center justify-center shadow-md">
                                <Play className="w-4 h-4 fill-current ml-0.5" />
                              </div>
                            </div>
                          </div>
                          <span className="block truncate text-xs font-semibold text-white group-hover:text-[#F472B6] transition-colors">{song.title}</span>
                          <span className="mt-0.5 block truncate text-[11px] text-zinc-400">{song.artist || 'Unknown Artist'}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-zinc-500">No songs yet. Add music to a configured library and run a scan.</div>
                  )}
                </section>

                {/* 5. Songs list (below Recently Added) */}
                <section className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-bold text-white">Songs</h2>
                      <p className="mt-1 text-xs text-zinc-500">Play a track, favourite it, or add it to your queue.</p>
                    </div>
                    <button type="button" onClick={() => setTab('songs')} className="shrink-0 text-xs font-semibold text-[#F472B6] hover:text-white">
                      View all <ChevronRight className="ml-1 inline h-4 w-4" />
                    </button>
                  </div>
                  {songs.length ? (
                    <div className="divide-y divide-white/[0.04]">
                      {songs.slice(0, 10).map((song, index) => {
                        const isCurrent = jukeboxCurrentSong?.id === song.id;
                        const isThisPlaying = isCurrent && jukeboxIsPlaying;
                        const isFav = favoriteIds.has(song.id);

                        return (
                          <div
                            key={song.id}
                            className="flex items-center gap-2.5 py-2 transition-colors"
                          >
                            {/* Small square artwork */}
                            <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#1C1E2D]">
                              {song.hasArtwork ? (
                                <img
                                  src={'/api/songs/' + song.id + '/artwork'}
                                  alt=""
                                  className="h-full w-full object-cover yk-artwork-image yk-artwork-image"
                                  onError={e => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
                                />
                              ) : (
                                <Music className="h-5 w-5 text-zinc-600" />
                              )}
                            </div>

                            {/* Song title on first line, artist name underneath */}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <p className={`truncate text-sm font-semibold ${isCurrent ? 'text-[#F472B6]' : 'text-white'}`} title={song.title}>
                                  {song.title}
                                </p>
                                {isCurrent && <EqualizerIndicator isPlaying={isThisPlaying} />}
                              </div>
                              <p className="truncate text-xs text-zinc-400">
                                {song.artist || 'Unknown Artist'}
                              </p>
                            </div>

                            {/* Play/Pause, favourite-heart, and add-to-queue on the same row */}
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => handlePlayInJukebox(song, songs, index)}
                                className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition ${
                                  isThisPlaying
                                    ? 'bg-[#F472B6] text-white shadow-sm'
                                    : 'bg-white/5 hover:bg-[#F472B6] text-white'
                                }`}
                                aria-label={isThisPlaying ? 'Pause ' + song.title : 'Play ' + song.title}
                                title={isThisPlaying ? 'Pause' : 'Play ' + song.title}
                              >
                                {isThisPlaying ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current ml-0.5" />}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleToggleFavorite(song.id)}
                                className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition ${
                                  isFav
                                    ? 'text-[#F472B6] bg-[#F472B6]/15 hover:bg-[#F472B6]/25'
                                    : 'text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10'
                                }`}
                                aria-label={isFav ? 'Remove from favourites' : 'Add to favourites'}
                                title={isFav ? 'Remove from favourites' : 'Add to favourites'}
                              >
                                <Heart className={`h-3.5 w-3.5 ${isFav ? 'fill-current' : ''}`} />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleQueueInJukebox(song)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 hover:text-white transition"
                                aria-label={'Add ' + song.title + ' to queue'}
                                title={'Add ' + song.title + ' to queue'}
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-zinc-500">No songs yet. Add music to a configured library and run a scan.</div>
                  )}
                </section>
              </div>
            );
          })()}

          {/* Artists Grid */}
          {tab === 'artists' && (
            <div className="yk-horizontal-rail flex items-start gap-4 overflow-x-auto pb-4 snap-x snap-mandatory">
              {artists.map(artist => (
                <div 
                  key={artist.id}
                  onClick={() => openArtist(artist.id)}
                  className="group flex w-32 shrink-0 snap-start cursor-pointer flex-col items-center rounded-2xl border border-white/5 bg-[#141622] p-4 text-center transition hover:border-[#F472B6]/30 hover:bg-[#1A1C2C]"
                >
                  <div className="relative mb-3 flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-[#1A1C2C] shadow-inner transition-colors group-hover:border-[#F472B6]/50">
                    <Mic className="w-10 h-10 text-zinc-500 group-hover:text-[#F472B6] transition-colors absolute" />
                    <img
                      src={`/api/artists/${artist.id}/artwork`}
                      alt={artist.name}
                      className="relative z-10 h-full w-full object-cover yk-artwork-image yk-artwork-image"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                  <h3 className="w-full truncate text-sm font-semibold text-white transition-colors group-hover:text-[#F472B6]">{artist.name}</h3>
                  <p className="text-xs text-zinc-400 mt-1">{artist.songCount || 0} Songs • {artist.albumCount || 0} Albums</p>
                </div>
              ))}
              {artists.length === 0 && (
                <div className="col-span-full py-16 text-center text-zinc-500">
                  No artists found. Run a library scan or configure a directory in Settings.
                </div>
              )}
            </div>
          )}

          {/* Albums Grid */}
          {tab === 'albums' && (
            <div className="yk-horizontal-rail flex items-start gap-4 overflow-x-auto pb-4 snap-x snap-mandatory">
              {albums.map(album => (
                <div 
                  key={album.id}
                  onClick={() => openAlbum(album.id)}
                  className="group w-[6.3rem] shrink-0 cursor-pointer rounded-xl p-2 transition hover:bg-white/[0.04]"
                >
                  <div className="relative mb-3 flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-white/5 bg-[#1A1C2C] shadow-inner transition-colors group-hover:border-[#F472B6]/40">
                    {album.hasArtwork ? (
                      <img
                        src={`/api/albums/${album.id}/artwork`}
                        alt={album.title}
                        className="w-full h-full object-cover yk-artwork-image yk-artwork-image"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <Disc className="w-12 h-12 text-zinc-500 group-hover:text-[#F472B6] transition-colors" />
                    )}
                  </div>
                  <h3 className="font-semibold text-sm text-white truncate group-hover:text-[#F472B6] transition-colors">{album.title}</h3>
                  <p className="text-xs text-zinc-400 truncate mt-0.5">{album.artist || 'Unknown Artist'}</p>
                  <p className="text-[11px] text-zinc-500 mt-1">{album.year || 'Album'} • {album.songCount || 0} Tracks</p>
                </div>
              ))}
              {albums.length === 0 && (
                <div className="col-span-full py-16 text-center text-zinc-500">
                  No albums found in media library.
                </div>
              )}
            </div>
          )}

          {/* Songs List — clean, borderless styling matching the Jukebox rows */}
          {tab === 'songs' && (
            <div className="min-w-0">
              <div className="divide-y divide-white/[0.04]">
                {songs.map((song, idx) => {
                  const isCurrent = jukeboxCurrentSong?.id === song.id;
                  const isThisPlaying = isCurrent && jukeboxIsPlaying;

                  return (
                    <div key={song.id} className="flex items-center gap-2.5 py-2 transition-colors">
                      {/* Artwork plays the song; Plus adds it to the existing queue. */}
                      <button
                        type="button"
                        onClick={() => handlePlayInJukebox(song, songs, idx)}
                        className="group/play relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg"
                        title={isThisPlaying ? 'Pause in Jukebox' : 'Play in Jukebox'}
                        aria-label={`${isThisPlaying ? 'Pause' : 'Play'} ${song.title} in Jukebox`}
                      >
                        {song.hasArtwork ? (
                          <img
                            src={`/api/songs/${song.id}/artwork`}
                            alt=""
                            className="h-full w-full object-cover yk-artwork-image"
                            onError={(e) => {
                              (e.currentTarget as HTMLElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <Music className="h-4 w-4 text-zinc-500" />
                        )}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className={`truncate text-sm font-semibold ${isCurrent ? 'text-[#F472B6]' : 'text-white'}`} title={song.title}>
                            {song.title}
                          </span>
                          {isCurrent && <EqualizerIndicator isPlaying={isThisPlaying} />}
                          <LyricBadges
                            hasLrc={song.hasLrc}
                            hasElrc={song.hasElrc}
                            onOpenLyrics={(format) => setEditorState({ isOpen: true, songId: song.id, title: song.title, format })}
                          />
                        </div>
                      <div className="truncate text-xs text-zinc-400" title={song.artist}>
                        {renderArtistLinks(song)}
                      </div>
                    </div>

                    <span className="hidden shrink-0 text-xs text-zinc-500 sm:block">{song.album || '—'}</span>
                    <span className="hidden shrink-0 font-mono text-xs text-zinc-500 md:block">{formatDuration(song.duration)}</span>
                    <button
                      type="button"
                      onClick={() => handleQueueInJukebox(song)}
                      className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:text-white"
                      title={`Add ${song.title} to queue`}
                      aria-label={`Add ${song.title} to queue`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSong(song)}
                      className="shrink-0 rounded-full p-2 text-zinc-500 transition-colors hover:text-red-400 focus-visible:text-red-400"
                      title="Delete song from library"
                      aria-label={`Delete ${song.title} from library`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
                {songs.length === 0 && (
                  <div className="py-12 text-center text-sm text-zinc-500">No songs found in library.</div>
                )}
              </div>
            </div>
          )}

          {/* Playlists Grid */}
          {tab === 'playlists' && (
            <PlaylistsGrid
              playlists={playlists}
              currentUser={user}
              onOpenPlaylist={openPlaylist}
              onCreateNew={() => setIsCreatePlaylistOpen(true)}
              onEdit={(playlist) => {
                setActiveModalPlaylist(playlist);
                setIsEditPlaylistOpen(true);
              }}
              onShare={(playlist) => {
                setActiveModalPlaylist(playlist);
                setIsSharePlaylistOpen(true);
              }}
              onDuplicate={handleDuplicatePlaylist}
              onClear={handleClearPlaylist}
              onDelete={handleDeletePlaylist}
              onCoverUpload={handleCoverUpload}
              onCoverRemove={handleCoverRemove}
              onPlayAll={handlePlayAll}
              layout="carousel"
            />
          )}
        </>
      )}

      {/* Global Modals for Playlists Tab */}
      <CreatePlaylistModal
        isOpen={isCreatePlaylistOpen}
        onClose={() => setIsCreatePlaylistOpen(false)}
        onCreated={(created) => {
          setPlaylists(prev => [created, ...prev]);
          setStats(prev => ({ ...prev, playlists: prev.playlists + 1 }));
          openPlaylist(created.id);
        }}
      />

      <EditPlaylistModal
        isOpen={isEditPlaylistOpen}
        playlist={activeModalPlaylist}
        currentUser={user}
        onClose={() => {
          setIsEditPlaylistOpen(false);
          setActiveModalPlaylist(null);
        }}
        onUpdated={(updated) => {
          setPlaylists(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p));
        }}
      />

      <SharePlaylistModal
        isOpen={isSharePlaylistOpen}
        playlist={activeModalPlaylist}
        currentUser={user}
        onClose={() => {
          setIsSharePlaylistOpen(false);
          setActiveModalPlaylist(null);
        }}
        onUpdated={(updated) => {
          setPlaylists(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p));
        }}
      />
      <LyricsEditorModal
        isOpen={editorState.isOpen}
        songId={editorState.songId}
        songTitle={editorState.title}
        format={editorState.format}
        onClose={() => setEditorState(prev => ({ ...prev, isOpen: false }))}
        onSave={handleLyricsUpdated}
      />
    </div>
  );
}
