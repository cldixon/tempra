import { useEffect, useMemo, useState } from "react";
import { agoWords, useNow } from "../activity";
import { type ActorView, useActors } from "../agents";
import { ApiError, api, useLoad } from "../api";
import { Icon } from "../chrome";
import { useThreads } from "../comments/data";
import { ConceptPage } from "../concept/ConceptPage";
import {
  actedBy,
  bodyHref,
  type FileData,
  type FileJson,
  fileKey,
  type HistoryEvent,
  isConceptPath,
  type Links,
  loadFile,
} from "../concept/data";
import { LiveNotice, useLiveFile } from "../concept/live";
import { Reader } from "../Reader";
import { prepare } from "../reader/prepare";
import type { Compare } from "../router";
import { navigate } from "../router";
import { fileLabel } from "../Tree";
import {
  AtNotice,
  Crumbs,
  calendarDay,
  formatSize,
  Status,
  useCopy,
  useMe,
  useScrollToHash,
  useTitle,
} from "../ui";
import { baseName, dirOf, enc, type Urls } from "../urls";
import { PageBar, SheetPage, useFrame } from "../Workspace";

/** What the last server action did, said once on the page it returns to (`?done=`). */
const DONE: Record<string, (actor: string) => string> = {
  restore: (actor) => `Restored. The ledger records it as a revert by ${actor}.`,
  verify: (actor) => `Verified as ${actor}. The trust tier is human-reviewed until the next edit.`,
};

/**
 * A file's page: a concept in its own layout (concept/ConceptPage), an attachment (board 28), or
 * a synthesized file (log.md) in a page column; Not found (board 32) for a path with nothing
 * there. A folder's index.md is the folder's page.
 */
export function File(props: {
  urls: Urls;
  path: string;
  done: string | null;
  actor: string;
  compare: Compare | null;
}) {
  const { urls, path } = props;
  const loaded = useLoad(fileKey(urls, path), () => loadFile(urls, path));
  // A concept's comment threads load beside it, and reload on their own (comments are not
  // content: a new comment never redraws the body).
  const threads = useThreads(urls, isConceptPath(path) ? path : null);
  // index.md is the directory's own page.
  useEffect(() => {
    if (baseName(path) === "index.md") navigate(urls.tree(dirOf(path)), { replace: true });
  }, [urls, path]);
  useScrollToHash(loaded.state === "ready");
  const notice = props.done ? DONE[props.done]?.(props.actor) : undefined;
  const shown: FileData | null = loaded.state === "ready" ? loaded.data : null;
  const live = useLiveFile(urls, shown, props.actor, loaded.reload, threads.reload);
  const concept = shown?.extra;
  if (shown && concept) {
    return (
      <ConceptPage
        urls={urls}
        data={concept}
        head={shown.head}
        compare={props.compare}
        threads={threads.state === "ready" ? threads.data.threads : null}
        threadsError={threads.state === "error" ? threads.error.message : null}
        notice={notice}
        live={live}
        onCommented={threads.reload}
        onVerified={loaded.reload}
      />
    );
  }
  if (loaded.state === "error" && loaded.error.status === 404) {
    return <NotFound urls={urls} path={path} />;
  }
  const attachment = shown?.file.kind === "attachment" ? shown.file : null;
  return (
    <>
      <PageBar>
        <Crumbs urls={urls} path={path} file />
      </PageBar>
      <SheetPage wide={attachment !== null}>
        {notice && <div className="notice">{notice}</div>}
        {live && <LiveNotice urls={urls} live={live} />}
        <Status loaded={loaded}>
          {(d) =>
            d.file.kind === "attachment" ? (
              <Attachment urls={urls} file={d.file} head={d.head} />
            ) : d.file.kind === "derived" ? (
              <Derived urls={urls} file={d.file} head={d.head} />
            ) : null
          }
        </Status>
      </SheetPage>
    </>
  );
}

type AttachmentFile = Extract<FileJson, { kind: "attachment" }>;

