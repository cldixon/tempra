<script lang="ts">
  import type { Snippet } from "svelte";

  /** A page's column in the frame (everything but a concept, which lays out its own columns). */
  let { children, wide = false }: { children: Snippet; wide?: boolean } = $props();
</script>

<div class={wide ? "page-column wide" : "page-column"}>{@render children()}</div>
