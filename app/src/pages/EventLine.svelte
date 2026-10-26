<script lang="ts">
  import AgentName from "../AgentName.svelte";
  import Avatar from "../Avatar.svelte";
  import { type EventRow, entryTime } from "../activity";
  import type { ActorView } from "../agents";
  import { localTime } from "../ui";
  import type { Urls } from "../urls";

  /** One row of Every event. */
  let {
    row,
    urls,
    actor,
    live,
    revert,
    now,
  }: {
    row: EventRow;
    urls: Urls;
    actor: ActorView;
    live: boolean;
    revert: boolean;
    now: number;
  } = $props();

  /** Events that made a version of a file, so a diff shows what they changed. */
  const DIFFABLE = new Set(["put", "import", "revert", "attach"]);

  const e = $derived(row.event);
  // A deleted file is shown as it was just before; a comment opens on its page.
  const href = $derived(
    e.op === "comment"
      ? urls.file(e.path)
      : urls.pinned(e.op === "delete" ? e.seq - 1 : e.seq).file(e.path),
  );
</script>

<tr class={row.lead ? "lead" : undefined}>
  <td class="events-seq">{#if live}<span class="change-dot live"><span class="visually-hidden">Being written now</span></span>{/if}{e.seq}</td>
  <td class="events-when">
    {#if row.lead}
      <time datetime={e.ts} title={localTime(e.ts)}>{entryTime(e.ts, now, true)}</time>
    {/if}
  </td>
  <td class="events-who">
    {#if row.lead}
      <span class="events-person"><Avatar name={actor.mark} agent={actor.agent} /><AgentName who={actor} /></span>
    {/if}
  </td>
  <td class="events-kind">{row.kind}</td>
  <td class="events-path"><a href={href}><code>{e.path}</code></a>{#if row.note}<span class="events-note">{row.note}</span>{/if}{#if DIFFABLE.has(e.op) && e.path.endsWith(".md")}<!-- This version as it was, on the concept's own page (History marks it there). --><a class="events-aside" href={urls.diff(e.path, undefined, e.seq)}>Version</a>{/if}{#if revert}<a class="events-aside" href={urls.revert(row.request.request_id)}>Revert…</a>{/if}</td>
</tr>
