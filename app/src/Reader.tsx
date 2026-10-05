import type { Parsed, WordDiff } from "@tempra/editor";
import {
  type Highlight,
  type Hovered,
  mountReader,
  type Reader as ReaderHandle,
} from "@tempra/editor/view";
import { type RefObject, useEffect, useRef } from "react";

/** The page's CSP nonce, which the SPA shell puts in a meta tag for Wordgard's styles. */
function nonce(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content ?? "";
}

/**
 * A concept body in Wordgard, read-only (tempra-dev: app/reader). The editor's DOM is Wordgard's:
 * React only gives it a place, and mounts it again when what it shows changes.
 */
export function Reader(props: {
  parsed: Parsed;
  tooltip(hovered: Hovered): HTMLElement | null | Promise<HTMLElement | null>;
  diff: WordDiff | null;
  hideFirst: boolean;
  /** Ranges to highlight (comment quotes); changing them does not redraw the body. */
  highlights?: readonly Highlight[];
  /** A highlight was clicked. */
  onMark?(id: string): void;
  /** Set to the mounted reader, for its selection. */
  handle?: RefObject<ReaderHandle | null>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const tooltip = useRef(props.tooltip);
  tooltip.current = props.tooltip;
  const onMark = useRef(props.onMark);
  onMark.current = props.onMark;
  const highlights = useRef(props.highlights);
  highlights.current = props.highlights;
  const current = useRef<ReaderHandle | null>(null);
  const { parsed, diff, hideFirst, handle } = props;
  useEffect(() => {
    if (!host.current) return;
    const reader = mountReader({
      parent: host.current,
      parsed,
      nonce: nonce(),
      tooltip: (h) => tooltip.current(h),
      diff,
      hideFirst,
      onMark: (id) => onMark.current?.(id),
    });
    current.current = reader;
    if (handle) handle.current = reader;
    if (highlights.current?.length) reader.highlight(highlights.current);
    return () => {
      reader.destroy();
      current.current = null;
      if (handle) handle.current = null;
    };
  }, [parsed, diff, hideFirst, handle]);
  useEffect(() => {
    current.current?.highlight(props.highlights ?? []);
  }, [props.highlights]);
  return <div className="body" ref={host} />;
}

/** A small DOM builder for tooltips, which live in Wordgard's DOM rather than React's. */
export function el(
  tag: string,
  attrs: Record<string, string> = {},
  ...children: (Node | string | null | false)[]
): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) if (c) node.append(c);
  return node;
}
