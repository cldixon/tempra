<script lang="ts">
  /**
   * An image in the full-screen view, as large as fits; the broken box once it fails. A video
   * plays here, audio too; a PDF is its card, Open going to its page (TEMPRA-164).
   */
  import { LIGHTBOX_SIZES } from "../images";
  import BrokenImage from "./BrokenImage.svelte";
  import Img from "./Img.svelte";
  import PdfCard from "./PdfCard.svelte";
  import Player from "./Player.svelte";
  import type { ImageFigure } from "./prepare";

  let { figure }: { figure: ImageFigure } = $props();
  let failed = $state<string | null>(null);
</script>

{#if figure.source === null || failed === figure.source.src}
  <BrokenImage {figure} />
{:else if figure.source.kind === "pdf"}
  <PdfCard {figure} />
{:else if figure.source.kind === "video" || figure.source.kind === "audio"}
  {@const source = figure.source}
  <Player
    kind={figure.source.kind}
    {source}
    name={figure.alt || figure.caption || figure.url}
    onError={() => (failed = source.src)}
  />
{:else}
  {@const source = figure.source}
  <Img
    {source}
    alt={figure.alt}
    sizes={LIGHTBOX_SIZES}
    lazy={false}
    onError={() => (failed = source.src)}
  />
{/if}
