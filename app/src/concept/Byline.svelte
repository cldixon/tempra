<script lang="ts">
  import AgentName from "../AgentName.svelte";
  import { actorText } from "../agents";
  import Avatar from "../Avatar.svelte";
  import Moment from "../Moment.svelte";
  import { EDITING_MS, type Namer } from "./byline";
  import { actedBy, type Concept, type HistoryEvent, standing } from "./data";
  import type { Live } from "./live";
  import StatusPills from "./StatusPills.svelte";

  /**
   * The concept's byline (take 4, TEMPRA-114; tempra-dev: app/reader, The byline): who wrote the
   * version on screen, for whom when an agent ("Claude Code for @ann"), and when ("edited 14 min
   * ago"); while an agent writes the page (a write within the last minute, or one on the feed not
   * yet shown) "· editing now" with the pulsing dot, the agent named once (TEMPRA-131: "Claude
   * Code for @ann · editing now · edited just now"). It follows the version on screen: an earlier
   * one shows who wrote it and when, never "editing now". Versions are in History; whether a person
   * checked the page is the quiet line under it (`CheckedLine.svelte`). At its end, grey pills say
   * what is exceptional: a status that is not stable ("Draft") and "Stale" (TEMPRA-139).
   */
  let props: {
    concept: Concept;
    history: HistoryEvent[];
    name: Namer;
    live: Live | null;
    /** The latest version is on screen: an earlier one is never being edited now. */
    current: boolean;
    /** The page's `status` from its frontmatter, if any. */
    status?: string | null;
  } = $props();

  const live = $derived(props.current ? props.live : null);
  const s = $derived(standing(props.history, props.concept.seq));
  const author = $derived(s.current?.event);
  const who = $derived(author ? props.name(author.actor, actedBy(author)) : null);
  // An agent's write on the feed (not yet swapped in) or the version on screen, if recent.
  const pendingAgent = $derived.by(() => {
    const pending = live?.change;
    return pending &&
      pending.op !== "comment" &&
      (pending.by?.agent || !pending.actor.startsWith("human:"))
      ? pending
      : null;
  });
  const writer = $derived(
    pendingAgent ? props.name(pendingAgent.actor, pendingAgent.by ?? null) : who?.agent ? who : null,
  );
  const at = $derived(
    pendingAgent ? Date.parse(pendingAgent.ts) : who?.agent && author ? Date.parse(author.ts) : null,
  );

  // True until `at` is EDITING_MS old, turning false on its own when it is.
  let now = $state(Date.now());
  const since = $derived(props.current ? at : null);
  $effect(() => {
    const ts = since;
    if (ts === null) return;
    const left = ts + EDITING_MS - Date.now();
    if (left <= 0) return;
    now = Date.now();
    const timer = setTimeout(() => {
      now = Date.now();
    }, left + 50);
    return () => clearTimeout(timer);
  });
  const editing = $derived(since !== null && now - since < EDITING_MS && writer !== null);
  // The agent is named once: when the one writing now wrote the version on screen, "editing
  // now" follows its name; another writer is named in that clause.
  const same = $derived(writer !== null && who !== null && actorText(writer) === actorText(who));
</script>

{#snippet sep()}<span class="byline-sep" aria-hidden="true">·</span>{/snippet}
{#if !who || !author}
  <div class="byline"><StatusPills status={props.status ?? null} stale={props.concept.stale} /></div>
{:else}
  <div class="byline"
    ><Avatar name={who.mark} agent={who.agent} /><span class="byline-name"><AgentName {who} /></span
    >{#if editing && writer}{@render sep()}<span class="byline-live" role="status"
        ><span class="change-dot live" aria-hidden="true"></span>{same ? "editing now" : `${actorText(writer)} is editing now`}</span
      >{/if}{@render sep()}<span class="muted">edited <Moment ts={author.ts} /></span
    ><StatusPills status={props.status ?? null} stale={props.concept.stale} /></div>
{/if}
