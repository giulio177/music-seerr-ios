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

  const request = async (track: CatalogTrack) => {
    try {
      const job = await api<DownloadJob>('/api/download', { method: 'POST', body: { track } });
      setJobs((prev) => ({ ...prev, [track.id]: job }));
      toast(t('search.requested'));
    } catch (e) {
      toast(e instanceof ApiError && e.detail ? e.detail : t('search.requestFailed'));
    }
  };

  return { jobs, request };
}
