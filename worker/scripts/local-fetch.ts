/**
 * fetch for the scripts that talk to `cf dev` (the gate and its helpers; TEMPRA-186).
 *
 * cf dev closes a keep-alive connection after 5 s idle. bun's fetch pools connections, and a
 * request it sends on a pooled one just as cf dev closes it fails with `ECONNRESET` before any
 * answer, which fails the whole gate for nothing the Worker did. Retrying would mean telling a
 * write that never arrived from one that did, so instead nothing is sent on an idle socket: to
 * a loopback address every request opens its own connection (bun's `keepalive: false`), which
 * costs well under a millisecond there. Anything else (a preview, staging) keeps the pool.
 */

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Whether a request goes to this machine, where cf dev runs. */
export function isLoopback(input: string | URL | Request): boolean {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    return LOOPBACK.has(new URL(href).hostname);
  } catch {
    return false;
  }
}

/** `fetch`, with no connection reused for a loopback address. */
export const localFetch: Fetch = (input, init) =>
  isLoopback(input) ? fetch(input, { ...init, keepalive: false }) : fetch(input, init);
