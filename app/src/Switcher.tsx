import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { readRecent } from "./recent";
import { navigate } from "./router";
import type { Urls } from "./urls";

interface Hit {
  path: string;
  title: string;
}

/**
 * The quick switcher (tempra-dev: app/workspace): Ctrl or Cmd+K, type a title or path, Enter.
 * Recent files first, then the library's search. Keyboard only; Escape closes it.
 */
export function Switcher({ urls, open, onClose }: { urls: Urls; open: boolean; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
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

  // Search as the person types: every word a prefix, as an editor's quick open does.
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
  const recent = readRecent(urls).filter(
    (r) =>
      !needle || r.title.toLowerCase().includes(needle) || r.path.toLowerCase().includes(needle),
  );
  const hits: Hit[] = [
    ...recent,
    ...found.filter((f) => !recent.some((r) => r.path === f.path)),
  ].slice(0, 12);
  const selected = Math.min(index, Math.max(hits.length - 1, 0));

  const go = (hit: Hit | undefined) => {
    if (!hit) return;
    onClose();
    navigate(urls.file(hit.path));
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(hits[selected]);
    }
  };

  return (
    <dialog ref={dialog} className="switcher" aria-label="Open a file" onClose={onClose}>
      <input
        type="search"
        placeholder={`Open a file in ${urls.slug}`}
        aria-label="File title or path"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setIndex(0);
        }}
        onKeyDown={keys}
      />
      <ul aria-label="Files">
        {hits.map((h, i) => (
          <li key={h.path} aria-current={i === selected ? "true" : undefined}>
            {/* The input keeps the keyboard; a click opens the file too. */}
            <button type="button" tabIndex={-1} onClick={() => go(h)}>
              {h.title || h.path} <span className="muted small">{h.path}</span>
            </button>
          </li>
        ))}
        {hits.length === 0 && (
          <li className="muted small">{needle ? "No file matches." : "Type a title or path."}</li>
        )}
      </ul>
    </dialog>
  );
}
