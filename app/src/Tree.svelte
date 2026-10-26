<script lang="ts">
  import { untrack } from "svelte";
  import { api } from "./api";
  import Icon from "./Icon.svelte";
  import { useFeed } from "./live.svelte.ts";
  import { prefetchFile } from "./prefetch";
  import {
    ancestors,
    buildDirs,
    countConcepts,
    fileLabel,
    HOVER_MS,
    insideDirs,
    loadClosed,
    type OutlineFile,
    REFRESH_MS,
    rollUp,
    saveClosed,
  } from "./tree";
  import { plural } from "./ui";
  import { folderName, type Urls } from "./urls";

  /**
   * The library's file tree (tempra-dev: app/workspace). The whole index (paths, titles,
   * sequences; no bodies) arrives in one small request when the workspace opens, so opening a
   * folder never waits. A folder (named for people, with its count of concepts) is a group, not a
   * page: its row opens and closes it (TEMPRA-138), and a folder's address reveals it here. Every
   * folder starts open; the ones the person closed are remembered on this browser, the open file
   * is revealed and marked, and the change feed refreshes the index once per burst of writes. A
   * closed folder rolls up the marks of what is inside it. Change is not marked here
   * (TEMPRA-173): Activity is where a person looks for it.
   */
  let props: {
    urls: Urls;
    file: string | null;
    dir: string | null;
    /** The index and its sequence, for the quick switcher and the feed's start. */
    onIndex?(files: OutlineFile[], seq: number): void;
  } = $props();

  let files = $state.raw<OutlineFile[] | null>(null);
  let closed = $state.raw(loadClosed(untrack(() => props.urls)));
  const isOpen = (dir: string) => !closed.has(dir);
  let seq = $state<number | null>(null);
  const dirs = $derived(files ? buildDirs(files) : null);
  const counts = $derived(files ? countConcepts(files) : new Map<string, number>());
  const inside = $derived(files ? insideDirs(files) : new Map<string, OutlineFile[]>());

  // Only the latest request's answer is kept (two loads may cross).
  let asked = 0;
  let loadedAt = 0;
  let failed = $state(false);
  async function load() {
    const mine = ++asked;
    loadedAt = Date.now();
    try {
      const r = await api<{ seq: number; files: OutlineFile[] }>(props.urls.api("outline"));
      if (mine !== asked) return;
      files = r.files;
      failed = false;
      // The feed is synced once, from the first index; it stays live after that.
      seq = seq ?? r.seq;
    } catch {
      if (mine === asked) failed = true;
    }
  }
  $effect(() => {
    void props.urls;
    untrack(() => void load());
  });
  $effect(() => {
    const f = files;
    const s = seq;
    if (f && s !== null) untrack(() => props.onIndex?.(f, s));
  });

  // The open file's folders are revealed when it opens (and may be collapsed after); so is a
  // folder whose address was opened (`dir`, on its way to the home).
  const current = $derived(props.file ?? props.dir);
  /** A folder being revealed: its row is scrolled into view when it first draws. */
  let revealing = $state<string | null>(null);
  $effect(() => {
    const file = props.file;
    const cur = current;
    const urls = props.urls;
    if (cur === null) return;
    if (file === null) revealing = cur;
    const up = file !== null ? ancestors(file) : [...ancestors(cur), cur];
    const want = up.filter((d) => d !== "");
    untrack(() => {
      const c = closed;
      if (!want.some((d) => c.has(d))) return;
      const next = new Set([...c].filter((d) => !want.includes(d)));
      saveClosed(urls, next);
      closed = next;
    });
  });

  // Live: the index is refreshed shortly after a write, and at most every few seconds while
  // agents keep writing (each refresh reads the whole index).
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(timer));
  useFeed(
    () => props.urls,
    () => seq,
    () => {
      if (timer === undefined) {
        const wait = Math.max(300, loadedAt + REFRESH_MS - Date.now());
        timer = setTimeout(() => {
          timer = undefined;
          void load();
        }, wait);
      }
    },
    () => {
      // The ledger went back (a restore): start again from the new index.
      seq = null;
      void load();
    },
  );
  function toggle(dir: string) {
    const next = new Set(closed);
    if (next.has(dir)) next.delete(dir);
    else next.add(dir);
    saveClosed(props.urls, next);
    closed = next;
  }

  // The open file's (or revealed folder's) row is scrolled into view once, when it opens (not
  // after every refresh, which would pull the person back while agents write).
  let currentRow = $state.raw<HTMLElement | null>(null);
  const markCurrent = (el: HTMLElement) => {
    currentRow = el;
    return () => {
      if (currentRow === el) currentRow = null;
    };
  };
  let scrolledTo: string | null = null;
  $effect(() => {
    const cur = current;
    const row = currentRow;
    void dirs;
    // The row may first appear when the index arrives; it must be this file's, not the last.
    if (scrolledTo === cur || !row || row.dataset.path !== cur) return;
    scrolledTo = cur;
    // After the first paint: scrolling reads layout, which would hold back drawing the page.
    requestAnimationFrame(() => row.scrollIntoView({ block: "nearest" }));
  });
  /** A revealed folder's row scrolls into view when it draws. */
  const reveal = (path: string) => (el: HTMLElement) => {
    if (revealing === path) {
      revealing = null;
      el.scrollIntoView({ block: "nearest" });
    }
  };

  // A file's page is loaded ahead when the pointer rests on it, or the keyboard reaches it; not
  // the file already open (a click rests the pointer on the row it opened, whose page has just
  // loaded it).
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(hoverTimer));
  function enter(path: string) {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (path !== props.file) prefetchFile(props.urls, path);
    }, HOVER_MS);
  }
  const s = (n: number) => (n === 1 ? "" : "s");
