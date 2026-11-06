import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { ReplacementJobInfo } from '../components/jukebox/ReplacementBadge';

interface ReplacementContextType {
  activeJobs: ReplacementJobInfo[];
  recentJobs: Map<string, ReplacementJobInfo>;
  refresh: () => Promise<void>;
  getSongReplacements: (songId?: number) => {
    audioJob?: ReplacementJobInfo;
    instrumentalJob?: ReplacementJobInfo;
    jobs: ReplacementJobInfo[];
  };
}

const ReplacementContext = createContext<ReplacementContextType | undefined>(undefined);

const RETENTION_MS = 8000; // Keep completed/failed badges visible for 8 seconds

export const ReplacementProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeJobs, setActiveJobs] = useState<ReplacementJobInfo[]>([]);
  const [recentJobs, setRecentJobs] = useState<Map<string, { job: ReplacementJobInfo; expiry: number }>>(new Map());
  const isPollingRef = useRef(false);

  const fetchActiveJobs = useCallback(async () => {
    if (isPollingRef.current) return;
    isPollingRef.current = true;
    try {
      const res = await fetch('/api/songs/replace-status/active', {
        headers: {
          'Cache-Control': 'no-cache',
        },
      });
      if (res.ok) {
        const data = await res.json();
        const incomingJobs: ReplacementJobInfo[] = Array.isArray(data.jobs) ? data.jobs : [];
        setActiveJobs(incomingJobs);

        // Update recentJobs retention map
        setRecentJobs(prev => {
          const next = new Map(prev);
          const now = Date.now();

          // Remove expired jobs
          for (const [key, item] of next.entries()) {
            if (item.expiry <= now) {
              next.delete(key);
            }
          }

          // Add / update from incomingJobs
          for (const job of incomingJobs) {
            const key = `${job.type}_${job.songId}`;
            if (job.status === 'completed' || job.status === 'failed') {
              next.set(key, { job, expiry: now + RETENTION_MS });
            } else {
              // Active job: ensure it has fresh expiry
              next.set(key, { job, expiry: now + RETENTION_MS * 2 });
            }
          }

          return next;
        });
      }
    } catch {
      // Ignore polling errors
    } finally {
      isPollingRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchActiveJobs();

    // Determine poll interval: 1000ms if jobs active, 3000ms if idle
    const intervalTime = activeJobs.some(j => j.status !== 'completed' && j.status !== 'failed') ? 1000 : 3000;
    const interval = setInterval(() => {
      fetchActiveJobs();
    }, intervalTime);

    return () => clearInterval(interval);
  }, [fetchActiveJobs, activeJobs]);

  const getSongReplacements = useCallback((songId?: number) => {
    if (!songId) {
      return { audioJob: undefined, instrumentalJob: undefined, jobs: [] };
    }

    const audioKey = `replace_audio_${songId}`;
    const instKey = `replace_instrumental_${songId}`;

    const audioJob = recentJobs.get(audioKey)?.job;
    const instrumentalJob = recentJobs.get(instKey)?.job;

    const jobs: ReplacementJobInfo[] = [];
    if (audioJob) jobs.push(audioJob);
    if (instrumentalJob) jobs.push(instrumentalJob);

    return { audioJob, instrumentalJob, jobs };
  }, [recentJobs]);

  return (
    <ReplacementContext.Provider
      value={{
        activeJobs,
        recentJobs: new Map(Array.from(recentJobs.entries()).map(([k, v]) => [k, v.job])),
        refresh: fetchActiveJobs,
        getSongReplacements,
      }}
    >
      {children}
    </ReplacementContext.Provider>
  );
};

export function useSongReplacement(songId?: number) {
  const context = useContext(ReplacementContext);
  if (!context) {
    return {
      audioJob: undefined,
      instrumentalJob: undefined,
      jobs: [],
      refresh: async () => {},
    };
  }

  const { audioJob, instrumentalJob, jobs } = context.getSongReplacements(songId);

  return {
    audioJob,
    instrumentalJob,
    jobs,
    refresh: context.refresh,
  };
}

export function useReplacementQueue() {
  const context = useContext(ReplacementContext);
  if (!context) {
    return {
      activeJobs: [],
      refresh: async () => {},
    };
  }
  return {
    activeJobs: context.activeJobs,
    refresh: context.refresh,
  };
}
