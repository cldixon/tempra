<script lang="ts">
  /** A PDF figure (TEMPRA-164), the registry's `media.pdf`: its card, as the paragraph's atom. */
  import PdfCard from "./PdfCard.svelte";
  import type { MediaProps } from "./registry";

  let { figure }: MediaProps = $props();
  /** Clicks on the card are not clicks on the text (no thread to open or close). */
  const own = (e: MouseEvent) => e.stopPropagation();
</script>

<!-- The span only keeps the card's clicks its own; its links handle their own keys. -->
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<span class="figure-media" data-atom="" onclick={own}><PdfCard {figure} /></span>
