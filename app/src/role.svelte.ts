import { api } from "./api";
import { useLoad } from "./load.svelte.ts";
import { LIBRARIES_EVENT, libraryLabel, type ReachableLibrary, type Role } from "./role";

/**
 * The person's libraries, own and shared (one load, shared by the workspace's parts; each part
 * reloads when told the libraries changed, since each holds its own copy of the answer).
 */
export function useLibraries() {
  const loaded = useLoad(
    () => "workspace libraries",
    () => api<{ libraries: ReachableLibrary[] }>("/api/v1/libraries"),
  );
  $effect(() => {
    const reload = () => loaded.reload();
    window.addEventListener(LIBRARIES_EVENT, reload);
    return () => window.removeEventListener(LIBRARIES_EVENT, reload);
  });
  return loaded;
}

/** Libraries the list was loaded again for because it lacked them, each once per page load. */
const reloadedFor = new Set<string>();

/**
 * The person's role in this library; null while it is unknown: while the list loads, and when
 * the list does not have the library yet (just made, or an invitation just accepted) until the
 * list, loaded again once, does. Never a guess: owner items show only to the owner (S-2).
 */
export function useRole(lib: () => { owner: string; slug: string }) {
  const libs = useLibraries();
  const found = $derived(
    libs.data?.libraries.find((l) => l.owner === lib().owner && l.slug === lib().slug),
  );
  $effect(() => {
    const missing = libs.state === "ready" && !found;
    const key = `${lib().owner}/${lib().slug}`;
    if (!missing || reloadedFor.has(key)) return;
    reloadedFor.add(key);
    libs.reload();
  });
  return {
    get current(): Role | null {
      return found ? (found.role ?? "owner") : null;
    },
  };
}
/** This library's label (libraryLabel), from the person's list; the slug while it loads. */
export function useLibraryLabel(lib: () => { owner: string; slug: string }) {
  const libs = useLibraries();
  const label = $derived.by(() => {
    const l = lib();
    const found = libs.data?.libraries.find((x) => x.owner === l.owner && x.slug === l.slug);
    return libraryLabel(found ?? l);
  });
  return {
    get current() {
      return label;
    },
  };
}
