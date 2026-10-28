<script lang="ts">
  /**
   * A figure's caption: its number, then its text when it has one. Not part of the text. `notes`,
   * an image's footnote markers (TEMPRA-218), end it: they are the text's atoms, so then only the
   * number, the words and the image's site are marked `data-skip`, not the caption.
   */
  import type { Snippet } from "svelte";
  import FromHosts from "./FromHosts.svelte";
  import type { Figure } from "./prepare";

  let { figure, id, notes }: { figure: Figure; id?: string; notes?: Snippet } = $props();
</script>

{#snippet words()}<span class="figure-number">Figure {figure.n}.</span
  >{#if figure.caption}{` ${figure.caption}`}{/if}{/snippet}

<!-- Drawn inside its figure (Blocks.svelte, Diagram.svelte). -->
{#if notes}
  <!-- svelte-ignore a11y_figcaption_parent -->
  <figcaption {id}
    ><span data-skip="">{@render words()}</span>{@render notes()}{#if figure.kind === "image"}<FromHosts
        figures={[figure]}
      />{/if}</figcaption
  >
{:else}
  <!-- svelte-ignore a11y_figcaption_parent -->
  <figcaption data-skip="" {id}
    >{@render words()}{#if figure.kind === "image"}<FromHosts figures={[figure]} />{/if}</figcaption
  >
{/if}
