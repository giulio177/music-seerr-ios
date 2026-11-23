import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@/components/Toast';
import { api, ApiError } from './api';
import type { CatalogTrack, DownloadJob } from './types';

const TERMINAL = new Set(['completed', 'failed', 'interrupted']);

/** Download requests for catalog songs, followed until they finish (keyed by catalog track ID). */
export function useRequests() {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<Record<string, DownloadJob>>({});

  const pendingKey = Object.values(jobs)
    .filter((j) => !TERMINAL.has(j.status))
    .map((j) => j.job_id)
    .join(',');
  useEffect(() => {
    if (!pendingKey) return;
    const timer = setInterval(async () => {
      for (const jobId of pendingKey.split(',')) {
        try {
          const job = await api<DownloadJob>(`/api/download/job/${jobId}`);
          setJobs((prev) => ({ ...prev, [job.track.id]: job }));
        } catch {
          // Keep the last known state.
        }
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [pendingKey]);

  const send = async (track: CatalogTrack) => {
    const job = await api<DownloadJob>('/api/download', { method: 'POST', body: { track } });
    setJobs((prev) => ({ ...prev, [track.id]: job }));
  };

  const request = async (track: CatalogTrack) => {
    try {
      await send(track);
      toast(t('search.requested'));
    } catch (e) {
      toast(e instanceof ApiError && e.detail ? e.detail : t('search.requestFailed'));
    }
  };

  /** Requests several songs (an album's missing tracks) with one confirmation. */
  const requestAll = async (tracks: CatalogTrack[]) => {
    let queued = 0;
    for (const track of tracks) {
      try {
        await send(track);
        queued += 1;
      } catch {
        // Counted below; the row keeps its Request button.
      }
    }
    toast(queued ? t('detail.requestedCount', { count: queued }) : t('search.requestFailed'));
  };

  return { jobs, request, requestAll };
}
