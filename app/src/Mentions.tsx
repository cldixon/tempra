import { type KeyboardEvent, type TextareaHTMLAttributes, useId, useRef, useState } from "react";
import { api, useLoad } from "./api";
import type { Urls } from "./urls";

/*
 * Mentions in the comment box (TEMPRA-73): typing @ offers the people who can reach the library
 * (its owner and members) and its managed agent once there is one; the server resolves what was
 * written when the comment is posted. Looks come from the menu list in @tempra/design.
 */

/** The handles a comment here can mention: the library's owner and members. */
export function useMentionable(urls: Urls): string[] {
  const loaded = useLoad(`members ${urls.owner}/${urls.slug}`, () =>
    api<{ owner: string; members: { handle: string }[] }>(urls.api("members")),
  );
  if (loaded.state !== "ready") return [];
  return [loaded.data.owner, ...loaded.data.members.map((m) => m.handle)];
}

/** The @word being typed just before the caret, if any: where it starts and what it says. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|[\s(])@([a-z0-9_-]*)$/i.exec(text.slice(0, caret));
  if (!m) return null;
  const query = m[2] ?? "";
  return { start: caret - query.length - 1, query: query.toLowerCase() };
}

/** The handles offered for a query: those starting with it, the exact one last, a few at most. */
export function offered(people: string[], query: string): string[] {
  return people
    .filter((h, i) => people.indexOf(h) === i && h.toLowerCase().startsWith(query))
    .sort((a, b) => Number(a === query) - Number(b === query) || a.localeCompare(b))
    .slice(0, 6);
}

/** A textarea that offers handles after @; Up and Down choose, Enter or Tab takes one. */
export function MentionArea(
  props: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
    value: string;
    onValue(v: string): void;
    people: string[];
    inputRef?: React.Ref<HTMLTextAreaElement>;
  },
) {
  const { value, onValue, people, inputRef, onKeyDown, ...rest } = props;
  const box = useRef<HTMLTextAreaElement | null>(null);
  const [at, setAt] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const id = useId();
  const options = at ? offered(people, at.query) : [];
  const open = options.length > 0;
  const update = (el: HTMLTextAreaElement) => {
    const next = mentionAt(el.value, el.selectionStart);
    if (next?.query !== at?.query) setActive(0);
    setAt(next);
  };
  const take = (handle: string) => {
    const el = box.current;
    if (!el || !at) return;
    const caret = at.start + handle.length + 2;
    const next = `${value.slice(0, at.start)}@${handle} ${value.slice(el.selectionStart)}`;
    onValue(next);
    setAt(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((a) => (a + step + options.length) % options.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        take(options[active] ?? "");
        return;
      }
      if (e.key === "Escape") {
        // Closes the list only, not the draft around it.
        e.preventDefault();
        e.stopPropagation();
        setAt(null);
        return;
      }
    }
    onKeyDown?.(e);
  };
  return (
    <div className="mention-box">
      <textarea
        {...rest}
        ref={(el) => {
          box.current = el;
          if (typeof inputRef === "function") inputRef(el);
          else if (inputRef)
            (inputRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
        }}
        value={value}
        role="combobox"
        aria-expanded={open}
        aria-controls={id}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onChange={(e) => {
          onValue(e.currentTarget.value);
          update(e.currentTarget);
        }}
        onKeyDown={keys}
        onKeyUp={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") update(e.currentTarget);
        }}
        onBlur={(e) => {
          // A click on an option lands first (pointerdown keeps the focus).
          setAt(null);
          rest.onBlur?.(e);
        }}
      />
      {open && (
        <div id={id} role="listbox" aria-label="People" className="menu-list start mention-list">
          {options.map((h, i) => (
            <button
              key={h}
              id={`${id}-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              tabIndex={-1}
              onPointerDown={(e) => {
                e.preventDefault();
                take(h);
              }}
            >
              @{h}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
