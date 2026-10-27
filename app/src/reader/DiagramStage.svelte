<script lang="ts">
  /** A diagram in the full-screen view, drawn again at the view's size; its source if it fails. */
  import { drawDiagram, fenceAlt, figureLang } from "./diagram";
  import type { DiagramFigure } from "./prepare";

  let { figure }: { figure: DiagramFigure } = $props();
  let failed = $state<string | null>(null);
  const fail = (source: string) => {
    failed = source;
  };
  const lang = $derived(figureLang(figure.node.lang));
  const alt = $derived(fenceAlt(lang, figure.node.meta, figure.source));
</script>

{#if failed === figure.source}
  <pre class="lightbox-source"><code>{figure.source}</code></pre>
{:else}
  <div
    class="lightbox-diagram"
    role="img"
    aria-label={alt ?? (lang === "svg" ? "SVG" : lang === "vega-lite" ? "Chart" : "Diagram")}
    {@attach drawDiagram(figure.source, `lb${figure.n}-`, fail, lang, figure.chart)}
  ></div>
{/if}
