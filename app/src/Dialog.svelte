<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import { modal } from "./modal";

  /**
   * A small modal dialog in the top layer: a title, a close button, its content. Escape, the
   * close button or a click on the backdrop closes it, and the focus goes back where it was.
   */
  let props: {
    title: string;
    open: boolean;
    onClose(): void;
    wide?: boolean;
    children: Snippet;
  } = $props();
  const titleId = $props.id();
</script>

<!-- A click on the backdrop lands on the dialog itself, outside its content: it closes. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
  {@attach modal(() => props.open)}
  class={props.wide ? "dialog wide" : "dialog"}
  aria-labelledby={titleId}
  onclose={() => props.onClose()}
  onclick={(e) => {
    if (e.target === e.currentTarget) props.onClose();
  }}
>
  {#if props.open}
    <div class="dialog-box">
      <div class="dialog-head">
        <h2 id={titleId}>{props.title}</h2>
        <button type="button" class="icon-button touch" aria-label="Close" title="Close" onclick={() => props.onClose()}>
          <Icon name="close" />
        </button>
      </div>
      <div class="dialog-body">{@render props.children()}</div>
    </div>
  {/if}
</dialog>
