"use client";

import * as React from "react";

export const POLL_MS = 30_000;

type PollState<T> = {
  data: T | null;
  dataUrl: string | null; // the URL `data` came from — differs while a new view loads
  error: string | null;
  loading: boolean;
  updatedAt: number | null;
};

// Fetches `url` now and every POLL_MS while the tab is visible. Bump
// `refreshKey` to force a reload. Previous data is kept while the next
// request is in flight so views don't flash empty.
export function usePoll<T>(url: string | null, refreshKey = 0) {
  const [state, setState] = React.useState<PollState<T>>({
    data: null,
    dataUrl: null,
    error: null,
    loading: false,
    updatedAt: null,
  });

  React.useEffect(() => {
    if (!url) return;
    let ctrl: AbortController | null = null;

    const load = () => {
      if (document.visibilityState === "hidden") return;
      ctrl?.abort();
      ctrl = new AbortController();
      setState((s) => ({ ...s, loading: true }));
      fetch(url, { signal: ctrl.signal })
        .then(async (r) => {
          const json = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`);
          return json as T;
        })
        .then((data) =>
          setState({ data, dataUrl: url, error: null, loading: false, updatedAt: Date.now() }),
        )
        .catch((e: Error) => {
          if (e.name === "AbortError") return;
          setState((s) => ({ ...s, error: e.message, loading: false }));
        });
    };

    load();
    const id = setInterval(load, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      ctrl?.abort();
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, refreshKey]);

  return { ...state, stale: state.dataUrl !== url };
}

// Re-renders every `ms` so relative times ("12s ago") stay current.
export function useNow(ms = 1000) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
