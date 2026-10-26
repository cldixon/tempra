<script lang="ts">
  /** A video figure (TEMPRA-164), the registry's `media.video`. */
  import MediaFigure from "./MediaFigure.svelte";
  import type { MediaProps } from "./registry";

  let { figure }: MediaProps = $props();
</script>

<MediaFigure {figure} kind="video" />
