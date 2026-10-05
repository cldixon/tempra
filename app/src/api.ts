import { useCallback, useEffect, useState } from "react";

/** An error answer from the API: `{ error, code }` with its HTTP status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * A JSON call to the REST API as the signed-in person (the session cookie). A lapsed session
 * goes back through sign-in to the same page.
 */
export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers, credentials: "same-origin" });
  if (res.status === 401) {
    location.assign(`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    throw new ApiError(res.status, body?.code ?? "error", body?.error ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * A form's action: `run` calls it, `busy` is set meanwhile, and its error (an API answer, or a
 * check the page made itself) shows as `error` until the next run.
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}

/** The value of a form field, trimmed. */
export const field = (form: HTMLFormElement, name: string) =>
  String(new FormData(form).get(name) ?? "").trim();

export type Loaded<T> =
  | { state: "loading" }
  | { state: "error"; error: ApiError }
  | { state: "ready"; data: T };

/**
 * Loads data for a page and reloads it when `key` changes; `reload` fetches again in place. A
 * response that arrives after the page moved on is dropped.
 */
export function useLoad<T>(key: string, load: () => Promise<T>): Loaded<T> & { reload(): void } {
  const [result, setResult] = useState<{ key: string; value: Loaded<T> }>({
    key,
    value: { state: "loading" },
  });
  const [tick, setTick] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names everything `load` reads.
  useEffect(() => {
    let live = true;
    load().then(
      (data) => live && setResult({ key, value: { state: "ready", data } }),
      (e: unknown) =>
        live &&
        setResult({
          key,
          value: {
            state: "error",
            error: e instanceof ApiError ? e : new ApiError(0, "network", String(e)),
          },
        }),
    );
    return () => {
      live = false;
    };
  }, [key, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const value: Loaded<T> = result.key === key ? result.value : { state: "loading" };
  return { ...value, reload };
}
