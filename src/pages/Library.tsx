import { useState, useEffect, useRef, useCallback } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { Search, Play, Pause, Music, Disc, Mic, RefreshCw, Calendar, FileText, ChevronRight, ChevronLeft, ArrowLeft, AlertCircle, ListMusic, Trash2, Plus, Heart, MoreVertical, Check, Loader2, X } from 'lucide-react';
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
import JukeboxSongCard from '../components/jukebox/JukeboxSongCard';
import JukeboxArtistCard from '../components/jukebox/JukeboxArtistCard';
import JukeboxAlbumCard from '../components/jukebox/JukeboxAlbumCard';
import JukeboxPlaylistCard from '../components/jukebox/JukeboxPlaylistCard';
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
  const [hasMoreArtists, setHasMoreArtists] = useState(false);
  const [loadingMoreArtists, setLoadingMoreArtists] = useState(false);
  const artistsLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const artistsRequestOffsetRef = useRef(0);
  const loadingMoreArtistsRef = useRef(false);
  const ARTISTS_PAGE_SIZE = 40;
  const [albums, setAlbums] = useState<any[]>([]);
  const [hasMoreAlbums, setHasMoreAlbums] = useState(false);
  const [loadingMoreAlbums, setLoadingMoreAlbums] = useState(false);
  const albumsLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const albumsRequestOffsetRef = useRef(0);
  const loadingMoreAlbumsRef = useRef(false);
  const ALBUMS_PAGE_SIZE = 40;
  const [activeJumpLetter, setActiveJumpLetter] = useState('#');
  const [entityCardLayout, setEntityCardLayout] = useState<'grid' | 'list'>('grid');
  const [songs, setSongs] = useState<any[]>([]);
  const [songsSort, setSongsSort] = useState<'artist' | 'title' | 'album' | 'recent' | 'oldest' | 'duration' | 'track'>(() => {
    const savedSort = window.localStorage.getItem('yimly-songs-sort');
    const validSorts = ['artist', 'title', 'album', 'recent', 'oldest', 'duration', 'track'] as const;
    return validSorts.includes(savedSort as (typeof validSorts)[number])
      ? savedSort as (typeof validSorts)[number]
      : 'artist';
  });
  const [hasMoreSongs, setHasMoreSongs] = useState(false);
  const [loadingMoreSongs, setLoadingMoreSongs] = useState(false);
  const songsLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const songsRequestOffsetRef = useRef(0);
  const loadingMoreSongsRef = useRef(false);
  const SONGS_PAGE_SIZE = 50;
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [searchResults, setSearchResults] = useState<any[]>([]);

  // Detailed view states
  const [selectedArtist, setSelectedArtist] = useState<any | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<any | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [artistArtworkVersions, setArtistArtworkVersions] = useState<Record<number, number>>({});
  const [refreshingArtistId, setRefreshingArtistId] = useState<number | null>(null);
  const [artistArtworkErrors, setArtistArtworkErrors] = useState<Record<number, boolean>>({});

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

  const [replaceSourceModal, setReplaceSourceModal] = useState<{
    isOpen: boolean;
    songId: number | null;
    songTitle: string;
    songArtist: string;
    youtubeUrl: string;
    loading: boolean;
    error: string | null;
    successMsg: string | null;
  }>({
    isOpen: false,
    songId: null,
    songTitle: '',
    songArtist: '',
    youtubeUrl: '',
    loading: false,
    error: null,
    successMsg: null,
  });

  const [replaceInstrumentalModal, setReplaceInstrumentalModal] = useState<{
    isOpen: boolean;
    songId: number | null;
    songTitle: string;
    songArtist: string;
    loading: boolean;
    error: string | null;
    successMsg: string | null;
  }>({
    isOpen: false,
    songId: null,
    songTitle: '',
    songArtist: '',
    loading: false,
    error: null,
    successMsg: null,
  });

  const [addToPlaylistModal, setAddToPlaylistModal] = useState<{
    isOpen: boolean;
    song: any | null;
    addingToId: number | null;
    successPlaylistId: number | null;
    error: string | null;
  }>({
    isOpen: false,
    song: null,
    addingToId: null,
    successPlaylistId: null,
    error: null,
  });

  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{
    isOpen: boolean;
    song: any | null;
    deleting: boolean;
  }>({
    isOpen: false,
    song: null,
    deleting: false,
  });

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

  const handleOpenReplaceSource = async (song: any) => {
    let existingUrl = '';
    try {
      const res = await fetch(`/api/songs/${song.id}/verified-source`);
      if (res.ok) {
        const data = await res.json();
        if (data.verifiedSource?.youtubeUrl) {
          existingUrl = data.verifiedSource.youtubeUrl;
        }
      }
    } catch {}

    setReplaceSourceModal({
      isOpen: true,
      songId: song.id,
      songTitle: song.title,
      songArtist: song.artist || 'Unknown Artist',
      youtubeUrl: existingUrl,
      loading: false,
      error: null,
      successMsg: null,
    });
  };

  const handleExecuteReplaceSource = async () => {
    if (!replaceSourceModal.songId || !replaceSourceModal.youtubeUrl.trim()) return;
    setReplaceSourceModal(prev => ({ ...prev, loading: true, error: null, successMsg: null }));

    try {
      const res = await fetch(`/api/songs/${replaceSourceModal.songId}/replace-source`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtubeUrl: replaceSourceModal.youtubeUrl.trim() }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.details || 'Failed to replace recording source');
      }

      setReplaceSourceModal(prev => ({
        ...prev,
        loading: false,
        successMsg: 'Recording replaced and audio reprocessed successfully!',
      }));
    } catch (err: any) {
      setReplaceSourceModal(prev => ({
        ...prev,
        loading: false,
        error: err.message || 'Failed to replace recording source',
      }));
    }
  };

  const handleOpenReplaceInstrumental = (song: any) => {
    setReplaceInstrumentalModal({
      isOpen: true,
      songId: song.id,
      songTitle: song.title,
      songArtist: song.artist || 'Unknown Artist',
      loading: false,
      error: null,
      successMsg: null,
    });
  };

  const handleExecuteReplaceInstrumental = async () => {
    if (!replaceInstrumentalModal.songId) return;
    setReplaceInstrumentalModal(prev => ({ ...prev, loading: true, error: null, successMsg: null }));

    try {
      const res = await fetch(`/api/songs/${replaceInstrumentalModal.songId}/replace-instrumental`, {
        method: 'POST',
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.details || 'Failed to regenerate instrumental');
      }

      setReplaceInstrumentalModal(prev => ({
        ...prev,
        loading: false,
        successMsg: 'Instrumental regenerated and replaced successfully!',
      }));
    } catch (err: any) {
      setReplaceInstrumentalModal(prev => ({
        ...prev,
        loading: false,
        error: err.message || 'Failed to regenerate instrumental',
      }));
    }
  };

  const handleOpenAddToPlaylist = (song: any) => {
    setAddToPlaylistModal({
      isOpen: true,
      song,
      addingToId: null,
      successPlaylistId: null,
      error: null,
    });
  };

  const handleAddSongToSpecificPlaylist = async (playlistId: number) => {
    if (!addToPlaylistModal.song || addToPlaylistModal.addingToId) return;
    setAddToPlaylistModal(prev => ({ ...prev, addingToId: playlistId, error: null }));

    try {
      const res = await fetch(`/api/playlists/${playlistId}/songs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId: addToPlaylistModal.song.id }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to add song' }));
        throw new Error(data.error || 'Failed to add song to playlist');
      }

      setPlaylists(prev => prev.map(p => p.id === playlistId ? { ...p, songCount: (p.songCount || 0) + 1 } : p));
      setAddToPlaylistModal(prev => ({
        ...prev,
        addingToId: null,
        successPlaylistId: playlistId,
      }));

      setTimeout(() => {
        setAddToPlaylistModal({ isOpen: false, song: null, addingToId: null, successPlaylistId: null, error: null });
      }, 1200);
    } catch (e: any) {
      setAddToPlaylistModal(prev => ({
        ...prev,
        addingToId: null,
        error: e.message || 'Failed to add song to playlist',
      }));
    }
  };

  const getSongCardActions = (song: any) => ({
    onAddToQueue: () => handleQueueInJukebox(song),
    isFavorite: favoriteIds.has(song.id),
    onToggleFavorite: () => handleToggleFavorite(song.id),
    onAddToPlaylist: () => handleOpenAddToPlaylist(song),
    onReplaceAudio: () => handleOpenReplaceSource(song),
    onReplaceInstrumental: () => handleOpenReplaceInstrumental(song),
    onDeleteSong: () => handleOpenDeleteConfirm(song),
  });

  const handleOpenDeleteConfirm = (song: any) => {
    setDeleteConfirmModal({
      isOpen: true,
      song,
      deleting: false,
    });
  };

  const handleConfirmDeleteSong = async () => {
    const song = deleteConfirmModal.song;
    if (!song || deleteConfirmModal.deleting) return;

    setDeleteConfirmModal(prev => ({ ...prev, deleting: true }));

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

      setSongs(prev => prev.filter(s => s.id !== song.id));
      setSearchResults(prev => prev.filter(item => !(item.type === 'song' && item.id === song.id)));
      setSelectedArtist(prev => prev?.songs ? { ...prev, songs: prev.songs.filter((s: any) => s.id !== song.id) } : prev);
      setSelectedAlbum(prev => prev?.songs ? { ...prev, songs: prev.songs.filter((s: any) => s.id !== song.id) } : prev);
      setStats(prev => ({ ...prev, songs: Math.max(0, prev.songs - 1) }));
      setQueuedSongId(prev => (prev === song.id ? null : prev));
      setDeleteConfirmModal({ isOpen: false, song: null, deleting: false });
    } catch (error: any) {
      alert(error.message || 'Failed to delete song');
      setDeleteConfirmModal(prev => ({ ...prev, deleting: false }));
    }
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
  }, [tab, songsSort]);

  const loadAllData = async () => {
    setLoading(true);
    setError(null);
    setHasMoreSongs(false);
    setHasMoreArtists(false);
    setHasMoreAlbums(false);
    setLoadingMoreAlbums(false);
    loadingMoreAlbumsRef.current = false;
    albumsRequestOffsetRef.current = 0;
    setLoadingMoreArtists(false);
    loadingMoreArtistsRef.current = false;
    artistsRequestOffsetRef.current = 0;
    setLoadingMoreSongs(false);
    loadingMoreSongsRef.current = false;
    songsRequestOffsetRef.current = 0;

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
          tab === 'artists' ? `/api/artists?limit=${ARTISTS_PAGE_SIZE}&offset=0` : 
          tab === 'albums' ? `/api/albums?limit=${ALBUMS_PAGE_SIZE}&offset=0` : 
          tab === 'songs' ? `/api/songs?limit=${SONGS_PAGE_SIZE}&offset=0&sort=${songsSort}` : 
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

        if (tab === 'artists') {
          const firstPage = Array.isArray(data) ? data : (Array.isArray(data?.artists) ? data.artists : []);
          setArtists(firstPage);
          setHasMoreArtists(Boolean(data?.hasMore));
          artistsRequestOffsetRef.current = firstPage.length;
        }
        else if (tab === 'albums') {
          const firstPage = Array.isArray(data) ? data : (Array.isArray(data?.albums) ? data.albums : []);
          setAlbums(firstPage);
          setHasMoreAlbums(Boolean(data?.hasMore));
          albumsRequestOffsetRef.current = firstPage.length;
        }
        else if (tab === 'songs') {
          const firstPage = Array.isArray(data) ? data : (Array.isArray(data?.songs) ? data.songs : []);
          setSongs(firstPage);
          setHasMoreSongs(Boolean(data?.hasMore));
          songsRequestOffsetRef.current = firstPage.length;
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

  const loadMoreSongs = async () => {
    if (tab !== 'songs' || !hasMoreSongs || loadingMoreSongsRef.current || loading || search.trim()) return;

    loadingMoreSongsRef.current = true;
    setLoadingMoreSongs(true);
    const offset = songsRequestOffsetRef.current;

    try {
      const response = await fetch(`/api/songs?limit=${SONGS_PAGE_SIZE}&offset=${offset}&sort=${songsSort}`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Failed to load more songs (${response.status})`);
      const payload = await response.json();
      const nextPage = Array.isArray(payload) ? payload : (Array.isArray(payload?.songs) ? payload.songs : []);

      setSongs(previous => {
        const knownIds = new Set(previous.map(song => song.id));
        return [...previous, ...nextPage.filter((song: any) => !knownIds.has(song.id))];
      });
      songsRequestOffsetRef.current = offset + nextPage.length;
      setHasMoreSongs(Boolean(payload?.hasMore));
    } catch (loadError) {
      console.error('Failed to load more songs:', loadError);
    } finally {
      loadingMoreSongsRef.current = false;
      setLoadingMoreSongs(false);
    }
  };

  useEffect(() => {
    if (tab !== 'songs' || !hasMoreSongs || loading || search.trim()) return;
    const target = songsLoadMoreRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMoreSongs();
    }, { rootMargin: '500px 0px' });

    observer.observe(target);
    return () => observer.disconnect();
  }, [tab, hasMoreSongs, loading, loadingMoreSongs, search, songs.length]);


  const loadMoreArtists = async () => {
    if (tab !== 'artists' || !hasMoreArtists || loadingMoreArtistsRef.current || loading) return;
    loadingMoreArtistsRef.current = true;
    setLoadingMoreArtists(true);
    const offset = artistsRequestOffsetRef.current;
    try {
      const response = await fetch(`/api/artists?limit=${ARTISTS_PAGE_SIZE}&offset=${offset}`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Failed to load more artists (${response.status})`);
      const payload = await response.json();
      const nextPage = Array.isArray(payload) ? payload : (Array.isArray(payload?.artists) ? payload.artists : []);
      setArtists(previous => {
        const knownIds = new Set(previous.map(artist => artist.id));
        return [...previous, ...nextPage.filter((artist: any) => !knownIds.has(artist.id))];
      });
      artistsRequestOffsetRef.current = offset + nextPage.length;
      setHasMoreArtists(Boolean(payload?.hasMore));
    } catch (loadError) {
      console.error('Failed to load more artists:', loadError);
    } finally {
      loadingMoreArtistsRef.current = false;
      setLoadingMoreArtists(false);
    }
  };

  useEffect(() => {
    if (tab !== 'artists' || !hasMoreArtists || loading) return;
    const target = artistsLoadMoreRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMoreArtists();
    }, { rootMargin: '500px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [tab, hasMoreArtists, loading, loadingMoreArtists, artists.length]);


  const loadMoreAlbums = async () => {
    if (tab !== 'albums' || !hasMoreAlbums || loadingMoreAlbumsRef.current || loading) return;
    loadingMoreAlbumsRef.current = true;
    setLoadingMoreAlbums(true);
    const offset = albumsRequestOffsetRef.current;
    try {
      const response = await fetch(`/api/albums?limit=${ALBUMS_PAGE_SIZE}&offset=${offset}`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Failed to load more albums (${response.status})`);
      const payload = await response.json();
      const nextPage = Array.isArray(payload) ? payload : (Array.isArray(payload?.albums) ? payload.albums : []);
      setAlbums(previous => {
        const knownIds = new Set(previous.map(album => album.id));
        return [...previous, ...nextPage.filter((album: any) => !knownIds.has(album.id))];
      });
      albumsRequestOffsetRef.current = offset + nextPage.length;
      setHasMoreAlbums(Boolean(payload?.hasMore));
    } catch (loadError) {
      console.error('Failed to load more albums:', loadError);
    } finally {
      loadingMoreAlbumsRef.current = false;
      setLoadingMoreAlbums(false);
    }
  };

  useEffect(() => {
    if (tab !== 'albums' || !hasMoreAlbums || loading) return;
    const target = albumsLoadMoreRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMoreAlbums();
    }, { rootMargin: '500px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [tab, hasMoreAlbums, loading, loadingMoreAlbums, albums.length]);

  const jumpKey = (name: string) => {
    const first = name.trim().charAt(0).toLocaleUpperCase();
    return /^[A-Z]$/.test(first) ? first : '#';
  };
  const jumpItems = tab === 'artists' ? artists : albums;
  const jumpGroups = new Set(jumpItems.map(item => jumpKey(tab === 'artists' ? item.name : item.title)));
  const jumpToLetter = async (letter: string) => {
    setActiveJumpLetter(letter);
    const getKey = (item: any) => jumpKey(tab === 'artists' ? item.name : item.title);
    let availableItems = tab === 'artists' ? artists : albums;
    let moreAvailable = tab === 'artists' ? hasMoreArtists : hasMoreAlbums;
    while (moreAvailable && !availableItems.some(item => getKey(item) >= letter)) {
      const offset = tab === 'artists' ? artistsRequestOffsetRef.current : albumsRequestOffsetRef.current;
      const endpoint = tab === 'artists'
        ? `/api/artists?limit=${ARTISTS_PAGE_SIZE}&offset=${offset}`
        : `/api/albums?limit=${ALBUMS_PAGE_SIZE}&offset=${offset}`;
      try {
        const response = await fetch(endpoint, { credentials: 'same-origin' });
        if (!response.ok) break;
        const payload = await response.json();
        const page = Array.isArray(payload) ? payload : (Array.isArray(payload?.artists) ? payload.artists : Array.isArray(payload?.albums) ? payload.albums : []);
        if (!page.length) break;
        if (tab === 'artists') {
          setArtists(previous => {
            const ids = new Set(previous.map(item => item.id));
            return [...previous, ...page.filter((item: any) => !ids.has(item.id))];
          });
          artistsRequestOffsetRef.current = offset + page.length;
          moreAvailable = Boolean(payload?.hasMore);
          setHasMoreArtists(moreAvailable);
        } else {
          setAlbums(previous => {
            const ids = new Set(previous.map(item => item.id));
            return [...previous, ...page.filter((item: any) => !ids.has(item.id))];
          });
          albumsRequestOffsetRef.current = offset + page.length;
          moreAvailable = Boolean(payload?.hasMore);
          setHasMoreAlbums(moreAvailable);
        }
        availableItems = [...availableItems, ...page];
      } catch (error) {
        console.error('Failed to jump to catalogue letter:', error);
        break;
      }
    }
    const item = availableItems.find(entry => getKey(entry) >= letter);
    if (item) requestAnimationFrame(() => document.getElementById(`library-card-${tab}-${item.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
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
    fetch(`/api/songs?limit=${SONGS_PAGE_SIZE}&offset=0`)
      .then(res => res.json())
      .then(data => {
        const firstPage = Array.isArray(data) ? data : (Array.isArray(data?.songs) ? data.songs : []);
        setSongs(firstPage);
        setHasMoreSongs(Boolean(data?.hasMore));
        songsRequestOffsetRef.current = firstPage.length;
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
      setArtistArtworkErrors(prev => ({ ...prev, [artistId]: false }));
      setSelectedArtist(data);
      setSelectedAlbum(null);
      setSelectedPlaylist(null);
    } catch (e: any) {
      console.error(e);
      alert(e.message || 'Could not load artist details');
    }
  };

  const handleRefreshArtwork = async (artistId: number) => {
    if (refreshingArtistId === artistId) return;
    setRefreshingArtistId(artistId);
    try {
      const res = await fetch(`/api/artists/${artistId}/refresh-artwork`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        const nextVersion = typeof data.version === 'number' ? data.version : Date.now();
        setArtistArtworkErrors(prev => ({ ...prev, [artistId]: false }));
        setArtistArtworkVersions(prev => ({ ...prev, [artistId]: nextVersion }));
        if (selectedArtist && selectedArtist.id === artistId) {
          setSelectedArtist((prev: any) => prev ? { ...prev, hasArtwork: !!data.hasArtwork } : null);
        }
        setArtists(prev => prev.map(a => a.id === artistId ? { ...a, hasArtwork: !!data.hasArtwork } : a));
      } else if (res.status === 404) {
        setArtistArtworkErrors(prev => ({ ...prev, [artistId]: true }));
        if (selectedArtist && selectedArtist.id === artistId) {
          setSelectedArtist((prev: any) => prev ? { ...prev, hasArtwork: false } : null);
        }
        setArtists(prev => prev.map(a => a.id === artistId ? { ...a, hasArtwork: false } : a));
      } else {
        console.error('Failed to refresh artist artwork:', data?.error || res.statusText);
      }
    } catch (err) {
      console.error('Error refreshing artist artwork:', err);
    } finally {
      setRefreshingArtistId(null);
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

      const playableSongs = (targetSongs || []).filter((s: any) => !s.isUnavailable && s.id > 0);
      if (playableSongs.length === 0) {
        alert("This playlist has no available songs to play.");
        setPlayingAll(false);
        return;
      }

      // Add each available song sequentially into room queue
      let count = 0;
      for (const s of playableSongs) {
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
          onAddToJukeboxQueue={handleQueueInJukebox}
          favoriteIds={favoriteIds}
          onToggleFavorite={handleToggleFavorite}
          onOpenAddToPlaylist={handleOpenAddToPlaylist}
          onReplaceAudio={handleOpenReplaceSource}
          onReplaceInstrumental={handleOpenReplaceInstrumental}
          onDeleteSong={handleDeleteSong}
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
            {selectedArtist.hasArtwork && !artistArtworkErrors[selectedArtist.id] && (
              <img
                key={`${selectedArtist.id}-${artistArtworkVersions[selectedArtist.id] || 0}`}
                src={`/api/artists/${selectedArtist.id}/artwork${artistArtworkVersions[selectedArtist.id] ? `?v=${artistArtworkVersions[selectedArtist.id]}` : ''}`}
                alt={selectedArtist.name}
                className="relative z-10 h-full w-full object-cover yk-artwork-image"
                onError={() => {
                  setArtistArtworkErrors(prev => ({ ...prev, [selectedArtist.id]: true }));
                }}
              />
            )}
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
              <button
                type="button"
                onClick={() => handleRefreshArtwork(selectedArtist.id)}
                disabled={refreshingArtistId === selectedArtist.id}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-2 border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 cursor-pointer"
                title="Refresh local artist artwork"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshingArtistId === selectedArtist.id ? 'animate-spin text-[#F472B6]' : 'text-zinc-300'}`} />
                <span>{refreshingArtistId === selectedArtist.id ? 'Refreshing…' : 'Refresh Artwork'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Albums by Artist */}
        {selectedArtist.albums?.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-bold text-white tracking-tight">Discography & Albums</h2>
              <div className="inline-flex rounded-lg border border-white/10 bg-[#141622] p-1">
                <button type="button" onClick={() => setEntityCardLayout('grid')} aria-pressed={entityCardLayout === 'grid'} className={`rounded-md px-3 py-1.5 text-xs ${entityCardLayout === 'grid' ? 'bg-[#F472B6] text-white' : 'text-zinc-400 hover:text-white'}`}>Grid</button>
                <button type="button" onClick={() => setEntityCardLayout('list')} aria-pressed={entityCardLayout === 'list'} className={`rounded-md px-3 py-1.5 text-xs ${entityCardLayout === 'list' ? 'bg-[#F472B6] text-white' : 'text-zinc-400 hover:text-white'}`}>List</button>
              </div>
            </div>
            <div className={entityCardLayout === 'grid' ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4' : 'flex flex-col gap-2'}>
              {selectedArtist.albums.map((album: any) => (
                <JukeboxAlbumCard key={album.id} album={album} onOpen={() => openAlbum(album.id)} layout={entityCardLayout} />
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
                <tr><th colSpan={4} className="px-5 py-3.5 text-left">Songs</th></tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {selectedArtist.songs?.map((song: any, idx: number) => {
                  const isCurrent = jukeboxCurrentSong?.id === song.id;
                  const isThisPlaying = isCurrent && jukeboxIsPlaying;
                  return (
                    <tr key={song.id} className="group">
                      <td colSpan={4} className="px-3">
                        <JukeboxSongCard
                          song={song}
                          {...getSongCardActions(song)}
                          isCurrent={isCurrent}
                          isPlaying={isThisPlaying}
                          onPlay={() => handlePlayInJukebox(song, selectedArtist.songs, idx)}
                          onOpenLyrics={(format) => setEditorState({ isOpen: true, songId: song.id, title: song.title, format })}
                          showAlbum={false}
                        >
                          <span className="hidden text-[10px] capitalize text-zinc-500 sm:inline">{song.variant}</span>
                        </JukeboxSongCard>
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
              <tr><th colSpan={4} className="px-5 py-3.5 text-left">Tracks</th></tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {selectedAlbum.songs?.map((song: any, idx: number) => {
                const isCurrent = jukeboxCurrentSong?.id === song.id;
                const isThisPlaying = isCurrent && jukeboxIsPlaying;
                return (
                  <tr key={song.id} className="group">
                    <td colSpan={4} className="px-3">
                      <JukeboxSongCard
                        song={{ ...song, artist: song.artist || selectedAlbum.artist, album: selectedAlbum.title }}
                        {...getSongCardActions(song)}
                        isCurrent={isCurrent}
                        isPlaying={isThisPlaying}
                        onPlay={() => handlePlayInJukebox(song, selectedAlbum.songs, idx)}
                        onOpenLyrics={(format) => setEditorState({ isOpen: true, songId: song.id, title: song.title, format })}
                        showAlbum={false}
                        leading={<span className="w-6 shrink-0 text-center font-mono text-xs text-zinc-500">{song.trackNumber || idx + 1}</span>}
                      >
                        <button type="button" onClick={() => handleQueueInJukebox(song)} className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white" title="Add to Jukebox queue" aria-label="Add to Jukebox queue"><Plus className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => handleDeleteSong(song)} className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400" title="Delete song from library"><Trash2 className="h-3.5 w-3.5" /></button>
                      </JukeboxSongCard>
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
                  item.type === 'song' ? (
                    <tr key={`song-${item.id}`}>
                      <td colSpan={4} className="px-3">
                        <JukeboxSongCard
                          song={item}
                          {...getSongCardActions(item)}
                          isCurrent={jukeboxCurrentSong?.id === item.id}
                          isPlaying={jukeboxCurrentSong?.id === item.id && jukeboxIsPlaying}
                          onPlay={() => handlePlayInJukebox(item)}
                          onOpenLyrics={(format) => setEditorState({ isOpen: true, songId: item.id, title: item.title, format })}
                          showAlbum={false}
                          showDuration={false}
                          artistContent={renderArtistLinks(item)}
                        >
                        </JukeboxSongCard>
                      </td>
                    </tr>
                  ) : (
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
                  )
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
                      {playlists.map(playlist => (
                        <div key={playlist.id} className="w-48 shrink-0 snap-start">
                          <JukeboxPlaylistCard playlist={playlist} onOpen={() => openPlaylist(playlist.id)} layout="grid" />
                        </div>
                      ))}
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
                    <div className="yk-horizontal-rail flex items-stretch gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-none">
                      {artists.map(artist => (
                        <div key={artist.id} className="w-28 shrink-0 snap-start">
                          <JukeboxArtistCard artist={artist} onOpen={() => openArtist(artist.id)} layout="grid" />
                        </div>
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
                    <div className="yk-horizontal-rail flex items-stretch gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-none">
                      {albums.map(album => (
                        <div key={album.id} className="w-36 shrink-0 snap-start">
                          <JukeboxAlbumCard album={album} onOpen={() => openAlbum(album.id)} layout="grid" />
                        </div>
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
                        <div key={song.id} className="w-[min(82vw,300px)] shrink-0 snap-start">
                          <JukeboxSongCard
                            song={song}
                          {...getSongCardActions(song)}
                            isCurrent={jukeboxCurrentSong?.id === song.id}
                            isPlaying={jukeboxCurrentSong?.id === song.id && jukeboxIsPlaying}
                            onPlay={() => handlePlayInJukebox(song, songs, idx)}
                            onOpenLyrics={(format) => setEditorState({ isOpen: true, songId: song.id, title: song.title, format })}
                            showAlbum={false}
                            showDuration={false}
                          />
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

                        return (
                          <JukeboxSongCard
                            key={song.id}
                            song={song}
                          {...getSongCardActions(song)}
                            isCurrent={isCurrent}
                            isPlaying={isThisPlaying}
                            onPlay={() => handlePlayInJukebox(song, songs, index)}
                            onOpenLyrics={(format) => setEditorState({ isOpen: true, songId: song.id, title: song.title, format })}
                            showAlbum={false}
                            showDuration={false}
                          >
                            
                          </JukeboxSongCard>
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

          {/* Artist and Album catalogues share their master cards across grid/list modes. */}
          {(tab === 'artists' || tab === 'albums') && (
            <section className="space-y-4">
              <div className="flex justify-end">
                <div className="inline-flex rounded-lg border border-white/10 bg-[#141622] p-1">
                  <button type="button" onClick={() => setEntityCardLayout('grid')} aria-pressed={entityCardLayout === 'grid'} className={`rounded-md px-3 py-1.5 text-xs ${entityCardLayout === 'grid' ? 'bg-[#F472B6] text-white' : 'text-zinc-400 hover:text-white'}`}>Grid</button>
                  <button type="button" onClick={() => setEntityCardLayout('list')} aria-pressed={entityCardLayout === 'list'} className={`rounded-md px-3 py-1.5 text-xs ${entityCardLayout === 'list' ? 'bg-[#F472B6] text-white' : 'text-zinc-400 hover:text-white'}`}>List</button>
                </div>
              </div>
              {tab === 'artists' && (
                <div className={entityCardLayout === 'grid' ? 'grid grid-cols-3 justify-center gap-3 pb-4 [@media(orientation:landscape)]:grid-cols-4 sm:grid-cols-[repeat(auto-fill,minmax(140px,180px))] sm:gap-4' : 'flex flex-col gap-2 pb-4'}>
                  {artists.map(artist => (
                    <div id={`library-card-artists-${artist.id}`} key={artist.id}>
                      <JukeboxArtistCard artist={artist} onOpen={() => openArtist(artist.id)} layout={entityCardLayout} artworkVersion={artistArtworkVersions[artist.id] || 0} artworkError={!!artistArtworkErrors[artist.id]} onArtworkError={() => setArtistArtworkErrors(prev => ({ ...prev, [artist.id]: true }))} />
                    </div>
                  ))}
                  {artists.length === 0 && !loading && <div className="col-span-full py-16 text-center text-zinc-500">No artists found. Run a library scan or configure a directory in Settings.</div>}
                </div>
              )}
              {tab === 'albums' && (
                <div className={entityCardLayout === 'grid' ? 'grid grid-cols-3 justify-center gap-3 pb-4 [@media(orientation:landscape)]:grid-cols-4 sm:grid-cols-[repeat(auto-fill,minmax(140px,180px))] sm:gap-4' : 'flex flex-col gap-2 pb-4'}>
                  {albums.map(album => (
                    <div id={`library-card-albums-${album.id}`} key={album.id}>
                      <JukeboxAlbumCard album={album} onOpen={() => openAlbum(album.id)} layout={entityCardLayout} />
                    </div>
                  ))}
                  {albums.length === 0 && !loading && <div className="col-span-full py-16 text-center text-zinc-500">No albums found in media library.</div>}
                </div>
              )}
            </section>
          )}
          {tab === 'artists' && hasMoreArtists && <div ref={artistsLoadMoreRef} className="flex min-h-16 items-center justify-center py-5 text-sm text-zinc-500" aria-live="polite">{loadingMoreArtists ? 'Loading more artists…' : 'Scroll for more artists'}</div>}
          {tab === 'artists' && !hasMoreArtists && artists.length > 0 && <div className="py-5 text-center text-xs text-zinc-600">All artists loaded</div>}
          {tab === 'albums' && hasMoreAlbums && <div ref={albumsLoadMoreRef} className="flex min-h-16 items-center justify-center py-5 text-sm text-zinc-500" aria-live="polite">{loadingMoreAlbums ? 'Loading more albums…' : 'Scroll for more albums'}</div>}
          {tab === 'albums' && !hasMoreAlbums && albums.length > 0 && <div className="py-5 text-center text-xs text-zinc-600">All albums loaded</div>}

          {(tab === 'artists' || tab === 'albums') && (
            <nav aria-label="Jump to artist or album letter" className="fixed right-1 top-[46%] z-30 flex max-h-[90vh] -translate-y-1/2 flex-col items-center overflow-y-auto rounded-full border border-white/10 bg-[#11121c]/90 px-1 py-1.5 shadow-lg backdrop-blur sm:right-3 sm:px-1.5 xl:right-[354px]">
              {['#', ...["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z"]].map(letter => (
                <button key={letter} type="button" onClick={() => jumpToLetter(letter)}
                  disabled={!jumpGroups.has(letter) && !(tab === 'artists' ? hasMoreArtists : hasMoreAlbums)}
                  className={`flex h-[clamp(14px,1.85vh,20px)] w-5 items-center justify-center rounded-full text-[10px] font-semibold transition-colors sm:w-6 sm:text-[11px] ${activeJumpLetter === letter ? 'bg-[#F472B6] text-[#17121b]' : jumpGroups.has(letter) ? 'text-zinc-300 hover:bg-white/10 hover:text-white' : 'cursor-default text-zinc-700'}`}
                  aria-label={`Jump to ${letter === '#' ? 'numbers and symbols' : letter}`}>{letter}</button>
              ))}
            </nav>
          )}

          {/* Songs List — clean, borderless styling matching the Jukebox rows */}
          {tab === 'songs' && (
            <div className="min-w-0">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">All Songs</h2>
                  <p className="mt-0.5 text-xs text-zinc-500">Sorted across the full catalogue before loading each page.</p>
                </div>
                <label className="flex items-center gap-2 text-xs text-zinc-400">
                  <span>Sort by</span>
                  <select
                    value={songsSort}
                    onChange={e => {
                      const nextSort = e.target.value as typeof songsSort;
                      window.localStorage.setItem('yimly-songs-sort', nextSort);
                      setSongsSort(nextSort);
                      document.querySelector('main')?.scrollTo({ top: 0, behavior: 'auto' });
                    }}
                    className="rounded-xl border border-white/10 bg-[#141622] px-3 py-2 text-sm text-white outline-none transition focus:border-[#F472B6]"
                    aria-label="Sort songs"
                  >
                    <option value="artist">Artist A–Z</option>
                    <option value="title">Title A–Z</option>
                    <option value="album">Album</option>
                    <option value="recent">Recently added</option>
                    <option value="oldest">Oldest added</option>
                    <option value="duration">Duration</option>
                    <option value="track">Track number</option>
                  </select>
                </label>
              </div>
              <div className="divide-y divide-white/[0.04]">
                {songs.map((song, idx) => {
                  const isCurrent = jukeboxCurrentSong?.id === song.id;
                  const isThisPlaying = isCurrent && jukeboxIsPlaying;

                  return (
                    <JukeboxSongCard
                      key={song.id}
                      song={song}
                          {...getSongCardActions(song)}
                      isCurrent={isCurrent}
                      isPlaying={isThisPlaying}
                      onPlay={() => handlePlayInJukebox(song, songs, idx)}
                      onOpenLyrics={(format) => setEditorState({ isOpen: true, songId: song.id, title: song.title, format })}
                      artistContent={renderArtistLinks(song)}
                    >
                      </JukeboxSongCard>
                  );
              })}
                {songs.length === 0 && (
                  <div className="py-12 text-center text-sm text-zinc-500">No songs found in library.</div>
                )}
              </div>
              {hasMoreSongs && !search.trim() && (
                <div ref={songsLoadMoreRef} className="flex min-h-16 items-center justify-center py-5 text-sm text-zinc-500" aria-live="polite">
                  {loadingMoreSongs ? 'Loading more songs…' : 'Scroll for more songs'}
                </div>
              )}
              {!hasMoreSongs && songs.length > 0 && (
                <div className="py-5 text-center text-xs text-zinc-600">All songs loaded</div>
              )}
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
              layout="grid"
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

      {/* Replace Audio Modal */}
      {replaceSourceModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div 
            className="w-full max-w-lg bg-[#141622] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">Replace Audio</h2>
                <p className="text-xs text-zinc-400 mt-0.5 truncate max-w-sm">
                  {replaceSourceModal.songTitle} {replaceSourceModal.songArtist ? `• ${replaceSourceModal.songArtist}` : ''}
                </p>
              </div>
              <button 
                type="button"
                onClick={() => setReplaceSourceModal(prev => ({ ...prev, isOpen: false, error: null, successMsg: null }))}
                className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-zinc-300 leading-relaxed">
                Provide the YouTube URL of the official recording. Yimly will download the replacement, regenerate the instrumental track, and update files safely while preserving all existing song metadata, playlist links, and favourites.
              </p>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  YouTube Recording URL
                </label>
                <input
                  type="text"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={replaceSourceModal.youtubeUrl}
                  onChange={(e) => setReplaceSourceModal(prev => ({ ...prev, youtubeUrl: e.target.value, error: null }))}
                  className="w-full px-3.5 py-2.5 bg-[#0D0E15] border border-white/10 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#F472B6] focus:ring-1 focus:ring-[#F472B6] transition-all"
                  disabled={replaceSourceModal.loading}
                  autoFocus
                />
              </div>

              {replaceSourceModal.error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2 text-xs text-red-400">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{replaceSourceModal.error}</span>
                </div>
              )}

              {replaceSourceModal.successMsg && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-start gap-2 text-xs text-emerald-400">
                  <Check className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{replaceSourceModal.successMsg}</span>
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setReplaceSourceModal(prev => ({ ...prev, isOpen: false, error: null, successMsg: null }))}
                  disabled={replaceSourceModal.loading}
                  className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-white rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExecuteReplaceSource}
                  disabled={replaceSourceModal.loading || !replaceSourceModal.youtubeUrl.trim()}
                  className="px-4 py-2 bg-[#F472B6] hover:bg-[#DB2777] disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-[#F472B6]/25 cursor-pointer"
                >
                  {replaceSourceModal.loading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Replacing Audio…</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Replace Audio</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Replace Instrumental Modal */}
      {replaceInstrumentalModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div 
            className="w-full max-w-lg bg-[#141622] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">Replace Instrumental</h2>
                <p className="text-xs text-zinc-400 mt-0.5 truncate max-w-sm">
                  {replaceInstrumentalModal.songTitle} {replaceInstrumentalModal.songArtist ? `• ${replaceInstrumentalModal.songArtist}` : ''}
                </p>
              </div>
              <button 
                type="button"
                onClick={() => setReplaceInstrumentalModal(prev => ({ ...prev, isOpen: false, error: null, successMsg: null }))}
                className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-zinc-300 leading-relaxed">
                This will regenerate the instrumental track from the existing original audio file using vocal separation. The original audio, song metadata, lyrics, and playlists will remain completely unchanged.
              </p>

              {replaceInstrumentalModal.error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2 text-xs text-red-400">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{replaceInstrumentalModal.error}</span>
                </div>
              )}

              {replaceInstrumentalModal.successMsg && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-start gap-2 text-xs text-emerald-400">
                  <Check className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{replaceInstrumentalModal.successMsg}</span>
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setReplaceInstrumentalModal(prev => ({ ...prev, isOpen: false, error: null, successMsg: null }))}
                  disabled={replaceInstrumentalModal.loading}
                  className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-white rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExecuteReplaceInstrumental}
                  disabled={replaceInstrumentalModal.loading}
                  className="px-4 py-2 bg-[#F472B6] hover:bg-[#DB2777] disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-[#F472B6]/25 cursor-pointer"
                >
                  {replaceInstrumentalModal.loading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Regenerating…</span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-3.5 h-3.5" />
                      <span>Regenerate Instrumental</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add To Playlist Modal */}
      {addToPlaylistModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div 
            className="w-full max-w-md bg-[#141622] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">Add to Playlist</h2>
                <p className="text-xs text-zinc-400 mt-0.5 truncate max-w-xs">
                  {addToPlaylistModal.song?.title}
                </p>
              </div>
              <button 
                type="button"
                onClick={() => setAddToPlaylistModal({ isOpen: false, song: null, addingToId: null, successPlaylistId: null, error: null })}
                className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto divide-y divide-white/5 space-y-1">
              {addToPlaylistModal.error && (
                <div className="p-3 mb-2 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2 text-xs text-red-400">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{addToPlaylistModal.error}</span>
                </div>
              )}

              {playlists.length === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-400">
                  No playlists found. Create a playlist first in the Playlists tab.
                </div>
              ) : (
                playlists.map((pl) => {
                  const isAdding = addToPlaylistModal.addingToId === pl.id;
                  const isDone = addToPlaylistModal.successPlaylistId === pl.id;

                  return (
                    <button
                      key={pl.id}
                      type="button"
                      onClick={() => handleAddSongToSpecificPlaylist(pl.id)}
                      disabled={isAdding || isDone}
                      className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-colors text-left cursor-pointer group"
                    >
                      <div className="min-w-0 pr-3">
                        <p className="text-xs font-semibold text-white truncate group-hover:text-[#F472B6] transition-colors">{pl.name}</p>
                        <p className="text-[10px] text-zinc-400">{pl.songCount || 0} songs</p>
                      </div>
                      <div className="shrink-0">
                        {isDone ? (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                            <Check className="w-3.5 h-3.5" /> Added
                          </span>
                        ) : isAdding ? (
                          <Loader2 className="w-4 h-4 animate-spin text-[#F472B6]" />
                        ) : (
                          <Plus className="w-4 h-4 text-zinc-400 group-hover:text-white" />
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Song Confirmation Modal */}
      {deleteConfirmModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div 
            className="w-full max-w-sm bg-[#141622] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center mx-auto border border-red-500/20">
                <Trash2 className="w-6 h-6" />
              </div>
              <h2 className="text-base font-bold text-white tracking-tight">Delete Song?</h2>
              <p className="text-xs text-zinc-300">
                Are you sure you want to delete <span className="font-semibold text-white">"{deleteConfirmModal.song?.title}"</span>?
              </p>
              <p className="text-[11px] text-zinc-400">
                This will permanently remove the song audio, instrumental files, lyrics, and any playlist links. This action cannot be undone.
              </p>
            </div>

            <div className="px-6 py-4 bg-white/[0.02] border-t border-white/5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteConfirmModal({ isOpen: false, song: null, deleting: false })}
                disabled={deleteConfirmModal.deleting}
                className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-white rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteSong}
                disabled={deleteConfirmModal.deleting}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-red-600/20 cursor-pointer"
              >
                {deleteConfirmModal.deleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting…</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
