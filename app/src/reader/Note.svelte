<script lang="ts">
  /** Content beside the body (a footnote definition), drawn the same way, outside the text. */
  import type { RootContent } from "mdast";
  import Blocks from "./Blocks.svelte";
  import { noteBlocks } from "./body";
  import type { Prepared } from "./prepare";
  import { node } from "./registry";

  let { prepared, nodes }: { prepared: Prepared; nodes: readonly RootContent[] } = $props();
  const blocks = $derived(noteBlocks(prepared, nodes, (type) => type in node));
</script>

<Blocks {blocks} />
