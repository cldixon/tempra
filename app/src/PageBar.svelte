<script lang="ts">
  import type { Snippet } from "svelte";
  import { useFrame } from "./frame.svelte.ts";
  import Portal from "./Portal.svelte";

  /**
   * A page's part of the top bar: its path (a concept's folders and title, TEMPRA-145) and its
   * tools (a concept's ⋯), drawn into the bar's slots from wherever the page is. On a phone the
   * bar names no page and no path: the page's own title does (TEMPRA-140).
   */
  let props: {
    path?: Snippet;
    actions?: Snippet;
    /** On a phone the tools take the place of the bell (a concept's, board 33). */
    phoneTools?: boolean;
  } = $props();
  const frame = useFrame();
  const tools = $derived(props.phoneTools === true && props.actions !== undefined);
  $effect.pre(() => {
    if (!tools) return;
    frame.setOwnTools(true);
    return () => frame.setOwnTools(false);
  });
</script>

{#if props.path && frame.slots.path}<Portal target={frame.slots.path}>{@render props.path()}</Portal>{/if}{#if props.actions && frame.slots.tools}<Portal target={frame.slots.tools}>{@render props.actions()}</Portal>{/if}
