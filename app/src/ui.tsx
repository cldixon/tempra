import { Component, type ReactNode, useEffect, useState } from "react";
import type { ApiError, Loaded } from "./api";
import { AccountMenu, InboxLink } from "./chrome";
import { baseName, type Urls } from "./urls";

/** The person the app acts for (GET /api/v1/me). */
export interface Me {
  email: string;
  handle: string;
  actor: string;
}

/** The account pages' header: Tempra and the avatar's menu. */
export function Header({ me }: { me: Me | null }) {
  return (
    <header className="app-header">
      <a className="brand" href="/">
        Tempra
      </a>
      <span className="spacer" />
      <InboxLink />
      <AccountMenu me={me} />
    </header>
  );
}

/** Sets the document title, as the server pages do: "{title} · Tempra". */
export function useTitle(title: string | null) {
  useEffect(() => {
    if (title) document.title = `${title} · Tempra`;
  }, [title]);
}

/** After a page's data arrives, scrolls to the #fragment the URL names, if any. */
export function useScrollToHash(ready: boolean) {
  useEffect(() => {
    if (!ready || !location.hash) return;
    let id: string;
    try {
      id = decodeURIComponent(location.hash.slice(1));
    } catch {
      // A malformed escape (an agent wrote the link): use the fragment as it is.
      id = location.hash.slice(1);
    }
    document.getElementById(id)?.scrollIntoView();
  }, [ready]);
}

/**
 * Keeps a failure in one page from blanking the app: the page shows an error instead, and the
 * header still works. Keyed by the URL, so moving to another page starts afresh.
 */
export class PageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error(error);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <>
        <h1>Something went wrong</h1>
        <p className="muted">{this.state.error.message}</p>
        <p>
          <a href={location.href}>Reload the page</a>
        </p>
      </>
    );
  }
}

export type Tone = "" | "ok" | "warn" | "bad";

export function Chip({ text, tone = "", title }: { text: string; tone?: Tone; title?: string }) {
  return (
    <span className={tone ? `chip ${tone}` : "chip"} title={title}>
      {text}
    </span>
  );
}

export function TrustChip({ tier }: { tier: string | undefined }) {
  if (tier === "human-reviewed") {
    return <Chip text="human-reviewed" tone="ok" title="A human verified this version" />;
  }
  if (tier === "machine-confirmed") {
    return <Chip text="machine-confirmed" title="A process re-checked this version" />;
  }
  return <Chip text="unverified" tone="warn" title="Nobody has verified this version" />;
}

/** An actor as a person reads it: a handle for a person (`human:cl_dixon` → `cl_dixon`), an agent as is. */
export const who = (actor: string) => actor.replace(/^human:/, "");

const AGO_UNITS: [number, string][] = [
  [86_400, "d"],
  [3600, "h"],
  [60, "min"],
  [1, "s"],
];

/** How long ago, in one unit: "4 s", "3 min", "2 h", "5 d". */
export function ago(ts: string, now: number): string {
  const secs = Math.max(0, Math.round((now - Date.parse(ts)) / 1000));
  for (const [size, unit] of AGO_UNITS)
    if (secs >= size) return `${Math.floor(secs / size)} ${unit}`;
  return "0 s";
}

/** "4 s", kept current. */
export function useAgo(ts: string): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  return ago(ts, now);
}

/** A time as "3 min" with the full timestamp on hover. */
export function Ago({ ts, now }: { ts: string; now: number }) {
  return (
    <time dateTime={ts} title={`${when(ts)} UTC`}>
      {ago(ts, now)}
    </time>
  );
}

/** A compact UTC timestamp: 2026-09-29 18:02. */
export function when(iso: string): string {
  return iso
    .replace("T", " ")
    .replace(/:\d\d(\.\d+)?Z$/, "")
    .replace(/Z$/, "");
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** The quick switcher's shortcut as this platform writes it (⌘K on Apple devices). */
export const switcherKey = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
    ? "⌘K"
    : "Ctrl K";

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A library's health summary, as the daily check leaves it (TEMPRA-66, `GET …/health`). */
export interface Health {
  at: string;
  seq: number;
  counts: {
    stale: number;
    stale_soon: number;
    broken_link: number;
    lint: number;
    structure: number;
    comment: number;
  };
  unverified: { total: number; newest: { path: string; seq: number; ts: string; actor: string }[] };
}

/** "2 stale · 1 broken link · 3 structure": the kinds with something open, or "" when none is. */
export function healthWords(c: Health["counts"]): string {
  return [
    c.stale > 0 && `${c.stale} stale`,
    c.stale_soon > 0 && `${c.stale_soon} stale soon`,
    c.broken_link > 0 && plural(c.broken_link, "broken link"),
    c.lint > 0 && `${c.lint} lint`,
    c.structure > 0 && `${c.structure} structure`,
    c.comment > 0 && plural(c.comment, "open comment"),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** An element id for a footnote label or source id (as the server's anchorId). */
export const anchorId = (prefix: string, label: string) =>
  `${prefix}-${label.replace(/[^\w.-]/g, "_")}`;

/**
 * Breadcrumbs from the library root to `path` (a directory, or a file when `file` is set), and
 * after them what the page adds (the concept's trust and staleness).
 */
export function Crumbs(props: { urls: Urls; path: string; file: boolean; children?: ReactNode }) {
  const { urls, path, file } = props;
  const parts = path === "" ? [] : path.split("/");
  const items: ReactNode[] = [
    <a key="" href={urls.tree("")}>
      {urls.slug}
    </a>,
  ];
  parts.forEach((seg, i) => {
    const p = parts.slice(0, i + 1).join("/");
    items.push(
      <span key={`/${p}`} aria-hidden="true">
        /
      </span>,
    );
    items.push(
      i === parts.length - 1 && file ? (
        <span key={p} className="here">
          {seg}
        </span>
      ) : (
        <a key={p} href={urls.tree(p)}>
          {seg}
        </a>
      ),
    );
  });
  return (
    <nav className="crumbs" aria-label="Path">
      {items}
      {props.children}
    </nav>
  );
}

export function AtNotice({ urls, head, current }: { urls: Urls; head: number; current: string }) {
  if (urls.at === undefined || urls.at >= head) return null;
  return (
    <div className="notice">
      Viewing as of sequence {urls.at} (head is {head}). <a href={current}>View current</a>
    </div>
  );
}

/** What a page shows while its data loads or when it failed. */
export function Status<T>({
  loaded,
  children,
}: {
  loaded: Loaded<T>;
  children: (data: T) => ReactNode;
}) {
  if (loaded.state === "loading") return <p className="muted">Loading…</p>;
  if (loaded.state === "error") return <ErrorView error={loaded.error} />;
  return <>{children(loaded.data)}</>;
}

export function ErrorView({ error }: { error: ApiError }) {
  useTitle(error.status === 404 ? "Not found" : "Something went wrong");
  return (
    <>
      <h1>{error.status === 404 ? "Not found" : "Something went wrong"}</h1>
      <p>{error.message}</p>
    </>
  );
}

export { baseName };
