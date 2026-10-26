<script lang="ts">
  /** A figure's image, or its video, audio or PDF through the registry (TEMPRA-164). */
  import FigureImage from "./FigureImage.svelte";
  import type { ImageFigure } from "./prepare";
  import { media } from "./registry";

  let { figure }: { figure: ImageFigure } = $props();
  const Media = $derived(figure.source?.kind ? media[figure.source.kind] : undefined);
</script>

{#if Media}<Media {figure} />{:else}<FigureImage {figure} />{/if}
