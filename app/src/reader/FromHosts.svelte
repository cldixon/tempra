<script lang="ts">
  /**
   * The quiet line under a caption naming where external images load from: "From example.com".
   * Never part of the text, even in a caption that holds footnote markers.
   */
  import type { ImageFigure } from "./prepare";

  let { figures }: { figures: ImageFigure[] } = $props();
  const hosts = $derived([...new Set(figures.map((f) => f.host).filter((h) => h !== null))]);
</script>

{#if hosts.length > 0}<span class="figure-source" data-skip="">From {hosts.join(", ")}</span>{/if}
