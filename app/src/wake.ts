/**
 * Waking a library before the person clicks (TEMPRA-195; tempra-dev: v2/performance, A library's
 * cold start). A library's object that has gone to sleep takes 250 to 600 ms to start again on its
 * next call, all of it the platform's (TEMPRA-190). When the person shows intent after a quiet
 * spell, one cheap call starts that wake while they are still pointing, so the click does not wait
 * for it. `api()` records every call to a library here; the hook (wake.svelte.ts) asks `due`.
 */

/**
 * A library asked nothing for this long may have gone cold; one asked something more recently is
 * left alone. Idle time does not predict a cold start well (objects stayed warm for minutes and
 * went cold after seconds), so this only bounds the wakes: at most one a minute per library.
 */
export const WAKE_AFTER_MS = 60_000;

/** When each library was last asked for something, by its API prefix. */
const last = new Map<string, number>();

const PREFIX = /^(?:https?:\/\/[^/]+)?(\/api\/v1\/libraries\/[^/?#]+\/[^/?#]+\/)/;

/** A library API URL's library: its prefix, `/api/v1/libraries/{owner}/{slug}/`; else null. */
export function libraryOf(url: string): string | null {
  return PREFIX.exec(url)?.[1] ?? null;
}

/** Records that a library was just asked for something (any call to it wakes its object). */
export function touched(url: string, now = Date.now()) {
  const lib = libraryOf(url);
  if (lib) last.set(lib, now);
}

/** Whether a library has been quiet long enough to be worth waking. */
export function due(lib: string, now = Date.now()): boolean {
  const at = last.get(lib);
  return at === undefined || now - at >= WAKE_AFTER_MS;
}
