import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "./api";
import { prefetchFile } from "./prefetch";
import { readRecent } from "./recent";
import { libraryLabel, useLibraries } from "./role";
import { navigate } from "./router";
import type { OutlineFile } from "./Tree";
import { Urls } from "./urls";

interface Hit {
  path: string;
  title: string;
}

/** One row of a quick search: what it reads as, a quiet detail beside it, where it goes. */
interface Option {
  key: string;
  title: string;
  detail: string;
  href: string;
}

const MAX = 12;

/**
 * The quick search's dialog (tempra-dev: app/workspace): a box, the options under it, the
 * keyboard on the box (Up, Down, Enter, Escape); a click outside closes it. What it searches is
 * its caller's: a library's files (Switcher) or the person's libraries (LibrarySearch).
 */
function QuickSearch(props: {
  open: boolean;
  onClose(): void;
  /** "Search <library>", or "Search libraries". */
  label: string;
  q: string;
  onQuery(q: string): void;
  options: Option[];
  /** The option under the cursor (a library's file starts loading). */
  onSelect?(o: Option): void;
  /** What shows when there are no options: a hint, "Searching…", "No results" or an error. */
  empty: string;
  /** A quiet line under the options there are (search inside pages failed: titles only). */
  note?: string | null;
}) {
  const { open, onClose, options, onSelect } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const listId = useId();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setIndex(0);
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  const selected = Math.min(index, Math.max(options.length - 1, 0));
  const pick = options[selected];
  useEffect(() => {
    if (open && pick) onSelect?.(pick);
  }, [open, pick, onSelect]);

  const go = (o: Option | undefined) => {
    if (!o) return;
    onClose();
    navigate(o.href);
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.max(0, Math.min(i + 1, options.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(options[selected]);
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
      aria-label={props.label}
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
          aria-expanded={options.length > 0}
          aria-controls={listId}
          aria-activedescendant={options.length > 0 ? optionId(selected) : undefined}
          aria-autocomplete="list"
          placeholder={props.label}
          aria-label={props.label}
          value={props.q}
          onChange={(e) => {
            props.onQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={keys}
        />
      </div>
      <div id={listId} role="listbox" aria-label="Results">
        {options.map((o, i) => (
          // The input keeps the keyboard (combobox); a click opens the option too.
          // biome-ignore lint/a11y/useKeyWithClickEvents: keys go to the combobox input above.
          <div
            key={o.key}
            id={optionId(i)}
            role="option"
            tabIndex={-1}
            aria-selected={i === selected}
            onClick={() => go(o)}
          >
            {o.title} <span className="muted small">{o.detail}</span>
          </div>
        ))}
      </div>
      <p className="muted small switcher-status" role="status">
        {options.length === 0 ? props.empty : (props.note ?? "")}
      </p>
    </dialog>
  );
}

/**
 * The quick switcher in a library (tempra-dev: app/workspace): Ctrl or Cmd+K, type a title or
 * path, Enter. Recent files first, then titles and paths from the library's index (instant), then
 * the library's search inside files.
 */
export function Switcher(props: {
  urls: Urls;
  /** The library's title (else its slug), as search names itself. */
  name: string;
  index: OutlineFile[];
  open: boolean;
  onClose(): void;
}) {
  const { urls, open } = props;
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Hit[]>([]);
  // Search inside pages (F-12): "Searching…" until the answer, "No results" only after it, and
  // a line when it failed (titles and paths still match from the index).
  const [search, setSearch] = useState<"idle" | "searching" | "done" | "failed">("idle");

  useEffect(() => {
    if (open) {
      setQ("");
      setFound([]);
      setSearch("idle");
    }
  }, [open]);

  // Search inside files as the person types: every word a prefix, as an editor's quick open does.
  useEffect(() => {
    const words = q.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      setFound([]);
      setSearch("idle");
      return;
    }
    let live = true;
    setSearch("searching");
    const t = setTimeout(() => {
      const query = words.map((w) => `${w.replace(/[*"]/g, "")}*`).join(" ");
      api<{ results: Hit[] }>(urls.api("search", { q: query, limit: 10 }))
        .then((r) => {
          if (!live) return;
          setFound(r.results);
          setSearch("done");
        })
        .catch(() => {
          if (!live) return;
          setFound([]);
          setSearch("failed");
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, urls]);

  const needle = q.trim().toLowerCase();
  const options = useMemo(() => {
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
    const out: Option[] = [];
    for (const h of [...recent, ...named, ...found]) {
      if (out.length === MAX) break;
      if (!out.some((o) => o.key === h.path)) {
        out.push({
          key: h.path,
          title: h.title || h.path,
          detail: h.path,
          href: urls.file(h.path),
        });
      }
    }
    return out;
  }, [needle, urls, props.index, found]);

  // The selected file starts loading, so Enter opens a page that is already here.
  const select = useCallback((o: Option) => prefetchFile(urls, o.key), [urls]);

  return (
    <QuickSearch
      open={open}
      onClose={props.onClose}
      label={`Search ${props.name}`}
      q={q}
      onQuery={setQ}
      options={options}
      onSelect={select}
      empty={
        !needle
          ? "Type a title or path."
          : search === "failed"
            ? "Search didn't answer. Try again in a moment."
            : search === "done"
              ? "No results"
              : "Searching…"
      }
      note={search === "failed" ? "Search inside pages didn't answer; titles only." : null}
    />
  );
}

/**
 * Search off a library (the account's pages, TEMPRA-127): the person's libraries by title or
 * owner/slug, from the list the app already has; Enter opens the library's home.
 */
export function LibrarySearch(props: { open: boolean; onClose(): void }) {
  const { open } = props;
  const libs = useLibraries();
  const [q, setQ] = useState("");
  useEffect(() => {
    if (open) setQ("");
  }, [open]);
  const needle = q.trim().toLowerCase();
  const options = useMemo(() => {
    const list = libs.state === "ready" ? libs.data.libraries : [];
    return list
      .filter(
        (l) =>
          !needle ||
          (l.title ?? "").toLowerCase().includes(needle) ||
          `${l.owner}/${l.slug}`.toLowerCase().includes(needle),
      )
      .slice(0, MAX)
      .map((l) => ({
        key: `${l.owner}/${l.slug}`,
        title: libraryLabel(l),
        detail: l.description ?? "",
        href: new Urls(l.owner, l.slug).tree(""),
      }));
  }, [libs, needle]);
  return (
    <QuickSearch
      open={open}
      onClose={props.onClose}
      label="Search libraries"
      q={q}
      onQuery={setQ}
      options={options}
      empty={libs.state !== "ready" ? "Loading libraries…" : "No library matches."}
    />
  );
}
