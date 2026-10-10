import React, { useRef, useEffect, useState, useCallback } from 'react';

interface BgmPlayerProps {
  currentSong: { id: number } | null;
  audioMode: 'instrumental' | 'original';
  enabled: boolean;
  crossfadeEnabled: boolean;
  crossfadeDuration: number;
  volume: number;
  isKaraokeActive: boolean;
  onEnded: () => void;
  onError: (e: any) => void;
}

export const BgmPlayer: React.FC<BgmPlayerProps> = ({
  currentSong,
  audioMode,
  enabled,
  crossfadeEnabled,
  crossfadeDuration,
  volume,
  isKaraokeActive,
  onEnded,
  onError,
}) => {
  const audioRef1 = useRef<HTMLAudioElement>(null);
  const audioRef2 = useRef<HTMLAudioElement>(null);
  const [activeRef, setActiveRef] = useState<1 | 2>(1);

  // Crossfade logic here
  // ...

  return (
    <>
      <audio
        ref={audioRef1}
        src={currentSong ? `/api/songs/${currentSong.id}/audio?type=${audioMode}` : undefined}
        preload="auto"
        className="hidden"
      />
      <audio
        ref={audioRef2}
        src={currentSong ? `/api/songs/${currentSong.id}/audio?type=${audioMode}` : undefined}
        preload="auto"
        className="hidden"
      />
    </>
  );
};
