import { ApiError, useLoad } from "../api";
import { Status } from "../ui";
import { enc, type Urls } from "../urls";

/** The file as stored: what agents read and write, frontmatter and all. */
export function RawMarkdown(props: { urls: Urls; path: string; hash: string }) {
  const { urls, path, hash } = props;
  const url = urls.api(`files/${enc(path)}`, { at: urls.at });
  const loaded = useLoad(`markdown ${url} ${hash}`, async () => {
    const res = await fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "text/markdown" },
    });
    if (!res.ok) throw new ApiError(res.status, "error", res.statusText);
    return res.text();
  });
  return (
    <Status loaded={loaded}>
      {(text) => (
        <div className="raw-markdown">
          <pre>{text}</pre>
          <a href={urls.raw(path)}>Open as plain text</a>
        </div>
      )}
    </Status>
  );
}
