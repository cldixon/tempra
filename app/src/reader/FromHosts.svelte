<script lang="ts">
  /** The quiet line under a caption naming where external images load from: "From example.com". */
  import type { ImageFigure } from "./prepare";

  let { figures }: { figures: ImageFigure[] } = $props();
  const hosts = $derived([...new Set(figures.map((f) => f.host).filter((h) => h !== null))]);
</script>

{#if hosts.length > 0}<span class="figure-source">From {hosts.join(", ")}</span>{/if}
