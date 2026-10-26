<script lang="ts">
  import { localTime, relativeTime } from "./ui";
  import { useNow } from "./ui.svelte.ts";

  /**
   * When something happened, the one way the app draws it (TEMPRA-131): `relativeTime` ("just
   * now", "3 min ago", "yesterday", "Oct 12"), kept current, with the reader's local date and
   * time on hover. `now` is a clock the caller already ticks, if it has one.
   */
  let { ts, now }: { ts: string; now?: number } = $props();
  const ticking = useNow();
</script>

<time datetime={ts} title={localTime(ts)}>{relativeTime(ts, now ?? ticking.current)}</time>
