<script lang="ts">
  /** A diagram in the full-screen view, drawn again at the view's size; its source if it fails. */
  import { fenceAttr } from "@tempra/editor/doc";
  import { drawDiagram, svgTitle } from "./diagram";
  import type { DiagramFigure } from "./prepare";

  let { figure }: { figure: DiagramFigure } = $props();
  let failed = $state<string | null>(null);
  const fail = (source: string) => {
    failed = source;
  };
  const svg = $derived(figure.node.lang?.toLowerCase() === "svg");
  const alt = $derived(
    svg ? (fenceAttr(figure.node.meta, "alt") ?? svgTitle(figure.source)) : null,
  );
</script>

{#if failed === figure.source}
  <pre class="lightbox-source"><code>{figure.source}</code></pre>
{:else}
  <div
    class="lightbox-diagram"
    role="img"
    aria-label={alt ?? (svg ? "SVG" : "Diagram")}
    {@attach drawDiagram(figure.source, `lb${figure.n}-`, fail, svg ? "svg" : "mermaid")}
  ></div>
{/if}
