<script lang="ts">
  import { composing, mentionAt, offered, sendsComment } from "./mentions";

  /**
   * A textarea that offers handles after @; Up and Down choose, Enter or Tab takes one. With
   * `onSend` (every comment box, TEMPRA-223), Enter sends what is written and Shift+Enter is a new
   * line; an empty box sends nothing, and an input method's Enter is its own.
   */
  let {
    value,
    onValue,
    people,
    textarea = $bindable(),
    id: boxId,
    placeholder,
    onkeydown,
    onblur,
    onSend,
  }: {
    value: string;
    onValue(v: string): void;
    people: string[];
    /** The textarea, for a caller that focuses it. */
    textarea?: HTMLTextAreaElement;
    id?: string;
    placeholder?: string;
    onkeydown?(e: KeyboardEvent & { currentTarget: HTMLTextAreaElement }): void;
    onblur?(e: FocusEvent & { currentTarget: HTMLTextAreaElement }): void;
    /** Enter sends: what to do with the text (never called for an empty box). */
    onSend?(): void;
  } = $props();

  let at = $state<{ start: number; query: string } | null>(null);
  let active = $state(0);
  const id = $props.id();
  const options = $derived(at ? offered(people, at.query) : []);
  const open = $derived(options.length > 0);

  function update(el: HTMLTextAreaElement) {
    const next = mentionAt(el.value, el.selectionStart);
    if (next?.query !== at?.query) active = 0;
    at = next;
  }
  function take(handle: string) {
    const el = textarea;
    if (!el || !at) return;
    const caret = at.start + handle.length + 2;
    const next = `${value.slice(0, at.start)}@${handle} ${value.slice(el.selectionStart)}`;
    onValue(next);
    at = null;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }
  function keys(e: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) {
    if (open && !composing(e)) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        active = (active + step + options.length) % options.length;
        return;
      }
      // A name typed out in full ("…? @tempra") is already chosen: Enter sends rather than taking
      // it again (TEMPRA-224); Tab still completes it.
      const typed = !!at && at.query.toLowerCase() === options[active]?.toLowerCase();
      if (e.key === "Tab" || (e.key === "Enter" && !(typed && onSend))) {
        e.preventDefault();
        take(options[active] ?? "");
        return;
      }
      if (e.key === "Escape") {
        // Closes the list only, not the draft around it.
        e.preventDefault();
        e.stopPropagation();
        at = null;
        return;
      }
    }
    if (onSend && sendsComment(e)) {
      e.preventDefault();
      if (value.trim()) onSend();
      return;
    }
    onkeydown?.(e);
  }
</script>

<div class="mention-box"
  ><textarea
    bind:this={textarea}
    id={boxId}
    {placeholder}
    {value}
    role="combobox"
    aria-expanded={open}
    aria-controls={id}
    aria-autocomplete="list"
    aria-activedescendant={open ? `${id}-${active}` : undefined}
    oninput={(e) => {
      onValue(e.currentTarget.value);
      update(e.currentTarget);
    }}
    onkeydown={keys}
    onkeyup={(e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") update(e.currentTarget);
    }}
    onblur={(e) => {
      // A click on an option lands first (pointerdown keeps the focus).
      at = null;
      onblur?.(e);
    }}
  ></textarea
  >{#if open}<div {id} role="listbox" aria-label="People" class="menu-list start mention-list"
      >{#each options as h, i (h)}<button
          id={`${id}-${i}`}
          type="button"
          role="option"
          aria-selected={i === active}
          tabindex="-1"
          onpointerdown={(e) => {
            e.preventDefault();
            take(h);
          }}>@{h}</button
        >{/each}</div
    >{/if}</div
>
