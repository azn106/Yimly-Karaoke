import React from 'react';

interface LyricBadgesProps {
  hasLrc?: boolean;
  hasElrc?: boolean;
  onOpenLyrics?: (format: 'lrc' | 'elrc') => void;
  className?: string;
}

export default function LyricBadges({ hasLrc, hasElrc, onOpenLyrics, className = '' }: LyricBadgesProps) {
  const isLrcActive = Boolean(hasLrc);
  const isElrcActive = Boolean(hasElrc);

  return (
    <div className={`inline-flex items-center gap-1.5 shrink-0 ${className}`}>
      {/* LRC Badge: active pink accent if present; greyed-out subtle style if missing (always clickable to create/edit) */}
      <button
        type="button"
        id="badge-lrc"
        data-format="lrc"
        data-active={isLrcActive}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpenLyrics?.('lrc');
        }}
        className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider transition-colors cursor-pointer select-none inline-flex items-center justify-center ${
          isLrcActive
            ? 'bg-[#FF4FA3]/15 text-[#FF4FA3] border border-[#FF4FA3]/30 hover:bg-[#FF4FA3]/30'
            : 'bg-white/5 text-zinc-500 border border-white/10 hover:text-zinc-300 hover:bg-white/10 hover:border-white/20'
        }`}
        title={isLrcActive ? 'Edit LRC lyrics' : 'Add LRC lyrics (click to create)'}
      >
        LRC
      </button>

      {/* ELRC Badge: active blue accent if present; greyed-out subtle style if missing (always clickable to create/edit) */}
      <button
        type="button"
        id="badge-elrc"
        data-format="elrc"
        data-active={isElrcActive}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpenLyrics?.('elrc');
        }}
        className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider transition-colors cursor-pointer select-none inline-flex items-center justify-center ${
          isElrcActive
            ? 'bg-[#3B82F6]/15 text-[#3B82F6] border border-[#3B82F6]/30 hover:bg-[#3B82F6]/30'
            : 'bg-white/5 text-zinc-500 border border-white/10 hover:text-zinc-300 hover:bg-white/10 hover:border-white/20'
        }`}
        title={isElrcActive ? 'Edit ELRC lyrics' : 'Add ELRC lyrics (click to create)'}
      >
        ELRC
      </button>
    </div>
  );
}

