<script lang="ts">
  import { useFeedStatus } from "./live.svelte.ts";
  import type { Urls } from "./urls";

  /**
   * "Reconnecting…", quietly, while the library's feed is trying to get back (F-19): a page then
   * stops following agents' writes until it does. Nothing while the feed is live.
   */
  let { urls }: { urls: Urls } = $props();
  const status = useFeedStatus(() => urls);
</script>

<span class="feed-status" role="status">{status.current === "reconnecting" ? "Reconnecting…" : ""}</span>
