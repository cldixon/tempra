import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { prefetchFile } from "./prefetch";
import { readRecent } from "./recent";
import { navigate } from "./router";
import type { OutlineFile } from "./Tree";
import type { Urls } from "./urls";

interface Hit {
  path: string;
  title: string;
}

const MAX = 12;

/**
 * The quick switcher (tempra-dev: app/workspace): Ctrl or Cmd+K, type a title or path, Enter.
 * Recent files first, then titles and paths from the library's index (instant), then the
 * library's search inside files. Escape, the same keys, Close or a click outside the box closes it.
 */
export function Switcher(props: {
  urls: Urls;
  index: OutlineFile[];
  open: boolean;
  onClose(): void;
}) {
  const { urls, open, onClose } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const listId = useId();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Hit[]>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setQ("");
      setFound([]);
      setIndex(0);
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  // Search inside files as the person types: every word a prefix, as an editor's quick open does.
  useEffect(() => {
    const words = q.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      setFound([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      const query = words.map((w) => `${w.replace(/[*"]/g, "")}*`).join(" ");
      api<{ results: Hit[] }>(urls.api("search", { q: query, limit: 10 }))
        .then((r) => live && setFound(r.results))
        .catch(() => live && setFound([]));
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, urls]);

  const needle = q.trim().toLowerCase();
  const hits = useMemo(() => {
    const matches = (h: Hit) =>
      !needle || h.title.toLowerCase().includes(needle) || h.path.toLowerCase().includes(needle);
    const recent = readRecent(urls).filter(matches);
    const named = needle
      ? props.index
          .map((f) => ({ path: f.path, title: f.title ?? "" }))
          .filter(matches)
          // Names that start with what was typed come first.
          .sort(
            (a, b) =>
              Number(!(a.title || a.path).toLowerCase().startsWith(needle)) -
                Number(!(b.title || b.path).toLowerCase().startsWith(needle)) ||
              a.path.localeCompare(b.path),
          )
      : [];
    const out: Hit[] = [];
    for (const h of [...recent, ...named, ...found]) {
      if (out.length === MAX) break;
      if (!out.some((o) => o.path === h.path)) out.push(h);
    }
    return out;
  }, [needle, urls, props.index, found]);
  const selected = Math.min(index, Math.max(hits.length - 1, 0));

  // The selected file starts loading, so Enter opens a page that is already here.
  const pick = hits[selected]?.path;
  useEffect(() => {
    if (open && pick) prefetchFile(urls, pick);
  }, [open, pick, urls]);

  const go = (hit: Hit | undefined) => {
    if (!hit) return;
    onClose();
    navigate(urls.file(hit.path));
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.max(0, Math.min(i + 1, hits.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(hits[selected]);
    } else if (e.key === "Escape") {
      // A search box would only clear itself on the first Escape; this one closes.
      e.preventDefault();
      onClose();
    }
  };
  const optionId = (i: number) => `${listId}-${i}`;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes it from the keyboard.
    <dialog
      ref={dialog}
      className="switcher"
      aria-label="Open a file"
      // The close event comes a moment after the dialog closes; if it opened again meanwhile
      // (the keys pressed twice quickly), the late event must not close it.
      onClose={(e) => {
        if (!e.currentTarget.open) onClose();
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog itself, outside its box.
        const r = e.currentTarget.getBoundingClientRect();
        const inside =
          e.clientX >= r.left &&
          e.clientX <= r.right &&
          e.clientY >= r.top &&
          e.clientY <= r.bottom;
        if (e.target === e.currentTarget && !inside) onClose();
      }}
    >
      <div className="switcher-head">
        <input
          type="search"
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls={listId}
          aria-activedescendant={hits.length > 0 ? optionId(selected) : undefined}
          aria-autocomplete="list"
          placeholder={`Open a file in ${urls.slug}`}
          aria-label="File title or path"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIndex(0);
          }}
          onKeyDown={keys}
        />
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div id={listId} role="listbox" aria-label="Files">
        {hits.map((h, i) => (
          // The input keeps the keyboard (combobox); a click opens the file too.
          // biome-ignore lint/a11y/useKeyWithClickEvents: keys go to the combobox input above.
          <div
            key={h.path}
            id={optionId(i)}
            role="option"
            tabIndex={-1}
            aria-selected={i === selected}
            onClick={() => go(h)}
          >
            {h.title || h.path} <span className="muted small">{h.path}</span>
          </div>
        ))}
      </div>
      {hits.length === 0 && (
        <p className="muted small">{needle ? "No file matches." : "Type a title or path."}</p>
      )}
    </dialog>
  );
}
