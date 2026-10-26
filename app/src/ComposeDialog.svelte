<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import { modal } from "./modal";

  /**
   * A dialog that makes something (a new library): anchored high over the page, its context and
   * what it makes at the top ("@ann › New library"), then the form's own fields (a large
   * borderless name, a description; `.compose-title`, `.compose-text`), a row of smaller
   * fields, and the action at the foot. Ctrl/Cmd+Enter submits; Escape, × or a click beside it
   * cancels.
   */
  let props: {
    open: boolean;
    onClose(): void;
    /** Where the new thing goes, shown as a chip before the title. */
    context: Snippet;
    title: string;
    action: string;
    busy?: boolean;
    error?: string | null;
    onSubmit(e: SubmitEvent & { currentTarget: HTMLFormElement }): void;
    /** The row under the main fields: small labelled fields (`.compose-field`). */
    fields?: Snippet;
    children: Snippet;
  } = $props();
  const titleId = $props.id();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
  {@attach modal(() => props.open)}
  class="dialog compose"
  aria-labelledby={titleId}
  onclose={() => props.onClose()}
  onclick={(e) => {
    if (e.target === e.currentTarget) props.onClose();
  }}
>
  {#if props.open}
    <form
      class="compose-form"
      onsubmit={(e) => props.onSubmit(e)}
      onkeydown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          e.currentTarget.requestSubmit();
        }
      }}
    >
      <div class="compose-head">
        <span class="compose-context">{@render props.context()}</span>
        <Icon name="chevron" />
        <h2 id={titleId}>{props.title}</h2>
        <button type="button" class="icon-button touch" aria-label="Close" title="Close" onclick={() => props.onClose()}>
          <Icon name="close" />
        </button>
      </div>
      <div class="compose-body">{@render props.children()}</div>
      {#if props.fields}<div class="compose-fields">{@render props.fields()}</div>{/if}
      {#if props.error}<p class="notice" role="alert">{props.error}</p>{/if}
      <div class="compose-foot">
        <button type="button" class="ghost" onclick={() => props.onClose()}>Cancel</button>
        <button type="submit" class="primary" disabled={props.busy}>{props.action}</button>
      </div>
    </form>
  {/if}
</dialog>
