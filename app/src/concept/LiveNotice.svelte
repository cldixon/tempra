<script lang="ts">
  import { useAgentNames } from "../agents.svelte.ts";
  import { relativeTime } from "../ui";
  import { useNow } from "../ui.svelte.ts";
  import type { Urls } from "../urls";
  import { CONTENT_OPS } from "./data";
  import { changeLine, type Live } from "./live";

  /**
   * A change the cluster cannot show: the open file was moved or deleted (or it is not a concept).
   * A notice on the page, with the way to where it went.
   */
  let { urls, live }: { urls: Urls; live: Live } = $props();
  const names = useAgentNames(() => urls);
  const now = useNow(5000);
  const e = $derived(live.change);
</script>

<div class="notice">{changeLine(e, names.label(e.actor, e.by), relativeTime(e.ts, now.current))} {#if e.op === "move"}<a href={urls.pinned(undefined).file(e.path)}>Open it where it is now</a>{:else if e.op === "delete"}<a href={urls.tree("")}>Home</a>{:else}{#if CONTENT_OPS.has(e.op)}<a href={urls.diff(e.path, live.shownSeq, e.seq)}>Show diff</a> · {/if}<button type="button" onclick={() => live.onSwap()}>Show new version</button>{/if}</div>
