<script lang="ts">
  import type { Urls } from "./urls";

  /** An earlier version on screen (`?at=`), said in words, with the way back to the latest. */
  let { urls, head, current }: { urls: Urls; head: number; current: string } = $props();
</script>

{#if urls.at !== undefined && urls.at < head}
  <div class="notice">An earlier version. <a href={current}>Back to latest</a></div>
{/if}
