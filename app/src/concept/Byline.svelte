<script lang="ts">
  import AgentName from "../AgentName.svelte";
  import Avatar from "../Avatar.svelte";
  import { type ActedBy, actorText } from "../agents";
  import Moment from "../Moment.svelte";
  import { useNow } from "../ui.svelte.ts";
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
   * what is exceptional: a status that is not stable ("Draft") and "Stale" (TEMPRA-139). While an
   * agent reads the page (presence on the feed, TEMPRA-219), "· reading now" shimmers beside it,
   * the agent named unless it wrote the version on screen ("Claude Code for @ann is reading
   * now"); an agent editing the page now says only that.
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
    /** An agent reading the page now (presence on the feed), if one is. */
    reading?: { actor: string; by: ActedBy | null } | null;
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
    pendingAgent
      ? props.name(pendingAgent.actor, pendingAgent.by ?? null)
      : who?.agent
        ? who
        : null,
  );
  const at = $derived(
    pendingAgent
      ? Date.parse(pendingAgent.ts)
      : who?.agent && author
        ? Date.parse(author.ts)
        : null,
  );

  // True until `at` is EDITING_MS old, turning false on its own when it is: the clock ticks each
  // second while it holds, and slowly otherwise; each tick or new `at` reads the time afresh.
  const since = $derived(props.current ? at : null);
  const now = useNow(() => (recent ? 1000 : 60_000));
  const recent = $derived.by(() => {
    void now.current;
    return since !== null && Date.now() - since < EDITING_MS;
  });
  const editing = $derived(recent && writer !== null);
  // The agent is named once: when the one writing now wrote the version on screen, "editing
  // now" follows its name; another writer is named in that clause.
  const same = $derived(writer !== null && who !== null && actorText(writer) === actorText(who));
  // An agent reading now (TEMPRA-219), on the latest version only; the one editing now is said
  // already.
  const reader = $derived(
    props.current && props.reading ? props.name(props.reading.actor, props.reading.by) : null,
  );
  const readerShown = $derived(
    reader !== null && !(editing && writer !== null && actorText(writer) === actorText(reader)),
  );
  const readerIsAuthor = $derived(
    reader !== null && who !== null && actorText(reader) === actorText(who),
  );
</script>

{#snippet sep()}<span class="byline-sep" aria-hidden="true">·</span>{/snippet}
{#if !who || !author}
  <div class="byline"><StatusPills status={props.status ?? null} stale={props.concept.stale} /></div>
{:else}
  <div class="byline"
    ><Avatar name={who.mark} agent={who.agent} /><span class="byline-name"><AgentName {who} /></span
    >{#if editing && writer}{@render sep()}<span class="byline-live" role="status"
        ><span class="change-dot live" aria-hidden="true"></span>{same ? "editing now" : `${actorText(writer)} is editing now`}</span
      >{/if}{#if readerShown && reader}{@render sep()}<span class="byline-presence"
        >{#if !readerIsAuthor}<AgentName who={reader} />{" "}{/if}<span class="presence-text"
          >{readerIsAuthor ? "reading now" : "is reading now"}</span
        ></span
      >{/if}{@render sep()}<span class="muted">edited <Moment ts={author.ts} /></span
    ><StatusPills status={props.status ?? null} stale={props.concept.stale} /></div>
{/if}
