<script lang="ts">
  import { api } from "./api";
  import {
    INBOX_EVENT,
    type InboxPage,
    itemDetail,
    itemHref,
    itemLibrary,
    itemTitle,
    markDone,
    withNames,
  } from "./inbox";
  import { useAgentLabels, usePageTitles } from "./inbox.svelte.ts";
  import LibraryTile from "./LibraryTile.svelte";
  import { useLoad } from "./load.svelte.ts";
  import Moment from "./Moment.svelte";
  import { useMe } from "./ui.svelte.ts";

  /**
   * The bell's panel (TEMPRA-189): what waits, newest first, a few at a time, each one a link to
   * where it is (a reply or a mention opens its thread, and opening it is seeing it: done); or
   * "Nothing waiting". Open Inbox at its foot. Mounted only while the panel is open, so the list
   * is asked for when the person looks, and drawn at once from what was loaded last time.
   */
  const SHOWN = 6;
  const loaded = useLoad(
    () => "inbox-latest",
    () => api<InboxPage>(`/api/v1/inbox?limit=${SHOWN}`),
    [INBOX_EVENT],
  );
  const raw = $derived(loaded.data?.items ?? null);
  const labels = useAgentLabels(() => raw);
  const items = $derived(raw && withNames(raw, labels.current));
  const titles = usePageTitles(() => items);
  const me = useMe();
  const more = $derived((loaded.data?.open ?? 0) - (items?.length ?? 0));
</script>

<p class="bell-head">Inbox</p>
{#if loaded.state === "loading" && items === null}
  <p class="bell-empty">Loading…</p>
{:else if loaded.state === "error"}
  <p class="bell-empty" role="alert">Couldn't load the Inbox.</p>
{:else if !items || items.length === 0}
  <p class="bell-empty">Nothing waiting</p>
{:else}
  {#each items as i (i.id)}
    <a
      class="bell-item"
      href={itemHref(i)}
      onclick={() => {
        if (i.kind !== "invitation") void markDone(i.id);
      }}
    >
      <LibraryTile name={i.library_title || (i.library.split("/").pop() ?? i.library)} shared={me.current !== null && !i.library.startsWith(`${me.current.handle}/`)} />
      <span class="bell-item-what"><strong>{itemTitle(i, titles.current)}</strong><span class="bell-item-detail">{itemDetail(i)}</span></span>
      <span class="bell-item-where">{itemLibrary(i, me.current?.handle ?? null)}{" · "}<Moment ts={i.created} /></span>
    </a>
  {/each}
  {#if more > 0}<p class="bell-more">{more} more</p>{/if}
{/if}
<a class="bell-foot" href="/inbox">Open Inbox</a>