/** "PNG image", "PDF document", "SVG image", else the media type, else "File". */
export function typeName(media: string | null, path: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toUpperCase();
  if (!media) return ext ? `${ext} file` : "File";
  const [kind, sub = ""] = media.split("/");
  const name = (sub.split("+")[0] ?? sub).toUpperCase();
  if (kind === "image") return `${name === "SVG" ? "SVG" : name === "JPEG" ? "JPEG" : name} image`;
  if (media === "application/pdf") return "PDF document";
  if (kind === "text") return `${name === "PLAIN" ? "Text" : name} file`;
  if (kind === "video") return `${name} video`;
  if (kind === "audio") return `${name} audio`;
  return media;
}

/**
 * An attachment (board 28): the image (or a file icon) large on a dark frame; beside it the
 * filename, Download and Copy link, then Type, Size, Added (who, when, from its history) and
 * Used in (the concepts that link it, from the links route).
 */
function Attachment(props: { urls: Urls; head: number; file: AttachmentFile }) {
  const { urls, file } = props;
  useTitle(`${baseName(file.path)} · ${urls.slug}`);
  const me = useMe();
  const actors = useActors(urls, me?.actor ?? null);
  const now = useNow();
  const frame = useFrame();
  const extra = useLoad(`attachment ${urls.base} ${file.path} ${file.seq}`, async () => {
    const p = enc(file.path);
    const [links, history] = await Promise.all([
      api<Links>(urls.api(`links/${p}`, { at: urls.at })),
      api<{ events: HistoryEvent[] }>(urls.api(`history/${p}`)),
    ]);
    return { links, history: history.events };
  });
  const titles = useMemo(() => {
    const out = new Map<string, string>();
    for (const f of frame.index ?? []) out.set(f.path, fileLabel(f));
    return out;
  }, [frame.index]);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [broken, setBroken] = useState(false);
  const copied = useCopy();
  const image = file.media?.startsWith("image/") && !broken;
  const href = urls.download(file.path);
  const added = extra.state === "ready" ? extra.data.history[0] : undefined;
  const usedIn =
    extra.state === "ready" ? [...new Set(extra.data.links.inbound.map((l) => l.path))] : null;
  return (
    <div className="attachment">
      <AtNotice urls={urls} head={props.head} current={urls.pinned(undefined).file(file.path)} />
      <div className="attachment-frame">
        {image ? (
          <img
            src={href}
            alt={baseName(file.path)}
            onLoad={(e) =>
              setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
            onError={() => setBroken(true)}
          />
        ) : (
          <span className="attachment-icon">
            <Icon name={broken ? "broken" : "file"} size={48} />
          </span>
        )}
      </div>
      <aside className="attachment-side" aria-label="About this file">
        <h1 className="attachment-name">{baseName(file.path)}</h1>
        <p className="attachment-actions">
          <a className="button primary" href={href} download={baseName(file.path)}>
            <Icon name="download" /> Download
          </a>
          <button
            type="button"
            onClick={() =>
              void copied.copy(new URL(urls.pinned(undefined).file(file.path), location.href).href)
            }
          >
            {copied.state === "copied"
              ? "Copied"
              : copied.state === "failed"
                ? "Couldn't copy"
                : "Copy link"}
          </button>
        </p>
        <dl className="attachment-facts">
          <div>
            <dt>Type</dt>
            <dd>{typeName(file.media, file.path)}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>
              {formatSize(file.size)}
              {size && ` · ${size.w} × ${size.h}`}
            </dd>
          </div>
          {added && (
            <div>
              <dt>Added</dt>
              <dd>
                <AddedBy who={actors.view(added.actor, actedBy(added))} ts={added.ts} now={now} />
              </dd>
            </div>
          )}
          <div>
            <dt>Used in</dt>
            <dd>
              {usedIn === null ? (
                "…"
              ) : usedIn.length === 0 ? (
                <span className="muted">No page links it</span>
              ) : (
                <ul className="attachment-used">
                  {usedIn.map((p) => (
                    <li key={p}>
                      <a href={urls.file(p)}>{titles.get(p) ?? baseName(p)}</a>
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}

function AddedBy({ who, ts, now }: { who: ActorView; ts: string; now: number }) {
  const when = now - Date.parse(ts) < 7 * 86_400_000 ? agoWords(ts, now) : calendarDay(ts);
  return (
    <>
      {who.name}
      {who.for && ` for ${who.for}`} · {when}
    </>
  );
}

/** What became of a path, from its history: moved elsewhere, deleted, or nothing known. */
export type Fate =
  | { kind: "moved"; to: string; actor: string; by: ReturnType<typeof actedBy>; ts: string }
  | { kind: "deleted"; actor: string; by: ReturnType<typeof actedBy>; ts: string }
  | null;

/**
 * Reads a path's history (`GET …/history/{path}`, which finds a file by a path it once had) as
 * what became of it: where it lives now, by the move that took it from this path; or the
 * delete that removed it.
 */
export function fateOf(path: string, history: { path: string; events: HistoryEvent[] }): Fate {
  const events = history.events.filter((e) => e.op !== "comment");
  const last = events.at(-1);
  if (!last) return null;
  if (history.path !== path) {
    const from = (e: HistoryEvent) => e.meta?.from_path;
    const move =
      [...events].reverse().find((e) => e.op === "move" && from(e) === path) ??
      [...events].reverse().find((e) => e.op === "move");
    if (!move) return null;
    return { kind: "moved", to: history.path, actor: move.actor, by: actedBy(move), ts: move.ts };
  }
  if (last.op === "delete") {
    return { kind: "deleted", actor: last.actor, by: actedBy(last), ts: last.ts };
  }
  return null;
}

/**
 * Not found (board 32): "This page isn't here", where the ledger says it went (moved, with Open;
 * or deleted), then Home and Search.
 */
export function NotFound({ urls, path }: { urls: Urls; path: string }) {
  useTitle("Not found");
  const me = useMe();
  const actors = useActors(urls, me?.actor ?? null);
  const frame = useFrame();
  const now = useNow();
  const fate = useLoad(`fate ${urls.base} ${path}`, async () => {
    if (path === "") return null;
    try {
      const h = await api<{ path: string; events: HistoryEvent[] }>(
        urls.api(`history/${enc(path)}`),
      );
      return fateOf(path, h);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  });
  const f = fate.state === "ready" ? fate.data : null;
  const who = f ? actors.view(f.actor, f.by).name : "";
  return (
    <>
      <PageBar>
        <Crumbs urls={urls} path={path} file />
      </PageBar>
      <SheetPage>
        <div className="not-found">
          <p className="not-found-code">404</p>
          <h1 className="view-title">This page isn't here</h1>
          {f?.kind === "moved" && (
            <p className="not-found-fate">
              <span>
                Moved to <code>{f.to}</code> by {who}, {agoWords(f.ts, now)}
              </span>
              <a href={urls.file(f.to)}>Open</a>
            </p>
          )}
          {f?.kind === "deleted" && (
            <p className="not-found-fate">
              <span>
                Deleted by {who}, {agoWords(f.ts, now)}
              </span>
              <a href={urls.activity({ view: "events", q: path })}>In Activity</a>
            </p>
          )}
          <p className="not-found-ways">
            <a className="button" href={urls.tree("")}>
              Home
            </a>
            <button type="button" onClick={frame.search}>
              <Icon name="search" /> Search
            </button>
          </p>
        </div>
      </SheetPage>
    </>
  );
}

/** A synthesized file (index.md, log.md) in the reader: the file as an agent reads it. */
export function Derived(props: {
  urls: Urls;
  head: number;
  file: Extract<FileJson, { kind: "derived" }>;
}) {
  const { urls, file } = props;
  useTitle(`${file.path} · ${urls.slug}`);
  const prepared = useMemo(
    () => prepare(file.doc, { path: file.path, href: bodyHref(urls), footnote: () => null }),
    [file, urls],
  );
  return (
    <>
      <AtNotice urls={urls} head={props.head} current={urls.pinned(undefined).file(file.path)} />
      <p className="small muted">
        Synthesized by the server. <a href={urls.raw(file.path)}>Raw</a>
      </p>
      <Reader prepared={prepared} diff={null} hideFirst={false} />
    </>
  );
}
