<script lang="ts">
  import { actorLabel, agentLabel } from "../agents";
  import { useActors } from "../agents.svelte.ts";
  import type { Urls, Who } from "../urls";

  /**
   * Who: Anyone, Agents or People, and in Every event each one who has worked here (one exact
   * actor, filtered by the server). A native select, so it works by keyboard and on a phone.
   */
  let {
    urls,
    view,
    who,
    actor,
    onChange,
  }: {
    urls: Urls;
    view: "summary" | "events";
    who: Who;
    actor: string;
    onChange(who: Who, actor: string): void;
  } = $props();

  const actors = useActors(() => urls);
  const value = $derived(actor ? `actor:${actor}` : who);
  const people = $derived(view === "events" ? actors.contributors : []);

  function change(e: Event & { currentTarget: HTMLSelectElement }) {
    const v = e.currentTarget.value;
    if (v.startsWith("actor:")) onChange("everyone", v.slice("actor:".length));
    else onChange(v as Who, "");
  }
</script>

<select class="pill-select" aria-label="Who" {value} onchange={change}>
  <option value="everyone">Anyone</option>
  <option value="agents">Agents</option>
  <option value="people">People</option>
  {#if people.length > 0}
    <optgroup label="Who worked here">
      {#each people as c (c.actor)}
        <option value={`actor:${c.actor}`}>{agentLabel(c)}</option>
      {/each}
    </optgroup>
  {/if}
  {#if actor && !people.some((c) => c.actor === actor)}
    <option value={`actor:${actor}`}>{actorLabel(actor, null, {})}</option>
  {/if}
</select>
