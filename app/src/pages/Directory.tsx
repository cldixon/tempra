import { useEffect } from "react";
import { api, useLoad } from "../api";
import { markSeen, useFeed, useTrailing } from "../live";
import { plural, Status, useTitle } from "../ui";
import type { Urls } from "../urls";
import { Derived, fileKey, loadFile } from "./File";

interface Summary {
  seq: number;
  concepts: number;
  attachments: number;
  open_work: number;
  types: Record<string, number>;
}

/**
 * A library's root: no document is open. The tree in the sidebar is the library's structure, so
 * the sheet does not list it again; it says what is here in one line, and where the index agents
 * read is. A folder's URL (reached from links and crumbs, never from the tree, where a folder
 * opens in place) shows the folder's own index.md as a document.
 */
export function Directory({ urls, dir }: { urls: Urls; dir: string }) {
  useTitle(dir === "" ? urls.slug : `${dir}/ · ${urls.slug}`);
  return dir === "" ? <Root urls={urls} /> : <Folder urls={urls} dir={dir} />;
}

function Root({ urls }: { urls: Urls }) {
  const loaded = useLoad(`root ${urls.base}`, () => api<Summary>(urls.api("summary")));
  const head = loaded.state === "ready" ? loaded.data.seq : null;
  // Live: a write anywhere changes the counts (tempra-dev: app/live).
  const reload = useTrailing(loaded.reload);
  useFeed(urls, head, reload, reload);
  useEffect(() => {
    if (head !== null) markSeen(urls, head);
  }, [head, urls]);
  return (
    <div className="empty">
      <Status loaded={loaded}>
        {(s) => {
          const types = Object.entries(s.types)
            .sort((a, b) => b[1] - a[1])
            .map(([t, n]) => `${t} ${n}`);
          return (
            <p>
              {[plural(s.concepts, "concept"), plural(s.attachments, "attachment"), ...types].join(
                " · ",
              )}
            </p>
          );
        }}
      </Status>
      <p>
        <a href={urls.raw("index.md")}>index.md</a> as agents read it
      </p>
    </div>
  );
}

function Folder({ urls, dir }: { urls: Urls; dir: string }) {
  const path = `${dir}/index.md`;
  const loaded = useLoad(fileKey(urls, path), () => loadFile(urls, path));
  // Live: a write under this folder changes its index.
  const under = (p: string | null) => p !== null && (p === dir || p.startsWith(`${dir}/`));
  const head = loaded.state === "ready" ? loaded.data.head : null;
  const reload = useTrailing(loaded.reload);
  useFeed(
    urls,
    urls.at === undefined ? head : null,
    (events) => {
      if (urls.at === undefined && events.some((e) => under(e.path) || under(e.from_path))) {
        reload();
      }
    },
    reload,
  );
  return (
    <article className="doc">
      <Status loaded={loaded}>
        {(d) =>
          d.file.kind === "derived" ? <Derived urls={urls} file={d.file} head={d.head} /> : null
        }
      </Status>
    </article>
  );
}
