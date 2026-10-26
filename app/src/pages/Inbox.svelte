<script lang="ts">
  import { api, post } from "../api";
  import {
    INBOX_EVENT,
    type InboxItem,
    type InboxPage,
    inboxChanged,
    itemLibrary,
    markRead,
    withNames,
  } from "../inbox";
  import { useAgentLabels, usePageTitles } from "../inbox.svelte.ts";
  import { useAction, useLoad } from "../load.svelte.ts";
  import { useOlder } from "../paging.svelte.ts";
  import { librariesChanged, libraryLabel } from "../role";
  import { useLibraries } from "../role.svelte.ts";
  import { navigate } from "../router";
  import Status from "../Status.svelte";
  import { useMe, useTitle } from "../ui.svelte.ts";
  import { inboxUrl, urlsOf } from "../urls";
  import InboxRow from "./InboxRow.svelte";

  /**
   * The Inbox (take 4, boards 02, 13; TEMPRA-116; tempra-dev: v2/notifications): the one place for
   * what the person should do or answer across their libraries, newest first, kept until done:
   * invitations, mentions and replies on their threads, and nothing else (TEMPRA-173). Open and
   * Done tabs, one library or all; read and done are kept on the server, so they follow the
   * person. "Older" pages back past the first hundred.
   */
  let { done, library }: { done: boolean; library: string | null } = $props();

  /** How many items a page of the Inbox loads. */
  const PAGE = 100;

  useTitle(() => "Inbox");
  const q = $derived.by(() => {
    const q = new URLSearchParams({ limit: String(PAGE) });
    if (done) q.set("done", "1");
    if (library) q.set("library", library);
    return q;
  });
  const loaded = useLoad(
    () => `inbox ${q}`,
    () => api<InboxPage>(`/api/v1/inbox?${q}`),
    [INBOX_EVENT],
  );
  const first = $derived(loaded.data ?? null);
  // Older pages, after the first ("Older", as Activity has), kept as the first page reloads.
  const older = useOlder(
    () => first,
    (i) => i.id,
    (before: string) => {
      const page = new URLSearchParams(q);
      page.set("before", before);
      return api<InboxPage>(`/api/v1/inbox?${page}`);
    },
  );
  const raw = $derived(first ? older.items : null);
  const labels = useAgentLabels(() => raw);
  const items = $derived(raw && withNames(raw, labels.current));
  const titles = usePageTitles(() => items);
  const action = useAction();
  const me = useMe();
  const libs = useLibraries();
  const reachable = $derived(libs.data?.libraries ?? []);
  // Accepting an invitation: the library joins the switcher and the sidebar, and opens from here.
  let joined = $state<{ name: string; href: string } | null>(null);
  const run = (fn: () => Promise<unknown>) =>
    action.run(async () => {
      await fn();
      inboxChanged();
    });
  const accept = (i: InboxItem) =>
    void run(async () => {
      await post(`/api/v1/invitations/${encodeURIComponent(i.invitation ?? "")}/accept`, {});
      librariesChanged();
      joined = { name: itemLibrary(i, me.current?.handle ?? null), href: urlsOf(i.library).tree("") };
    });
  const open = $derived(first?.open ?? null);
  // Mark all read clears what the list shows: one library's items when it is filtered.
  const unread = $derived(
    library
      ? (items ?? []).some((i) => i.read_at === null && i.done_at === null)
      : (first?.unread ?? 0) > 0,
  );
</script>

<header class="view-head">
  <div class="view-head-main">
    <h1 class="view-title">Inbox</h1>
  </div>
</header>
<div class="view-filters inbox-filters">
  <fieldset class="segmented">
    <legend class="visually-hidden">Show</legend>
    <button
      type="button"
      aria-pressed={!done}
      onclick={() => done && navigate(inboxUrl({ library }))}
      >Open{open !== null && open > 0 ? ` ${open}` : ""}</button
    >
    <button
      type="button"
      aria-pressed={done}
      onclick={() => !done && navigate(inboxUrl({ done: true, library }))}>Done</button
    >
  </fieldset>
  <!-- One library filter, whichever way the page was reached (from a home or here). -->
  {#if library || reachable.length > 1}
    <select
      class="pill-select"
      aria-label="Library"
      value={library ?? ""}
      onchange={(e) => navigate(inboxUrl({ done, library: e.currentTarget.value || null }))}
    >
      <option value="">All libraries</option>
      {#each reachable as l (`${l.owner}/${l.slug}`)}
        <option value={`${l.owner}/${l.slug}`}>{libraryLabel(l)}</option>
      {/each}
      {#if library && !reachable.some((l) => `${l.owner}/${l.slug}` === library)}
        <option value={library}>{itemLibrary({ library, library_title: null }, me.current?.handle ?? null)}</option>
      {/if}
    </select>
  {/if}
  {#if unread}
    <button
      type="button"
      class="ghost inbox-mark"
      disabled={action.busy}
      onclick={() => void run(() => markRead(undefined, library))}>Mark all read</button
    >
  {/if}
</div>
{#if action.error}
  <div class="notice">{action.error}</div>
{/if}
{#if joined}
  <div class="notice" role="status">You joined {joined.name}. <a href={joined.href}>Open</a></div>
{/if}
<Status loaded={loaded.current}>
  {#snippet children()}
    {#if items === null || items.length === 0}
      <p class="view-empty">{done ? "Nothing done yet" : "Nothing for you"}</p>
    {:else}
      <ul class="inbox-list">
        {#each items as i (i.id)}
          <InboxRow
            item={i}
            titles={titles.current}
            me={me.current?.handle ?? null}
            reachable={reachable.some((l) => `${l.owner}/${l.slug}` === i.library)}
            busy={action.busy}
            {run}
            onAccept={accept}
          />
        {/each}
      </ul>
      {#if older.next !== null}
        <p class="view-more">
          <button type="button" onclick={older.loadOlder} disabled={older.paging}>{older.paging ? "Loading…" : "Older"}</button>
        </p>
      {/if}
    {/if}
  {/snippet}
</Status>
