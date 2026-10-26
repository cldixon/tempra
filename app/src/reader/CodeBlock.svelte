<script lang="ts">
  /** The default code block: the text, with the fence's language as a quiet label (CSS only). */
  import type { Code } from "mdast";
  import type { BlockProps } from "./registry";

  let { node, id, offset, text }: BlockProps<Code> = $props();
</script>

<pre data-block={id} data-text={offset} data-lang={node.lang ?? undefined}><code
    >{@render text?.()}</code
  ></pre>
