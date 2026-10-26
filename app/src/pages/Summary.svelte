<script lang="ts">
  import {
    byPerson,
    type Entry,
    groupByDay,
    type LedgerRequest,
    type LiveWrite,
    titleOf,
    toEntry,
  } from "../activity";
  import { useActors } from "../agents.svelte.ts";
  import EntryRow from "../EntryRow.svelte";
  import LiveEntry from "../LiveEntry.svelte";
  import type { Urls, Who } from "../urls";

  /** The Summary: the live entry, then one entry per request, by day. */
  let {
    urls,
    me,
    requests,
    empty,
    titles,
    who,
    writing,
    now,
  }: {
    urls: Urls;
    me: string;
    requests: LedgerRequest[];
    empty: boolean;
    titles: Record<string, string>;
    who: Who;
    writing: LiveWrite | null;
    now: number;
  } = $props();

  const actors = useActors(() => urls);
  const entries = $derived.by(() => {
    const ids = new Set<string>();
    const out: Entry[] = [];
    for (const r of requests) {
      if (ids.has(r.request_id)) continue;
      ids.add(r.request_id);
      if (who === "people" && !byPerson(r)) continue;
      if (who === "agents" && byPerson(r)) continue;
      const e = toEntry(r, titles);
      if (e) out.push(e);
    }
    return out;
  });
  const live = $derived(writing && who !== "people" ? writing : null);
  const days = $derived.by(() => {
    const days = groupByDay(entries, now);
    // The live entry heads today's entries (a day of its own when nothing else happened today).
    if (live && days[0]?.label !== "Today") days.unshift({ label: "Today", items: [] });
    return days;
  });
</script>

{#if entries.length === 0 && !live}
  <p class="view-empty">{empty ? "Nothing has happened here yet." : "Nothing matches."}</p>
{/if}
{#each days as day, i (day.label)}
  <section class="activity-day" aria-label={day.label}>
    <h2 class="view-section-title">{day.label}</h2>
    {#if i === 0 && live}
      <LiveEntry
        write={live}
        {urls}
        actor={actors.view(live.actor, live.by)}
        title={titleOf(live.path, titles)}
      />
    {/if}
    {#each day.items as e (e.id)}
      <EntryRow entry={e} {urls} actor={actors.view(e.actor, e.by)} {now} />
    {/each}
  </section>
{/each}