</script>

{#snippet mark(comments: number | undefined, stale: OutlineFile["stale"])}{#if comments}<span
      class="tree-mark"
      title={`${comments} open comment${s(comments)}`}
      ><span aria-hidden="true">{comments}</span><span class="visually-hidden"
        >{comments} open comment{s(comments)}</span
      ></span
    >{/if}{#if stale}<span class="tree-mark" title={stale === "stale" ? "Stale" : "Stale soon"}
      ><span aria-hidden="true"><Icon name={stale === "stale" ? "stale" : "soon"} size={12} /></span
      ><span class="visually-hidden">{stale === "stale" ? "stale" : "stale soon"}</span></span
    >{/if}{/snippet}

{#snippet rolledUp(dir: string)}{@const r = rollUp(inside.get(dir) ?? [])}{@render mark(
    r.comments,
    r.stale,
  )}{/snippet}

{#snippet rows(dir: string)}
  {#if dirs === null && failed}
    <li class="tree-note">Could not load the files.{" "}<button type="button" onclick={() => void load()}>Retry</button></li>
  {:else if dirs === null}
    <li class="tree-note">Loading…</li>
  {:else if (dirs[dir] ?? []).length === 0 && dir === ""}
    <li class="tree-note">No pages yet.</li>
  {:else}
    {#each dirs[dir] ?? [] as e (e.path)}
      {#if e.kind === "dir"}
        {@const n = counts.get(e.path) ?? 0}
        <li>
          <!-- A folder is a group, not a page (TEMPRA-138): its whole row opens and closes it. -->
          <div class={isOpen(e.path) ? "tree-row dir open" : "tree-row dir"}
            ><span class="tree-chevron" aria-hidden="true"><Icon name="chevron" /></span><button
              type="button"
              class="tree-name"
              aria-expanded={isOpen(e.path)}
              title={folderName(e.path)}
              {@attach reveal(e.path)}
              onclick={() => toggle(e.path)}
              >{folderName(e.path)}{#if n > 0}<span class="visually-hidden">, {plural(n, "page")}</span
                >{/if}</button
            >{#if n > 0}<span class="tree-count" aria-hidden="true">{n}</span>{/if}{#if !isOpen(e.path)}{@render rolledUp(
                e.path,
              )}{/if}</div
          >{#if isOpen(e.path)}<ul>{@render rows(e.path)}</ul>{/if}</li
        >
      {:else}
        <li>
          <div class={e.kind === "attachment" ? "tree-row file" : "tree-row"}
            ><span class="tree-leaf"
              >{#if e.kind === "attachment"}<Icon name="file" size={14} />{/if}</span
            ><a
              href={props.urls.file(e.path)}
              title={fileLabel(e)}
              data-path={e.path}
              onmouseenter={() => enter(e.path)}
              onmouseleave={() => clearTimeout(hoverTimer)}
              onfocus={(ev) => {
                if (ev.currentTarget.matches(":focus-visible")) prefetchFile(props.urls, e.path);
              }}
              aria-current={props.file === e.path ? "page" : undefined}
              {@attach props.file === e.path ? markCurrent : undefined}>{fileLabel(e)}</a
            >{@render mark(e.comments, e.stale)}</div
          >
        </li>
      {/if}
    {/each}
  {/if}
{/snippet}

<nav aria-label="Files">
  <ul class="tree">{@render rows("")}</ul>
</nav>
