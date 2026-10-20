import React from 'react';

interface EqualizerIndicatorProps {
  isPlaying: boolean;
  className?: string;
}

export default function EqualizerIndicator({ isPlaying, className = '' }: EqualizerIndicatorProps) {
  return (
    <span
      className={`inline-flex items-end gap-[1.5px] h-3 w-4 shrink-0 pb-[1px] select-none ${
        isPlaying ? 'yk-eq-playing' : 'yk-eq-paused'
      } ${className}`}
      aria-label={isPlaying ? 'Currently playing' : 'Currently paused'}
      title={isPlaying ? 'Currently playing' : 'Currently paused'}
      role="status"
    >
      <span className="w-[2px] h-full bg-[#F472B6] rounded-full origin-bottom yk-eq-bar yk-eq-bar-1" />
      <span className="w-[2px] h-full bg-[#F472B6] rounded-full origin-bottom yk-eq-bar yk-eq-bar-2" />
      <span className="w-[2px] h-full bg-[#F472B6] rounded-full origin-bottom yk-eq-bar yk-eq-bar-3" />
      <span className="w-[2px] h-full bg-[#F472B6] rounded-full origin-bottom yk-eq-bar yk-eq-bar-4" />
      <span className="w-[2px] h-full bg-[#F472B6] rounded-full origin-bottom yk-eq-bar yk-eq-bar-5" />
    </span>
  );
}
