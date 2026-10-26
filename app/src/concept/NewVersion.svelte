<script lang="ts">
  import { useAgentNames } from "../agents.svelte.ts";
  import Icon from "../Icon.svelte";
  import Menu from "../Menu.svelte";
  import { relativeTime } from "../ui";
  import { useNow } from "../ui.svelte.ts";
  import type { Urls } from "../urls";
  import { CONTENT_OPS } from "./data";
  import { changeLine, type Live } from "./live";

  /**
   * A newer version, in the cluster: a pulsing glyph that opens who wrote it, Show diff and Show
   * new version.
   */
  let { urls, live }: { urls: Urls; live: Live } = $props();
  const names = useAgentNames(() => urls);
  const now = useNow(5000);
  const e = $derived(live.change);
  const by = $derived(names.label(e.actor, e.by));
</script>

<div class="new-version">
  <Menu name="New version" title={`New version · ${by}${e.note ? ` · ${e.note}` : ""}`} buttonClass="icon-button" align="end">
    {#snippet label()}<Icon name="refresh" />{/snippet}<p>{changeLine(e, by, relativeTime(e.ts, now.current))}</p>{#if CONTENT_OPS.has(e.op)}<a href={urls.diff(e.path, live.shownSeq, e.seq)}>Show diff</a>{/if}<button type="button" onclick={() => live.onSwap()}>Show new version</button>
  </Menu>
</div>
