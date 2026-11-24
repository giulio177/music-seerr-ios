import { create } from 'zustand';
import { api } from './api';
import type { DownloadJob } from './types';

/** Statuses still in progress (the server keeps them, with failed and interrupted ones, in the live queue). */
const RUNNING = new Set(['pending', 'downloading', 'tagging', 'moving', 'jellyfin_sync']);
const MAX_FINISHED = 8;

type QueueState = {
  /** This account's live queue: running, failed, and interrupted downloads (`/api/download/jobs`). */
  jobs: DownloadJob[];
  /** Downloads that left the queue while it was shown here, newest first (completed or cancelled). */
  finished: DownloadJob[];
  loaded: boolean;
  refresh: () => Promise<void>;
  cancel: (jobId: string) => Promise<void>;
  retry: (jobId: string) => Promise<void>;
  dismiss: (jobId: string) => Promise<void>;
};

export function isRunning(job: DownloadJob) {
  return RUNNING.has(job.status);
}

let refreshing: Promise<void> | null = null;

export const useDownloadQueue = create<QueueState>((set, get) => ({
  jobs: [],
  finished: [],
  loaded: false,

  refresh: () => {
    refreshing ??= (async () => {
      try {
        const jobs = await api<DownloadJob[]>('/api/download/jobs');
        const ids = new Set(jobs.map((job) => job.job_id));
        // A job that left the live queue finished: ask how (completed, cancelled) to show it as done.
        const gone = get().jobs.filter((job) => !ids.has(job.job_id) && isRunning(job));
        const done = await Promise.all(gone.map((job) => api<DownloadJob>(`/api/download/job/${job.job_id}`).catch(() => null)));
        const finished = [
          ...done.filter((job): job is DownloadJob => !!job && !isRunning(job)),
          ...get().finished.filter((job) => !ids.has(job.job_id)),
        ].slice(0, MAX_FINISHED);
        set({ jobs: [...jobs].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0)), finished, loaded: true });
      } catch {
        // Offline or a guest without a queue: keep what is shown.
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  },

  cancel: async (jobId) => {
    await api(`/api/download/job/${jobId}/cancel`, { method: 'POST' });
    await get().refresh();
  },

  retry: async (jobId) => {
    await api(`/api/download/job/${jobId}/retry`, { method: 'POST' });
    await get().refresh();
  },

  dismiss: async (jobId) => {
    await api(`/api/download/job/${jobId}/dismiss`, { method: 'POST' });
    set({ jobs: get().jobs.filter((job) => job.job_id !== jobId) });
    await get().refresh();
  },
}));
