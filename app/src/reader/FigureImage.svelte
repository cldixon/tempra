<script lang="ts">
  /**
   * A figure's image (tempra-dev: app/reader, Figures): a button opening the full-screen view
   * (Lightbox.svelte), or the broken box once it fails.
   *
   * The image is the paragraph's one atom: whatever is drawn for it (a button, the image, the box)
   * is one element marked `data-atom`, so it counts one character as `docText` does. The caption
   * sits outside the paragraph's `data-text` element and is marked `data-skip`: it is not the
   * document's text, so selections, comment anchors and the diff never count it.
   *
   * Figure markup (`:::figure`, tempra-dev: app/media) draws one to four images in one figure
   * (FigureBox): each image still one atom and one figure in the numbering, a group's images side
   * by side with their titles as small labels (`data-skip`), and one caption, the directive's
   * label.
   *
   * An external image (hotlinked from another site, TEMPRA-163; tempra-dev: app/media) is drawn
   * as any other, with a quiet line under its caption naming the site ("From example.com"); its
   * broken box says it is external, and an inline one names the site in its tooltip.
   */
  import { figureSizes, type ImageSource } from "../images";
  import BrokenImage from "./BrokenImage.svelte";
  import { enlargeName } from "./figure";
  import Img from "./Img.svelte";
  import { useOpenFigure } from "./open-figure";
  import type { ImageFigure } from "./prepare";

  let { figure }: { figure: ImageFigure } = $props();
  const open = useOpenFigure();
  let failed = $state<string | null>(null);
</script>

{#snippet img(source: ImageSource)}<Img
    {source}
    alt={figure.alt}
    sizes={figureSizes(figure.markup?.spec ?? null, figure.markup?.figures.length ?? 1)}
    onError={() => (failed = source.src)}
  />{/snippet}

{#if figure.source === null || failed === figure.source.src}<BrokenImage
    {figure}
    atom
  />{:else}<span class="figure-media" data-atom=""
    >{#if open}<button
        type="button"
        class="figure-open"
        aria-label={enlargeName(figure)}
        onclick={(e) => {
          // Opening a figure is not a click on the text (no thread to open or close).
          e.stopPropagation();
          open(figure.n);
        }}>{@render img(figure.source)}</button
      >{:else}{@render img(figure.source)}{/if}</span
  >{/if}
