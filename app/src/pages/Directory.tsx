import { useLoad } from "../api";
import { useFeed, useTrailing } from "../live";
import { Status, useTitle } from "../ui";
import type { Urls } from "../urls";
import { Derived, fileKey, loadFile } from "./File";

/**
 * A library's root: no document is open and the sheet is blank. The tree in the sidebar is the
 * library's structure, so the sheet never lists it. A folder's URL (reached from links and
 * crumbs, never from the tree, where a folder opens in place) shows the folder's own index.md as
 * a document.
 */
export function Directory({ urls, dir }: { urls: Urls; dir: string }) {
  useTitle(dir === "" ? urls.slug : `${dir}/ · ${urls.slug}`);
  return dir === "" ? <Root /> : <Folder urls={urls} dir={dir} />;
}

/** No document open: the sheet is blank. The tree is the library. */
function Root() {
  return <div className="empty" />;
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
