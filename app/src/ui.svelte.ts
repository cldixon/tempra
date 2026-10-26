import { api } from "./api";
import { useLoad } from "./load.svelte.ts";
import type { Me } from "./ui";

/** The signed-in person, loaded once for the whole app (the same load App.svelte makes). */
export function useMe() {
  const me = useLoad(
    () => "me",
    () => api<Me>("/api/v1/me"),
  );
  return {
    get current(): Me | null {
      return me.data ?? null;
    },
  };
}

/** Sets the document title, as the server pages do: "{title} · Tempra". */
export function useTitle(title: () => string | null) {
  $effect(() => {
    const t = title();
    if (t) document.title = `${t} · Tempra`;
  });
}

/** After a page's data arrives, scrolls to the #fragment the URL names, if any. */
export function useScrollToHash(ready: () => boolean) {
  $effect(() => {
    if (!ready() || !location.hash) return;
    let id: string;
    try {
      id = decodeURIComponent(location.hash.slice(1));
    } catch {
      // A malformed escape (an agent wrote the link): use the fragment as it is.
      id = location.hash.slice(1);
    }
    document.getElementById(id)?.scrollIntoView();
  });
}

/** The clock relative times are read against, ticking so "2 min ago" stays true. */
export function useNow(ms = 30_000) {
  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => {
      now = Date.now();
    }, ms);
    return () => clearInterval(t);
  });
  return {
    get current() {
      return now;
    },
  };
}

/** Copies text from a click; `state` says "copied" (or "failed") for a moment after. */
export function useCopy() {
  let state = $state<"idle" | "copied" | "failed">("idle");
  $effect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => {
      state = "idle";
    }, 2000);
    return () => clearTimeout(t);
  });
  return {
    get state() {
      return state;
    },
    copy: (text: string) =>
      navigator.clipboard.writeText(text).then(
        () => {
          state = "copied";
        },
        () => {
          state = "failed";
        },
      ),
  };
}
