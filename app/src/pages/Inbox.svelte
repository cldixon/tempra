<script lang="ts">
  import { api, post } from "../api";
  import {
    INBOX_EVENT,
    type InboxItem,
    type InboxPage,
    inboxChanged,
    itemLibrary,
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
   * The Inbox (TEMPRA-116; TEMPRA-173, TEMPRA-189; tempra-dev: v2/notifications): what waits on the
   * person across their libraries, newest first: invitations, mentions and replies, nothing
   * else. One state: an item is done once opened (a reply or a mention lands in its thread) or
   * answered (an invitation accepted or declined, a thread resolved), and then it is under
   * Earlier. Reached by the bell; one library or all. "Older" pages back past the first hundred.
   */
  let { library }: { library: string | null } = $props();

  /** How many waiting items a page loads, and how many done ones Earlier shows. */
  const PAGE = 100;
  const EARLIER = 20;

  useTitle(() => "Inbox");
  const query = (more: Record<string, string>) => {
    const q = new URLSearchParams(more);
    if (library) q.set("library", library);
    return q;
  };
  const q = $derived(query({ limit: String(PAGE) }));
  const loaded = useLoad(
    () => `inbox ${q}`,
    () => api<InboxPage>(`/api/v1/inbox?${q}`),
    [INBOX_EVENT],
  );
  const doneQ = $derived(query({ done: "1", limit: String(EARLIER) }));
  const done = useLoad(
    () => `inbox ${doneQ}`,
    () => api<InboxPage>(`/api/v1/inbox?${doneQ}`),
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
  const earlierRaw = $derived(done.data?.items ?? []);
  const labels = useAgentLabels(() => (raw ? [...raw, ...earlierRaw] : null));
  const items = $derived(raw && withNames(raw, labels.current));
  const earlier = $derived(withNames(earlierRaw, labels.current));
  const titles = usePageTitles(() => (items ? [...items, ...earlier] : null));
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
      joined = {
        name: itemLibrary(i, me.current?.handle ?? null),
        href: urlsOf(i.library).tree(""),
      };
    });
  const isReachable = (i: InboxItem) => reachable.some((l) => `${l.owner}/${l.slug}` === i.library);
</script>

<header class="view-head">
  <div class="view-head-main">
    <h1 class="view-title">Inbox</h1>
  </div>
</header>
<!-- One library filter, whichever way the page was reached (the bell, or Needs you's old URL). -->
{#if library || reachable.length > 1}
  <div class="view-filters inbox-filters">
    <select
      class="pill-select"
      aria-label="Library"
      value={library ?? ""}
      onchange={(e) => navigate(inboxUrl({ library: e.currentTarget.value || null }))}
    >
      <option value="">All libraries</option>
      {#each reachable as l (`${l.owner}/${l.slug}`)}
        <option value={`${l.owner}/${l.slug}`}>{libraryLabel(l)}</option>
      {/each}
      {#if library && !reachable.some((l) => `${l.owner}/${l.slug}` === library)}
        <option value={library}>{itemLibrary({ library, library_title: null }, me.current?.handle ?? null)}</option>
      {/if}
    </select>
  </div>
{/if}
{#if action.error}
  <div class="notice">{action.error}</div>
{/if}
{#if joined}
  <div class="notice" role="status">You joined {joined.name}. <a href={joined.href}>Open</a></div>
{/if}
<Status loaded={loaded.current}>
  {#snippet children()}
    {#if items === null || items.length === 0}
      <p class="view-empty">Nothing waiting</p>
    {:else}
      <ul class="inbox-list">
        {#each items as i (i.id)}
          <InboxRow
            item={i}
            titles={titles.current}
            me={me.current?.handle ?? null}
            reachable={isReachable(i)}
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
    {#if earlier.length > 0}
      <section class="inbox-earlier" aria-labelledby="inbox-earlier">
        <h2 id="inbox-earlier" class="view-section-title">Earlier</h2>
        <ul class="inbox-list">
          {#each earlier as i (i.id)}
            <InboxRow
              item={i}
              titles={titles.current}
              me={me.current?.handle ?? null}
              reachable={isReachable(i)}
              busy={action.busy}
              {run}
              onAccept={accept}
            />
          {/each}
        </ul>
      </section>
    {/if}
  {/snippet}
</Status>
