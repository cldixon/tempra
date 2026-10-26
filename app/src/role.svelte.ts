import { api } from "./api";
import { useLoad } from "./load.svelte.ts";
import { LIBRARIES_EVENT, libraryLabel, type ReachableLibrary, type Role } from "./role";
import { useTitle } from "./ui.svelte.ts";

/**
 * The person's libraries, own and shared (one load, shared by the workspace's parts; each part
 * reloads when told the libraries changed, since each holds its own copy of the answer).
 */
export function useLibraries() {
  return useLoad(
    () => "workspace libraries",
    () => api<{ libraries: ReachableLibrary[] }>("/api/v1/libraries"),
    [LIBRARIES_EVENT],
  );
}

/** Libraries the list was loaded again for because it lacked them, each once per page load. */
const reloadedFor = new Set<string>();

/**
 * This library as the person's list has it (its title, description, the person's role);
 * undefined while the list loads, and while it lacks the library (just made, or an invitation
 * just accepted), until the list, loaded again once, has it.
 */
export function useLibrary(lib: () => { owner: string; slug: string }) {
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
    get current(): ReachableLibrary | undefined {
      return found;
    },
  };
}

/**
 * The person's role in this library; null while it is unknown (useLibrary). Never a guess:
 * owner items show only to the owner (S-2).
 */
export function useRole(lib: () => { owner: string; slug: string }) {
  const library = useLibrary(lib);
  return {
    get current(): Role | null {
      const l = library.current;
      return l ? (l.role ?? "owner") : null;
    },
  };
}

/** This library's label (libraryLabel), from the person's list; the slug while it loads. */
export function useLibraryLabel(lib: () => { owner: string; slug: string }) {
  const library = useLibrary(lib);
  return {
    get current() {
      return libraryLabel(library.current ?? lib());
    },
  };
}

/** A library page's title: "{page} · {library}" (TEMPRA-131's label for the library). */
export function useLibraryTitle(lib: () => { owner: string; slug: string }, page: () => string) {
  const label = useLibraryLabel(lib);
  useTitle(() => `${page()} · ${label.current}`);
}
