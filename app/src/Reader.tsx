import type { Parsed, WordDiff } from "@tempra/editor";
import { type Hovered, mountReader } from "@tempra/editor/view";
import { useEffect, useRef } from "react";

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
}) {
  const host = useRef<HTMLDivElement>(null);
  const tooltip = useRef(props.tooltip);
  tooltip.current = props.tooltip;
  const { parsed, diff, hideFirst } = props;
  useEffect(() => {
    if (!host.current) return;
    const reader = mountReader({
      parent: host.current,
      parsed,
      nonce: nonce(),
      tooltip: (h) => tooltip.current(h),
      diff,
      hideFirst,
    });
    return () => reader.destroy();
  }, [parsed, diff, hideFirst]);
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
