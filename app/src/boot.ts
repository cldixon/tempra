/**
 * The first page's API answers, which the Worker put in the shell as a JSON data block (TEMPRA-175;
 * worker/src/ui/boot.ts). `api()` takes its first call to each of those URLs from here instead of
 * the network, once; a URL the page never asks for soon after loading is dropped, so nothing
 * stale is ever served later. A page asks again in the background as it always does.
 */

/**
 * A URL's key: its path and its query sorted by name, as the Worker keys the data
 * (worker/src/ui/boot.ts `bootKey`).
 */
export function bootKey(url: string): string {
  const u = new URL(url, "http://x");
  const params = [...u.searchParams].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const q = new URLSearchParams(params).toString();
  return q ? `${u.pathname}?${q}` : u.pathname;
}

/** How long after loading an answer that was not asked for is kept. */
export const BOOT_KEEP_MS = 10_000;

let boot = new Map<string, unknown>();

/** Takes the data block from the document, once, and forgets what is left after a while. */
export function readBoot(doc: Document = document, keepMs = BOOT_KEEP_MS) {
  const el = doc.getElementById("tempra-boot");
  if (!el) return;
  el.remove();
  try {
    boot = new Map(Object.entries(JSON.parse(el.textContent ?? "{}") as Record<string, unknown>));
  } catch {
    boot = new Map();
  }
  if (boot.size > 0) setTimeout(() => boot.clear(), keepMs);
}

/** The answer the shell carried for this GET, if any, which only the first call gets. */
export function takeBoot(url: string): { data: unknown } | null {
  if (boot.size === 0) return null;
  const key = bootKey(url);
  if (!boot.has(key)) return null;
  const data = boot.get(key);
  boot.delete(key);
  return { data };
}
