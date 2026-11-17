import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

/** Carga datos del API y devuelve [data, reload, error, loading]. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api.get<T>(path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, reload: load, error, loading };
}
