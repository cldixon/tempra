<script lang="ts">
  /** An audio figure (TEMPRA-164), the registry's `media.audio`. */
  import MediaFigure from "./MediaFigure.svelte";
  import type { MediaProps } from "./registry";

  let { figure }: MediaProps = $props();
</script>

<MediaFigure {figure} kind="audio" />
