<script lang="ts">
  /** A diagram in the full-screen view, drawn again at the view's size; its source if it fails. */
  import { drawDiagram, fenceAlt, figureLang, svgDesc } from "./diagram";
  import type { DiagramFigure } from "./prepare";

  let { figure }: { figure: DiagramFigure } = $props();
  let failed = $state<string | null>(null);
  const fail = (source: string) => {
    failed = source;
  };
  const lang = $derived(figureLang(figure.node.lang));
  const alt = $derived(fenceAlt(lang, figure.node.meta, figure.source));
  const desc = $derived(svgDesc(lang, figure.source));
  const descId = $props.id();
  // Named as in the page: its alt, else its caption (C-28), else what it is.
  const name = $derived(
    alt ?? figure.caption ?? (lang === "svg" ? "SVG" : lang === "vega-lite" ? "Chart" : "Diagram"),
  );
</script>

{#if failed === figure.source}
  <pre class="lightbox-source"><code>{figure.source}</code></pre>
{:else}
  <div
    class="lightbox-diagram"
    role="img"
    aria-label={name}
    aria-describedby={desc ? descId : undefined}
    {@attach drawDiagram(figure.source, `lb${figure.n}-`, fail, lang, figure.chart)}
  ></div>
  {#if desc}<span class="visually-hidden" id={descId}>{desc}</span>{/if}
{/if}
