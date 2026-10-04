import { type ReactNode, useEffect } from "react";
import type { ApiError, Loaded } from "./api";
import { baseName, type Urls } from "./urls";

/** The person the app acts for (GET /api/v1/me). */
export interface Me {
  email: string;
  handle: string;
  actor: string;
}

export function Header({ me }: { me: Me | null }) {
  return (
    <>
      <header>
        Tempra: <a href="/">Libraries</a> | <a href="/connect">Connect</a> |{" "}
        <a href="/tokens">Tokens</a> | <a href="/apps">Connected apps</a>
        {me && (
          <>
            {" "}
            | <a href="/account">{me.email}</a>
          </>
        )}
      </header>
      <hr />
    </>
  );
}

/** Sets the document title, as the server pages do: "{title} - Tempra". */
export function useTitle(title: string | null) {
  useEffect(() => {
    if (title) document.title = `${title} - Tempra`;
  }, [title]);
}

/** After a page's data arrives, scrolls to the #fragment the URL names, if any. */
export function useScrollToHash(ready: boolean) {
  useEffect(() => {
    if (!ready || !location.hash) return;
    document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  }, [ready]);
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

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** An element id for a footnote label or source id (as the server's anchorId). */
export const anchorId = (prefix: string, label: string) =>
  `${prefix}-${label.replace(/[^\w.-]/g, "_")}`;

/** Breadcrumbs from the library root to `path` (a directory, or a file when `file` is set). */
export function Crumbs({ urls, path, file }: { urls: Urls; path: string; file: boolean }) {
  const parts = path === "" ? [] : path.split("/");
  const items: ReactNode[] = [
    <a key="" href={urls.tree("")}>
      {urls.slug}
    </a>,
  ];
  parts.forEach((seg, i) => {
    const p = parts.slice(0, i + 1).join("/");
    items.push(" / ");
    items.push(
      i === parts.length - 1 && file ? (
        seg
      ) : (
        <a key={p} href={urls.tree(p)}>
          {seg}
        </a>
      ),
    );
  });
  return <div className="crumbs">{items}</div>;
}

export function AtNotice({ urls, head, current }: { urls: Urls; head: number; current: string }) {
  if (urls.at === undefined || urls.at >= head) return null;
  return (
    <div className="notice">
      Viewing as of sequence {urls.at} (head is {head}). <a href={current}>View current</a>
    </div>
  );
}

export type LibTab = "files" | "ledger";

/** The library's section tabs; only Files and Ledger are drawn by the app so far. */
export function LibNav({ urls, active }: { urls: Urls; active: LibTab | null }) {
  const tabs: [string, string, LibTab | null][] = [
    ["Files", urls.pinned(undefined).tree(""), "files"],
    ["Ledger", urls.ledger(), "ledger"],
    ["Work queue", urls.work(), null],
    ["Import & export", urls.transfer(), null],
    ["Recovery", urls.recovery(), null],
    ["Connect", urls.connect(), null],
    ["Delete", urls.remove(), null],
  ];
  return (
    <nav className="libnav">
      <span className="muted">{urls.slug}:</span>{" "}
      {tabs.map(([name, href, key], i) => (
        <span key={name}>
          {i > 0 && " · "}
          {key !== null && key === active ? <strong>{name}</strong> : <a href={href}>{name}</a>}
        </span>
      ))}
    </nav>
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
