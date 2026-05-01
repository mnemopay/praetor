/**
 * SSE wrapper. Consumes `/api/v1/missions/:id/events` (or `/activity/live`)
 * and reconnects on drop. The browser EventSource cannot set a bearer
 * header, so the access token is appended as `?token=` (the API accepts
 * this on its SSE routes only).
 */

export interface ActivityStreamOptions {
  apiBase: string;
  token: string;
  missionId?: string;
  onEvent: (e: unknown) => void;
  onError?: (err: Error) => void;
}

export interface ActivityStreamHandle {
  close: () => void;
}

export function openActivityStream(opts: ActivityStreamOptions): ActivityStreamHandle {
  let es: EventSource | null = null;
  let attempts = 0;
  let stopped = false;
  let backoff: ReturnType<typeof setTimeout> | null = null;

  function url(): string {
    const path = opts.missionId
      ? `/api/v1/missions/${encodeURIComponent(opts.missionId)}/events`
      : `/api/v1/activity/live`;
    return `${opts.apiBase}${path}?token=${encodeURIComponent(opts.token)}`;
  }

  function connect(): void {
    if (stopped) return;
    es = new EventSource(url());
    es.onmessage = (msg) => {
      attempts = 0;
      try { opts.onEvent(JSON.parse(msg.data)); } catch (err) {
        opts.onError?.(err as Error);
      }
    };
    es.onerror = () => {
      es?.close();
      es = null;
      if (stopped) return;
      attempts += 1;
      const delay = Math.min(30_000, 500 * 2 ** Math.min(attempts, 6));
      backoff = setTimeout(connect, delay);
    };
  }

  connect();

  return {
    close() {
      stopped = true;
      if (backoff) clearTimeout(backoff);
      es?.close();
      es = null;
    },
  };
}
