import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Search, Play, Music, Disc, Mic, RefreshCw, Calendar, FileText, ChevronRight, ArrowLeft, AlertCircle, ListMusic, Trash2 } from 'lucide-react';
import { Playlist, PlaylistSongItem } from '../types';
import CreatePlaylistModal from '../components/playlist/CreatePlaylistModal';
import EditPlaylistModal from '../components/playlist/EditPlaylistModal';
import LyricsEditorModal from '../components/LyricsEditorModal';
import SharePlaylistModal from '../components/playlist/SharePlaylistModal';
import AddSongsModal from '../components/playlist/AddSongsModal';
import PlaylistsGrid from '../components/playlist/PlaylistsGrid';
import PlaylistDetailView from '../components/playlist/PlaylistDetailView';
import LyricBadges from '../components/LyricBadges';

export default function Library() {
  const { user } = useOutletContext<{ user: any }>() || {};
  const [tab, setTab] = useState<'artists' | 'albums' | 'songs' | 'playlists'>('artists');
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
      const endpoint = 
        tab === 'artists' ? '/api/artists' : 
        tab === 'albums' ? '/api/albums' : 
        tab === 'songs' ? '/api/songs' : 
        '/api/playlists';

      const dataRes = await fetchWithRetry(endpoint, 2, 500);
      if (!dataRes.ok) {
        if (dataRes.status === 401) {
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
      else if (tab === 'songs') setSongs(Array.isArray(data) ? data : []);
      else if (tab === 'playlists') setPlaylists(Array.isArray(data) ? data : []);

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
                  className="text-zinc-300 hover:text-[#FF4FA3] hover:underline transition-colors text-left"
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
          <div className="w-28 h-28 rounded-full bg-gradient-to-br from-[#1E2033] to-[#12131F] flex items-center justify-center shrink-0 border border-white/10 shadow-lg shadow-[#FF4FA3]/10 overflow-hidden">
            {selectedArtist.hasArtwork ? (
              <img
                src={`/api/artists/${selectedArtist.id}/artwork`}
                alt={selectedArtist.name}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <Mic className="w-12 h-12 text-[#FF4FA3]" />
            )}
          </div>
          <div className="text-center sm:text-left">
            <span className="text-xs uppercase tracking-widest text-[#FF4FA3] font-bold">Artist</span>
            <h1 className="text-3xl md:text-4xl font-extrabold text-white mt-1 mb-2">{selectedArtist.name}</h1>
            <p className="text-sm text-zinc-400 font-medium">
              {selectedArtist.albums?.length || 0} Albums • {selectedArtist.songs?.length || 0} Songs
            </p>
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
                  className="bg-[#141622] hover:bg-[#1A1C2C] p-4 rounded-2xl border border-white/5 hover:border-[#FF4FA3]/30 cursor-pointer transition-all group"
                >
                  <div className="w-full aspect-square bg-[#1C1E2D] rounded-xl mb-3 flex items-center justify-center relative overflow-hidden group-hover:border-[#FF4FA3]/20 border border-white/5">
                    {album.hasArtwork ? (
                      <img
                        src={`/api/albums/${album.id}/artwork`}
                        alt={album.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <Disc className="w-10 h-10 text-zinc-600 group-hover:text-[#FF4FA3] transition-colors" />
                    )}
                  </div>
                  <h3 className="font-semibold text-sm text-white truncate group-hover:text-[#FF4FA3] transition-colors">{album.title}</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">{album.year || 'Album'}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Songs by Artist */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-white tracking-tight">Songs</h2>
          <div className="bg-[#141622] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#0E0F17] text-zinc-400 border-b border-white/5 text-xs font-semibold uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3.5">Title</th>
                  <th className="px-5 py-3.5">Duration</th>
                  <th className="px-5 py-3.5">Variant</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {selectedArtist.songs?.map((song: any) => {
                  return (
                    <tr key={song.id} className="hover:bg-[#1A1C2C]/60 transition-colors group">
                      <td className="px-5 py-3.5 font-medium text-white flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0 overflow-hidden">
                          {song.hasArtwork ? (
                            <img
                              src={`/api/songs/${song.id}/artwork`}
                              alt={song.title}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <Music className="w-4 h-4 text-zinc-400 group-hover:text-[#FF4FA3] transition-colors" />
                          )}
                        </div>
                        <span className="truncate">{song.title}</span>
                        <LyricBadges
                          hasLrc={song.hasLrc}
                          hasElrc={song.hasElrc}
                          onOpenLyrics={(format) => setEditorState({ isOpen: true, songId: song.id, title: song.title, format })}
                        />
                      </td>
                      <td className="px-5 py-3.5 text-zinc-400 text-xs font-mono">{formatDuration(song.duration)}</td>
                      <td className="px-5 py-3.5 text-zinc-400 text-xs capitalize">{song.variant}</td>
                      <td className="px-5 py-3.5 text-right">
                        <button
                          onClick={() => handleDeleteSong(song)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-all bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white border border-red-500/20 hover:border-red-500"
                          title="Delete song from library"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete</span>
                        </button>
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
          <div className="w-32 h-32 rounded-2xl bg-gradient-to-br from-[#1E2033] to-[#12131F] flex items-center justify-center shrink-0 border border-white/10 shadow-lg shadow-[#FF4FA3]/10 overflow-hidden">
            {selectedAlbum.hasArtwork ? (
              <img
                src={`/api/albums/${selectedAlbum.id}/artwork`}
                alt={selectedAlbum.title}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <Disc className="w-16 h-16 text-[#FF4FA3]" />
            )}
          </div>
          <div className="text-center sm:text-left">
            <span className="text-xs uppercase tracking-widest text-[#FF4FA3] font-bold">Album</span>
            <h1 className="text-3xl md:text-4xl font-extrabold text-white mt-1 mb-1">{selectedAlbum.title}</h1>
            <p className="text-zinc-300 font-medium text-base mb-1">{selectedAlbum.artist}</p>
            <p className="text-xs text-zinc-400">
              {selectedAlbum.year || 'Unknown Year'} • {selectedAlbum.songs?.length || 0} Tracks
            </p>
          </div>
        </div>

        <div className="bg-[#141622] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#0E0F17] text-zinc-400 border-b border-white/5 text-xs font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3.5 w-16">#</th>
                <th className="px-5 py-3.5">Title</th>
                <th className="px-5 py-3.5">Duration</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {selectedAlbum.songs?.map((song: any, idx: number) => {
                return (
                  <tr key={song.id} className="hover:bg-[#1A1C2C]/60 transition-colors group">
                    <td className="px-5 py-3.5 text-zinc-500 font-mono text-xs">{song.trackNumber || idx + 1}</td>
                    <td className="px-5 py-3.5 font-medium text-white flex items-center gap-3">
                      <span>{song.title}</span>
                      <LyricBadges
                        hasLrc={song.hasLrc}
                        hasElrc={song.hasElrc}
                        onOpenLyrics={(format) => setEditorState({ isOpen: true, songId: song.id, title: song.title, format })}
                      />
                    </td>
                    <td className="px-5 py-3.5 text-zinc-400 font-mono text-xs">{formatDuration(song.duration)}</td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => handleDeleteSong(song)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-all bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white border border-red-500/20 hover:border-red-500"
                        title="Delete song from library"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
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
    <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-8">
      {/* Header & Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-white tracking-tight">Karaoke Media Library</h1>
          <p className="text-sm text-zinc-400 mt-1">
            <span className="text-[#FF4FA3] font-semibold">{stats.artists}</span> Artists • <span className="text-[#FF4FA3] font-semibold">{stats.albums}</span> Albums • <span className="text-[#FF4FA3] font-semibold">{stats.songs}</span> Songs • <span className="text-[#FF4FA3] font-semibold">{stats.playlists || playlists.length}</span> Playlists
          </p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-80">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input 
              type="text" 
              placeholder="Search artists, albums, or songs..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-[#141622] border border-white/10 rounded-full text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-[#FF4FA3] focus:ring-1 focus:ring-[#FF4FA3] transition-all"
            />
          </div>
          {user?.role === 'administrator' && (
            <button 
              onClick={triggerScan}
              disabled={scanning}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#1C1E2D] hover:bg-[#25283C] text-white rounded-full text-xs font-semibold border border-white/10 transition-colors disabled:opacity-50 shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin text-[#FF4FA3]' : ''}`} />
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
          <RefreshCw className="w-8 h-8 text-[#FF4FA3] animate-spin mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">Loading media catalog...</p>
        </div>
      )}

      {/* Search results view if searching */}
      {search.trim() && !loading && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-white">Search Results for "{search}"</h2>
          <div className="bg-[#141622] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#0E0F17] text-zinc-400 border-b border-white/5 text-xs font-semibold uppercase tracking-wider">
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
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[#FF4FA3]/15 text-[#FF4FA3] border border-[#FF4FA3]/25">
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
                            className="w-full h-full object-cover"
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
                      <span className="truncate">{item.title || item.name}</span>
                      {item.type === 'song' && (
                        <LyricBadges
                          hasLrc={item.hasLrc}
                          hasElrc={item.hasElrc}
                          onOpenLyrics={(format) => setEditorState({ isOpen: true, songId: item.id, title: item.title, format })}
                        />
                      )}
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
                        <button
                          onClick={() => handleDeleteSong(item)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-all bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white border border-red-500/20 hover:border-red-500"
                          title="Delete song from library"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete</span>
                        </button>
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

      {/* Tabs */}
      <div className="flex border-b border-white/10 gap-8 overflow-x-auto">
        <button 
          onClick={() => setTab('artists')}
          className={`pb-3 font-semibold text-sm border-b-2 transition-all shrink-0 ${tab === 'artists' ? 'border-[#FF4FA3] text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
        >
          Artists ({stats.artists})
        </button>
        <button 
          onClick={() => setTab('albums')}
          className={`pb-3 font-semibold text-sm border-b-2 transition-all shrink-0 ${tab === 'albums' ? 'border-[#FF4FA3] text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
        >
          Albums ({stats.albums})
        </button>
        <button 
          onClick={() => setTab('songs')}
          className={`pb-3 font-semibold text-sm border-b-2 transition-all shrink-0 ${tab === 'songs' ? 'border-[#FF4FA3] text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
        >
          Songs ({stats.songs})
        </button>
        <button 
          onClick={() => setTab('playlists')}
          className={`pb-3 font-semibold text-sm border-b-2 transition-all shrink-0 ${tab === 'playlists' ? 'border-[#FF4FA3] text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
        >
          Playlists ({stats.playlists || playlists.length})
        </button>
      </div>

      {!loading && !error && (
        <>
          {/* Artists Grid */}
          {tab === 'artists' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
              {artists.map(artist => (
                <div 
                  key={artist.id}
                  onClick={() => openArtist(artist.id)}
                  className="bg-[#141622] hover:bg-[#1A1C2C] p-5 rounded-2xl border border-white/5 hover:border-[#FF4FA3]/30 cursor-pointer transition-all group flex flex-col items-center text-center shadow-lg"
                >
                  <div className="w-24 h-24 rounded-full bg-[#1C1E2D] flex items-center justify-center mb-4 border border-white/10 group-hover:border-[#FF4FA3]/40 transition-colors shadow-inner overflow-hidden">
                    {artist.hasArtwork ? (
                      <img
                        src={`/api/artists/${artist.id}/artwork`}
                        alt={artist.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <Mic className="w-10 h-10 text-zinc-500 group-hover:text-[#FF4FA3] transition-colors" />
                    )}
                  </div>
                  <h3 className="font-semibold text-sm text-white truncate w-full group-hover:text-[#FF4FA3] transition-colors">{artist.name}</h3>
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
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
              {albums.map(album => (
                <div 
                  key={album.id}
                  onClick={() => openAlbum(album.id)}
                  className="bg-[#141622] hover:bg-[#1A1C2C] p-4 rounded-2xl border border-white/5 hover:border-[#FF4FA3]/30 cursor-pointer transition-all group shadow-lg"
                >
                  <div className="w-full aspect-square bg-[#1C1E2D] rounded-xl mb-3 flex items-center justify-center border border-white/5 group-hover:border-[#FF4FA3]/40 transition-colors shadow-inner overflow-hidden">
                    {album.hasArtwork ? (
                      <img
                        src={`/api/albums/${album.id}/artwork`}
                        alt={album.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <Disc className="w-12 h-12 text-zinc-500 group-hover:text-[#FF4FA3] transition-colors" />
                    )}
                  </div>
                  <h3 className="font-semibold text-sm text-white truncate group-hover:text-[#FF4FA3] transition-colors">{album.title}</h3>
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

          {/* Songs Table */}
          {tab === 'songs' && (
            <div className="bg-[#141622] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#0E0F17] text-zinc-400 border-b border-white/5 text-xs font-semibold uppercase tracking-wider">
                  <tr>
                    <th className="px-5 py-3.5">Title</th>
                    <th className="px-5 py-3.5">Artist</th>
                    <th className="px-5 py-3.5">Album</th>
                    <th className="px-5 py-3.5">Duration</th>
                    <th className="px-5 py-3.5">Variant</th>
                    <th className="px-5 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {songs.map((song) => {
                    return (
                      <tr key={song.id} className="hover:bg-[#1A1C2C]/60 transition-colors group">
                        <td className="px-5 py-3.5 font-medium text-white flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0 overflow-hidden">
                            {song.hasArtwork ? (
                              <img
                                src={`/api/songs/${song.id}/artwork`}
                                alt={song.title}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  (e.target as HTMLElement).style.display = 'none';
                                }}
                              />
                            ) : (
                              <Music className="w-4 h-4 text-zinc-400 group-hover:text-[#FF4FA3] transition-colors" />
                            )}
                          </div>
                          <span className="truncate" title={song.title}>{song.title}</span>
                          <LyricBadges
                            hasLrc={song.hasLrc}
                            hasElrc={song.hasElrc}
                            onOpenLyrics={(format) => setEditorState({ isOpen: true, songId: song.id, title: song.title, format })}
                          />
                        </td>
                        <td className="px-5 py-3.5 text-zinc-300 text-xs truncate max-w-xs" title={song.artist}>
                          {renderArtistLinks(song)}
                        </td>
                        <td className="px-5 py-3.5 text-zinc-400 text-xs truncate max-w-xs" title={song.album}>{song.album || '—'}</td>
                        <td className="px-5 py-3.5 text-zinc-400 text-xs font-mono">{formatDuration(song.duration)}</td>
                        <td className="px-5 py-3.5 text-zinc-400 text-xs capitalize">{song.variant}</td>
                        <td className="px-5 py-3.5 text-right">
                          <button
                            onClick={() => handleDeleteSong(song)}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-all bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white border border-red-500/20 hover:border-red-500"
                            title="Delete song from library"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {songs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-12 text-center text-zinc-500">
                        No songs found in library.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
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
