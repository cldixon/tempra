<script lang="ts">
  /** A diagram in the full-screen view, drawn again at the view's size; its source if it fails. */
  import { drawDiagram } from "./diagram";
  import type { DiagramFigure } from "./prepare";

  let { figure }: { figure: DiagramFigure } = $props();
  let failed = $state<string | null>(null);
  const fail = (source: string) => {
    failed = source;
  };
</script>

{#if failed === figure.source}
  <pre class="lightbox-source"><code>{figure.source}</code></pre>
{:else}
  <div
    class="lightbox-diagram"
    role="img"
    aria-label="Diagram"
    {@attach drawDiagram(figure.source, `lb${figure.n}-`, fail)}
  ></div>
{/if}
