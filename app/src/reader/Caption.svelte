<script lang="ts">
  /** A figure's caption: its number, then its text when it has one. Not part of the text. */
  import FromHosts from "./FromHosts.svelte";
  import type { Figure } from "./prepare";

  let { figure, id }: { figure: Figure; id?: string } = $props();
</script>

<!-- Drawn inside its figure (Blocks.svelte, Diagram.svelte). -->
<!-- svelte-ignore a11y_figcaption_parent -->
<figcaption data-skip="" {id}
  ><span class="figure-number">Figure {figure.n}.</span
  >{#if figure.caption}{` ${figure.caption}`}{/if}{#if figure.kind === "image"}<FromHosts
      figures={[figure]}
    />{/if}</figcaption
>
