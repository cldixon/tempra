import { useEffect, useMemo } from "react";
import { useLoad } from "../api";
import { useThreads } from "../comments/data";
import { ConceptPage } from "../concept/ConceptPage";
import {
  bodyHref,
  type FileData,
  type FileJson,
  fileKey,
  isConceptPath,
  loadFile,
} from "../concept/data";
import { LiveNotice, useLiveFile } from "../concept/live";
import { Reader } from "../Reader";
import { prepare } from "../reader/prepare";
import type { Compare } from "../router";
import { navigate } from "../router";
import { AtNotice, Crumbs, formatSize, Status, useScrollToHash, useTitle } from "../ui";
import { baseName, dirOf, folderName, type Urls } from "../urls";
import { SheetBar, SheetPage } from "../Workspace";

/** What the last server action did, said once on the page it returns to (`?done=`). */
const DONE: Record<string, (actor: string) => string> = {
  restore: (actor) => `Restored. The ledger records it as a revert by ${actor}.`,
  verify: (actor) => `Verified as ${actor}. The trust tier is human-reviewed until the next edit.`,
};

/**
 * A file's page: a concept in its own layout (concept/ConceptPage), or an attachment or a
 * synthesized file (log.md) in a page column. A folder's index.md is the folder's page.
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
  const dir = dirOf(path);
  return (
    <>
      <SheetBar back={{ href: urls.tree(dir), label: dir ? folderName(dir) : urls.slug }}>
        <Crumbs urls={urls} path={path} file />
      </SheetBar>
      <SheetPage>
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

function Attachment(props: {
  urls: Urls;
  head: number;
  file: Extract<FileJson, { kind: "attachment" }>;
}) {
  const { urls, file } = props;
  useTitle(`${file.path} · ${urls.slug}`);
  return (
    <>
      <h1 className="doc-title">{baseName(file.path)}</h1>
      <AtNotice urls={urls} head={props.head} current={urls.pinned(undefined).file(file.path)} />
      <p className="muted">
        {file.media ?? "file"} · {formatSize(file.size)}
      </p>
      <p>
        <a href={urls.download(file.path)}>Download</a>
      </p>
      {file.media?.startsWith("image/") && (
        <p>
          <img src={urls.download(file.path)} alt={baseName(file.path)} />
        </p>
      )}
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
