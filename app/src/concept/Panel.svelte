<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "../Icon.svelte";
  import { DRAG_TO_CLOSE, PANEL_TITLES, type PanelName } from "./panel";

  /**
   * A panel's frame: its title, a count where it has one, and ×. On a narrow page it overlays the
   * page, and on a phone it is a sheet from the bottom with a drag handle, the page dimmed behind
   * it (the stylesheet's call; take 4, board 35).
   */
  let props: {
    name: PanelName;
    count?: string | null;
    onClose(): void;
    children: Snippet;
  } = $props();
  const title = $derived(PANEL_TITLES[props.name]);
  // On a phone the sheet's head is a handle too: dragged down far enough, the sheet closes.
  let drag: { id: number; y: number } | null = null;
</script>

<aside class={`concept-panel panel-${props.name}`} aria-label={title} id={`panel-${props.name}`}
  ><!-- svelte-ignore a11y_no_static_element_interactions --><header
    class="panel-head"
    onpointerdown={(e) => {
      if (e.pointerType === "mouse" || (e.target as Element).closest("button")) return;
      drag = { id: e.pointerId, y: e.clientY };
    }}
    onpointerup={(e) => {
      const from = drag;
      drag = null;
      if (from && from.id === e.pointerId && e.clientY - from.y > DRAG_TO_CLOSE) props.onClose();
    }}
    onpointercancel={() => {
      drag = null;
    }}
    ><span class="panel-grip" aria-hidden="true"></span
    ><!-- Takes the focus when the person opens the panel (C-25). --><h2 tabindex="-1">{title}</h2
    >{#if props.count}<span class="count">{props.count}</span>{/if}<button
      type="button"
      class="icon-button touch"
      aria-label={`Close ${title.toLowerCase()}`}
      title="Close"
      onclick={() => props.onClose()}><Icon name="close" /></button
    ></header
  ><div class="panel-body">{@render props.children()}</div></aside
>
