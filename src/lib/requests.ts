import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '@/components/Toast';
import { api, ApiError } from './api';
import { useDownloadQueue } from './downloadQueue';
import type { RequestTarget } from './requestTarget';
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

  const send = async (track: CatalogTrack, playlist?: RequestTarget | null) => {
    const job = await api<DownloadJob>('/api/download', {
      method: 'POST',
      body: playlist ? { track, playlist_id: playlist.id, playlist_name: playlist.name } : { track },
    });
    setJobs((prev) => ({ ...prev, [track.id]: job }));
    useDownloadQueue.getState().refresh();
  };

  /** Requests one song; with `playlist` the server adds it there when its download finishes. */
  const request = async (track: CatalogTrack, playlist?: RequestTarget | null) => {
    try {
      await send(track, playlist);
      toast(playlist ? t('search.requestedTo', { name: playlist.name }) : t('search.requested'));
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
