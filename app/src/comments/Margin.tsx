import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../chrome";
import { rangeOf } from "../reader/dom";
import { plural } from "../ui";
import type { Urls } from "../urls";
import { type Draft, marginOrder, type Placed } from "./data";
import { stack } from "./layout";
import { NewComment, ThreadView } from "./Thread";

/**
 * A concept's comments (take 3; tempra-dev: app/comments, In the margin): threads beside the text
 * they quote, in a margin inside the sheet that scrolls with it. Where the sheet is too narrow
 * for a margin, the same list is a sheet over the right side of the page, and on a phone a sheet
 * from the bottom; which one is the stylesheet's call (container queries on the sheet), read here
 * as `mode`.
 */

/** How the comments are shown, as the stylesheet decides it for the sheet's width. */
export type CommentsMode = "margin" | "side" | "bottom";

/** The space between two threads in the margin, in pixels. */
const GAP = 10;

export function CommentsMargin(props: {
  urls: Urls;
  path: string;
  mode: CommentsMode;
  placed: Placed[];
  /** The threads could not be loaded (a new comment can still be made). */
  error: string | null;
  writable: boolean;
  draft: Draft | null;
  onDraftDone(): void;
  active: string | null;
  onActive(id: string | null): void;
  onChanged(): void;
  onClose(): void;
  /** The body's text, which quotes are measured in. */
  prose: () => Element | null;
  /** Changes when the body is drawn again (a new version, a diff on or off). */
  drawn: unknown;
}) {
  const { urls, mode, placed, draft, active } = props;
  const open = marginOrder(placed);
  const resolved = placed.filter((t) => t.status === "resolved");
  const [showResolved, setShowResolved] = useState(false);
  const [composing, setComposing] = useState(false);
  const slots = useRef(new Map<string, HTMLElement>());
  const line = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);

  // What the margin shows, in order: a new comment on the whole concept, the open threads with
  // the draft among them by its place in the text, then the resolved ones when asked for.
  type Item = { id: string; from: number | null; to: number | null; node: ReactNode };
  const items: Item[] = [];
  if (composing && !draft) {
    items.push({
      id: "new",
      from: null,
      to: null,
      node: (
        <NewComment
          urls={urls}
          path={props.path}
          draft={null}
          onDone={() => setComposing(false)}
          onPosted={(id) => {
            props.onActive(id);
            props.onChanged();
          }}
        />
      ),
    });
  }
  const threadItem = (t: Placed): Item => ({
    id: t.id,
    from: t.status === "open" ? (t.at?.from ?? null) : null,
    to: t.status === "open" ? (t.at?.to ?? null) : null,
    node: (
      <ThreadView
        urls={urls}
        thread={t}
        active={t.id === active}
        writable={props.writable}
        onActive={props.onActive}
        onChanged={props.onChanged}
      />
    ),
  });
  const draftItem: Item | null = draft
    ? {
        id: "draft",
        from: draft.from,
        to: draft.to,
        node: (
          <NewComment
            urls={urls}
            path={props.path}
            draft={draft}
            onDone={props.onDraftDone}
            onPosted={(id) => {
              props.onActive(id);
              props.onChanged();
            }}
          />
        ),
      }
    : null;
  let drafted = draftItem === null;
  for (const t of open) {
    if (!drafted && draftItem && (t.at?.from ?? -1) > (draftItem.from ?? 0)) {
      items.push(draftItem);
      drafted = true;
    }
    items.push(threadItem(t));
  }
  if (!drafted && draftItem) items.push(draftItem);
  if (showResolved) for (const t of resolved) items.push(threadItem(t));

  // In the margin, each item's top is measured from the text it quotes and pushed down past the
  // one before (layout.ts). Positions go straight to the CSSOM, so laying out never redraws.
  const ids = items.map((i) => `${i.id}:${i.from ?? ""}`).join(" ");
  const layout = useCallback(() => {
    const box = column.current;
    if (!box) return;
    const prose = props.prose();
    if (mode !== "margin" || !prose) {
      box.style.removeProperty("--margin-height");
      return;
    }
    // Tops are in the slots' own box, which starts level with the concept's header.
    const origin = box.getBoundingClientRect().top;
    // The body is not drawn (the Markdown view is on): nothing to sit beside, so the threads
    // stack in order from the top.
    const drawn = prose.getClientRects().length > 0;
    const wants = new Map<string, number>();
    const list = box.querySelectorAll<HTMLElement>("[data-slot]");
    const order: { id: string; want: number; height: number }[] = [];
    for (const el of list) {
      const id = el.dataset.slot ?? "";
      const from = el.dataset.from === undefined ? null : Number(el.dataset.from);
      const to = el.dataset.to === undefined ? null : Number(el.dataset.to);
      const range = drawn && from !== null && to !== null ? rangeOf(prose, from, to) : null;
      const want = range ? range.getBoundingClientRect().top - origin : 0;
      wants.set(id, want);
      order.push({ id, want, height: el.offsetHeight });
    }
    const tops = stack(order, GAP);
    let bottom = 0;
    for (const el of list) {
      const id = el.dataset.slot ?? "";
      const top = Math.round(tops.get(id) ?? 0);
      el.style.setProperty("--slot-y", `${top}px`);
      bottom = Math.max(bottom, top + el.offsetHeight);
    }
    box.style.setProperty("--margin-height", `${Math.ceil(bottom)}px`);
    // The hairline from the active thread's quote to the thread.
    const want = active ? wants.get(active) : undefined;
    const hasQuote = drawn && placed.some((t) => t.id === active && t.at);
    if (line.current) {
      line.current.hidden = !(hasQuote && want !== undefined);
      if (want !== undefined) line.current.style.setProperty("--line-y", `${Math.round(want)}px`);
    }
  }, [mode, props.prose, active, placed]);

  // Again whenever what is shown changes, and when anything changes size: the text reflowing
  // (a resize, a diagram drawn, fonts), or a thread opening or growing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `ids` and `drawn` name what moved.
  useLayoutEffect(layout, [layout, ids, props.drawn, showResolved]);
  useEffect(() => {
    const box = column.current;
    const prose = props.prose();
    if (!box || !prose) return;
    let frame = 0;
    const soon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(layout);
    };
    const watch = new ResizeObserver(soon);
    watch.observe(prose);
    for (const el of box.querySelectorAll("[data-slot]")) watch.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
    };
  });

  // The active thread comes into view (from a highlight clicked in the text, or a link), once
  // its slot is there: a link may name a thread before the threads have loaded.
  const shownActive = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `ids` changes as slots appear.
  useEffect(() => {
    const slot = active ? slots.current.get(active) : undefined;
    if (!active || !slot || shownActive.current === active) return;
    shownActive.current = active;
    slot.scrollIntoView({ block: "nearest" });
  }, [active, ids]);

  const count = open.length;
  return (
    <aside className={`concept-comments ${mode}`} aria-label="Comments" id="comments">
      {mode !== "margin" && (
        <div className="comments-head">
          <h2>Comments</h2>
          <span className="count">{count > 0 ? `${count} open` : ""}</span>
          <button
            type="button"
            className="icon-button touch"
            aria-label="Close comments"
            title="Close"
            onClick={props.onClose}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
      <div className="comments-body">
        {props.error && <p className="small warn">Could not load the comments: {props.error}</p>}
        {props.writable && !composing && !draft && (
          <button type="button" className="ghost new-thread" onClick={() => setComposing(true)}>
            Comment on this concept
          </button>
        )}
        <div ref={column} className="comments-slots">
          <div ref={line} className="thread-line" hidden aria-hidden="true" />
          {items.map((i) => (
            <div
              key={i.id}
              className="slot"
              data-slot={i.id}
              data-from={i.from ?? undefined}
              data-to={i.to ?? undefined}
              ref={(el) => {
                if (el) slots.current.set(i.id, el);
                else slots.current.delete(i.id);
              }}
            >
              {i.node}
            </div>
          ))}
        </div>
        {count === 0 && !draft && !composing && mode !== "margin" && (
          <p className="small muted">No open threads. Select text to comment on it.</p>
        )}
        {resolved.length > 0 && (
          <button
            type="button"
            className="ghost show-resolved"
            aria-expanded={showResolved}
            onClick={() => setShowResolved((s) => !s)}
          >
            {showResolved
              ? "Hide resolved"
              : `Show resolved (${plural(resolved.length, "thread")})`}
          </button>
        )}
      </div>
    </aside>
  );
}
