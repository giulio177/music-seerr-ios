import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';

type Query = Record<string, string | number | boolean | undefined | null>;
type Result<T> = { key: string | null; data: T | null; error: ApiError | null };

/** Loads a backend resource; `refresh` reloads it (pull to refresh). Pass `null` to skip. */
export function useApi<T>(path: string | null, query?: Query) {
  const queryKey = JSON.stringify(query ?? {});
  const key = path ? `${path}?${queryKey}` : null;
  const [result, setResult] = useState<Result<T>>({ key: null, data: null, error: null });
  const [refreshing, setRefreshing] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const fetchNow = useCallback(async (): Promise<Result<T>> => {
    try {
      const data = await api<T>(path!, { query: JSON.parse(queryKey) });
      return { key, data, error: null };
    } catch (e) {
      return { key, data: null, error: e instanceof ApiError ? e : new ApiError(500, String(e)) };
    }
  }, [path, queryKey, key]);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    fetchNow().then((next) => {
      if (!cancelled) setResult(next);
    });
    return () => {
      cancelled = true;
    };
  }, [key, fetchNow, attempt]);

  const current = result.key === key;
  return {
    data: current ? result.data : null,
    error: current ? result.error : null,
    loading: !!key && !current,
    refreshing,
    refresh: async () => {
      setRefreshing(true);
      const next = await fetchNow();
      setResult(next);
      setRefreshing(false);
    },
    reload: () => {
      setResult({ key: null, data: null, error: null });
      setAttempt((n) => n + 1);
    },
  };
}
