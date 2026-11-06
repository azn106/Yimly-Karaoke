import React from 'react';
import { Loader2, CheckCircle2, AlertCircle, Clock, Download, Split, Music, MicOff } from 'lucide-react';

export type ReplacementJobStatus = 'queued' | 'downloading' | 'separating' | 'finalising' | 'completed' | 'failed';

export interface ReplacementJobInfo {
  jobId: string;
  songId: number;
  type: 'replace_audio' | 'replace_instrumental';
  status: ReplacementJobStatus;
  progress: number;
  message: string;
  error?: string;
  startedAt: string | Date;
  updatedAt: string | Date;
}

interface ReplacementBadgeProps {
  job: ReplacementJobInfo;
  className?: string;
}

export const ReplacementBadge: React.FC<ReplacementBadgeProps> = ({ job, className = '' }) => {
  const isAudio = job.type === 'replace_audio';
  const typeLabel = isAudio ? 'Audio' : 'Instrumental';

  // Map status to exact required text:
  // - Queued
  // - Downloading
  // - Demucs separating
  // - Finalising
  // - Completed
  // - Failed
  let statusText = 'Queued';
  let Icon = Clock;
  let colorStyles = '';
  let spin = false;

  switch (job.status) {
    case 'queued':
      statusText = 'Queued';
      Icon = Clock;
      colorStyles = isAudio
        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
        : 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30';
      break;
    case 'downloading':
      statusText = 'Downloading';
      Icon = Download;
      colorStyles = 'bg-sky-500/15 text-sky-300 border-sky-500/30';
      spin = true;
      break;
    case 'separating':
      statusText = 'Demucs separating';
      Icon = Split;
      colorStyles = isAudio
        ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
        : 'bg-violet-500/15 text-violet-300 border-violet-500/30';
      spin = true;
      break;
    case 'finalising':
      statusText = 'Finalising';
      Icon = Loader2;
      colorStyles = 'bg-blue-500/15 text-blue-300 border-blue-500/30';
      spin = true;
      break;
    case 'completed':
      statusText = 'Completed';
      Icon = CheckCircle2;
      colorStyles = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
      break;
    case 'failed':
      statusText = 'Failed';
      Icon = AlertCircle;
      colorStyles = 'bg-rose-500/15 text-rose-300 border-rose-500/30';
      break;
  }

  const tooltip = `${typeLabel} Replacement: ${statusText}${job.message ? ` — ${job.message}` : ''}${job.error ? ` (${job.error})` : ''}`;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium tracking-tight shadow-sm transition-all select-none ${colorStyles} ${className}`}
      title={tooltip}
      aria-label={tooltip}
      data-replacement-job-id={job.jobId}
      data-replacement-type={job.type}
      data-replacement-status={job.status}
    >
      {isAudio ? (
        <Music className="h-2.5 w-2.5 shrink-0 opacity-80" />
      ) : (
        <MicOff className="h-2.5 w-2.5 shrink-0 opacity-80" />
      )}
      <span className="font-semibold uppercase tracking-wider text-[9px] opacity-75">
        {typeLabel}
      </span>
      <span className="text-zinc-400">·</span>
      <Icon className={`h-2.5 w-2.5 shrink-0 ${spin ? 'animate-spin' : ''}`} />
      <span>{statusText}</span>
      {job.progress > 0 && job.progress < 100 && job.status !== 'completed' && job.status !== 'failed' && (
        <span className="text-[9px] opacity-75 font-mono">({Math.round(job.progress)}%)</span>
      )}
    </span>
  );
};

export default ReplacementBadge;
