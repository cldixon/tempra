<script lang="ts">
  import { getAllContexts, mount, type Snippet, unmount } from "svelte";
  import Render from "./Render.svelte";

  /**
   * Draws its content into another element, as a portal does: the top bar's slots that a
   * page fills through PageBar. Mounted straight into `target`, with no wrapper, and with this
   * place's contexts.
   */
  let { target, children }: { target: HTMLElement; children: Snippet } = $props();
  const context = getAllContexts();
  $effect(() => {
    const instance = mount(Render, { target, props: { children }, context });
    return () => void unmount(instance);
  });
</script>
