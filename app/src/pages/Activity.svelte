<script lang="ts">
  import { REQUESTS_PAGE, type RequestPage } from "../activity";
  import { useLiveWrites, useTitles } from "../activity.svelte.ts";
  import { api } from "../api";
  import Icon from "../Icon.svelte";
  import { useFeed, useTrailing } from "../live.svelte.ts";
  import { useLoad } from "../load.svelte.ts";
  import PageColumn from "../PageColumn.svelte";
  import { useLibraryLabel } from "../role.svelte.ts";
  import { type Done, navigate } from "../router";
  import Status from "../Status.svelte";
  import { plural } from "../ui";
  import { useTitle } from "../ui.svelte.ts";
  import type { ActivityFilters, Urls } from "../urls";
  import EventFilters from "./EventFilters.svelte";
  import EveryEvent from "./EveryEvent.svelte";
  import Older from "./Older.svelte";
  import Summary from "./Summary.svelte";
  import WhoFilter from "./WhoFilter.svelte";

  /**
   * Activity (take 4, TEMPRA-115; tempra-dev: app/activity, decisions/three-activity-surfaces):
   * what happened in the library, in two views under one switch. The Summary (the default) tells
   * each request as a sentence, grouped by day, with an agent writing now as a live entry at the
   * top; Every event is the ledger as a table, with Download. `-/ledger` opens Every event. Both
   * follow the change feed. Nothing is marked "new since you looked" (TEMPRA-173): a person comes
   * here to look, and is not kept count of.
   * The view and filters are in the URL, so a view can be linked and back and forward restore it.
   */
  let {
    urls,
    actor,
    filters,
    done = null,
  }: { urls: Urls; actor: string; filters: ActivityFilters; done?: Done } = $props();

  const label = useLibraryLabel(() => urls);
  useTitle(() => `Activity · ${label.current}`);
  const view = $derived(filters.view === "events" ? "events" : "summary");
  const prefix = $derived(filters.prefix ?? "");
  const exact = $derived(filters.actor ?? "");
  // Switching the view is a move of its own (back returns to the other); filters replace.
  const go = (change: ActivityFilters, replace = true) =>
    navigate(
      view === "events" && change.view === undefined && location.pathname.endsWith("/-/ledger")
        ? urls.ledger({ ...filters, ...change })
        : urls.activity({ ...filters, view, ...change }),
      { replace },
    );
  const titles = useTitles(() => urls);
  const key = $derived(`activity ${urls.base} ${prefix} ${exact}`);
  const loaded = useLoad(
    () => key,
    async () => {
      // The head first: the feed then replays anything that lands while the page loads.
      const { seq } = await api<{ seq: number }>(urls.api("stats"));
      const page = await api<RequestPage>(
        urls.api("requests", {
          prefix: prefix || undefined,
          actor: exact || undefined,
          limit: REQUESTS_PAGE,
        }),
      );
      return { ...page, head: seq };
    },
  );

  // Live (tempra-dev: app/live): a write the filters may match reloads the newest page, once per
  // burst; titles follow too. An agent's write is remembered as writing now (the pulsing dot).
  const reload = useTrailing(() => loaded.reload());
  const reloadTitles = useTrailing(() => titles.reload(), 1500);
  // A clock that ticks while something reads as live, so the dot stops when the writes do.
  const live = useLiveWrites();
  useFeed(
    () => urls,
    () => loaded.data?.head ?? null,
    (events) => {
      reloadTitles();
      live.heard(events);
      const under = (p: string | null) =>
        !prefix || p === prefix || !!p?.startsWith(`${prefix.replace(/\/$/, "")}/`);
      const hit = events.some(
        (e) => (!exact || e.actor === exact) && (under(e.path) || under(e.from_path)),
      );
      if (hit) reload();
    },
    () => {
      live.reset();
      reload();
    },
  );
</script>

<PageColumn>
  <header class="view-head">
    <div class="view-head-main">
      <h1 class="view-title">Activity</h1>
    </div>
  </header>
  {#if done?.kind === "revert"}
    <div class="notice ok">Reverted: {plural(done.n ?? 0, "change")}, recorded as a new change by you.</div>
  {/if}
  <div class="view-filters activity-filters">
    <fieldset class="segmented">
      <legend class="visually-hidden">View</legend>
      <button
        type="button"
        aria-pressed={view === "summary"}
        onclick={() => view !== "summary" && go({ view: "summary" }, false)}>Summary</button
      >
      <button
        type="button"
        aria-pressed={view === "events"}
        onclick={() => view !== "events" && go({ view: "events" }, false)}>Every event</button
      >
    </fieldset>
    <WhoFilter
      {urls}
      me={actor}
      {view}
      who={filters.who ?? "everyone"}
      actor={exact}
      onChange={(who, a) => go({ who, actor: a || undefined })}
    />
    {#if view === "events"}
      <EventFilters kind={filters.kind ?? ""} q={filters.q ?? ""} onChange={(change) => go(change)} />
      <a class="button activity-download" href={urls.ledgerJsonl()} download><Icon name="download" />Download</a>
    {/if}
  </div>
  <Status loaded={loaded.current}>
    {#snippet children(page)}
      {#key key}
        <Older {urls} {prefix} actor={exact} first={page}>
          {#snippet children(requests, more)}
            {#if view === "summary"}
              <Summary
                {urls}
                me={actor}
                {requests}
                empty={page.requests.length === 0}
                titles={titles.data?.titles ?? {}}
                who={filters.who ?? "everyone"}
                writing={live.writing}
                now={live.now}
              />
            {:else}
              <EveryEvent
                {urls}
                me={actor}
                {requests}
                empty={page.requests.length === 0}
                filter={{ who: filters.who, kind: filters.kind, q: filters.q }}
                {more}
                pulses={live.pulses}
                now={live.now}
              />
            {/if}
          {/snippet}
        </Older>
      {/key}
    {/snippet}
  </Status>
</PageColumn>
