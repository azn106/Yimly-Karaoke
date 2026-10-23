interface LyricBadgesProps {
  hasLrc?: boolean;
  hasElrc?: boolean;
  onOpenLyrics?: (format: any) => void;
}

export default function LyricBadges({ hasLrc, hasElrc, onOpenLyrics }: LyricBadgesProps) {
  if (!hasLrc && !hasElrc) return null;

  return (
    <div className="flex items-center gap-1.5" onClick={() => onOpenLyrics?.(hasElrc ? 'elrc' : 'lrc')}>
      {hasElrc && (
        <span className="px-1.5 py-0.5 bg-indigo-500/20 text-indigo-400 text-[10px] font-semibold rounded cursor-pointer hover:bg-indigo-500/30 transition-colors">
          eLRC
        </span>
      )}
      {hasLrc && !hasElrc && (
        <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 text-[10px] font-semibold rounded cursor-pointer hover:bg-emerald-500/30 transition-colors">
          LRC
        </span>
      )}
    </div>
  );
}
