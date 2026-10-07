export interface Playlist {
  id: number;
  userId: number;
  name: string;
  description?: string | null;
  isPublic: boolean;
  coverPath?: string | null;
  createdAt: string | number | Date;
  updatedAt: string | number | Date;
  ownerName?: string | null;
  songCount?: number;
  songs?: PlaylistSongItem[];
  isOwner?: boolean;
  canEdit?: boolean;
  permission?: 'owner' | 'edit' | 'view' | 'admin' | 'none';
  coverImageUrl?: string | null;
}

export interface PlaylistSongItem {
  playlistSongId: number;
  position: number;
  addedAt: string | number | Date;
  id: number;
  title: string;
  artist: string;
  artists?: Array<{ id: number | null; name: string }>;
  album?: string;
  albumId?: number | null;
  duration?: number;
  variant?: string;
  hasArtwork?: boolean;
  hasLrc?: boolean;
  hasElrc?: boolean;
}

export interface PlaylistCollaborator {
  id: number;
  userId: number;
  username: string;
  permission: 'view' | 'edit';
  createdAt: string | number | Date;
}
