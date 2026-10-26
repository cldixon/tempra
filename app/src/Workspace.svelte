<script lang="ts" module>
  import type { Urls } from "./urls";

  const hiddenKey = (urls: Urls) => `tempra:sidebar:${urls.owner}/${urls.slug}`;

  /** Whether the person hid the sidebar in this library (a reading mode, remembered per library). */
  function loadHidden(urls: Urls): boolean {
    try {
      return localStorage.getItem(hiddenKey(urls)) === "hidden";
    } catch {
      return false;
    }
  }

  function saveHidden(urls: Urls, hidden: boolean) {
    try {
      if (hidden) localStorage.setItem(hiddenKey(urls), "hidden");
      else localStorage.removeItem(hiddenKey(urls));
    } catch {
      // Storage off: the sidebar shows again next time.
    }
  }
</script>

<script lang="ts">
  import { type Snippet, untrack } from "svelte";
  import FeedNotice from "./FeedNotice.svelte";
  import { type Place, SETTINGS_VIEWS } from "./frame";
  import { inboxChanged } from "./inbox";
  import LibrarySidebar from "./LibrarySidebar.svelte";
  import { useFeed } from "./live.svelte.ts";
  import { libraryLabel } from "./role";
  import { useLibraries } from "./role.svelte.ts";
  import SettingsSidebar from "./SettingsSidebar.svelte";
  import Shell from "./Shell.svelte";
  import Switcher from "./Switcher.svelte";
  import type { OutlineFile } from "./tree";
  import type { Me } from "./ui";

  /**
   * A library's frame, keyed by the library so it stays mounted while the person moves within it:
   * the library in the bar (its name, switcher and search), the library's sidebar, or its
   * settings' sidebar on a settings page, the quick switcher, and the feed's refresh of the inbox
   * count.
   */
  let { urls, place, me, children }: { urls: Urls; place: Place; me: Me | null; children: Snippet } =
    $props();
  let hidden = $state(loadHidden(untrack(() => urls)));
  let switching = $state(false);
  let index = $state.raw<OutlineFile[] | null>(null);
  let indexSeq = $state<number | null>(null);
  const libs = useLibraries();
  const library = $derived(
    libs.data?.libraries.find((l) => l.owner === urls.owner && l.slug === urls.slug),
  );
  const name = $derived(libraryLabel(library ?? urls));

  function hide(h: boolean) {
    hidden = h;
    saveHidden(urls, h);
  }
  // Ctrl or Cmd+K opens the quick switcher, and again closes it (on the settings pages too;
  // TEMPRA-127).
  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        switching = !switching;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  // A comment, a write or a verification may make, change or close an item of the person's
  // (TEMPRA-116): the inbox's count reloads a moment after one (items are written just after the
  // write commits), once for a burst.
  let inboxTimer: ReturnType<typeof setTimeout> | null = null;
  useFeed(
    () => urls,
    () => indexSeq,
    (events) => {
      if (events.length === 0 || inboxTimer) return;
      inboxTimer = setTimeout(() => {
        inboxTimer = null;
        inboxChanged();
      }, 1500);
    },
    () => {},
  );
  function onIndex(files: OutlineFile[], seq: number) {
    index = files;
    indexSeq = indexSeq ?? seq;
  }

  const settings = $derived(SETTINGS_VIEWS.has(place.view));
  const shared = $derived(library !== undefined && (library.role ?? "owner") !== "owner");
</script>

<!-- Only the library's own sidebar hides; the settings' is how the person moves between tabs. -->
<Shell
  library={{ urls, name, shared, home: place.view === "home" }}
  onSearch={() => (switching = true)}
  hidden={settings ? undefined : hidden}
  onHide={settings ? undefined : hide}
  {me}
  {index}
>
  {#snippet sidebar()}
    {#if settings}
      <SettingsSidebar {urls} {place} />
    {:else}
      <LibrarySidebar {urls} {place} {onIndex} />
    {/if}
  {/snippet}
  {#snippet status()}<FeedNotice {urls} />{/snippet}
  {@render children()}
</Shell>
<Switcher {urls} {name} index={index ?? []} open={switching} onClose={() => (switching = false)} />
