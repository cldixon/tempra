import { useState } from "react";
import { useLoad } from "../api";
import { Icon } from "../chrome";
import { Status } from "../ui";
import { baseName, type Urls } from "../urls";
import { storedFile } from "./Tools";

/** Whether the Markdown view wraps long lines, for this tab (a per-viewer convenience). */
let wrapped = false;

/**
 * The Markdown view (take 4, TEMPRA-114; TEMPRA-134; tempra-dev: app/reader, Markdown view): the
 * file as stored, frontmatter and body, in the mono with line numbers, in place of the page
 * (`?view=markdown`), with Back to page, its path, Wrap lines and Download. Each line is a span
 * whose number is a CSS counter in the gutter, so copying the text copies no numbers.
 */
export function RawMarkdown(props: { urls: Urls; path: string; hash: string; onBack(): void }) {
  const { urls, path, hash } = props;
  const loaded = useLoad(`markdown ${urls.file(path)} ${hash}`, () => storedFile(urls, path));
  const [wrap, setWrap] = useState(wrapped);
  return (
    <section className="raw-markdown" aria-label="Markdown">
      <div className="raw-head">
        <button type="button" className="pill-button" onClick={props.onBack}>
          <Icon name="previous" /> Back to page
        </button>
        <code className="raw-path">{path}</code>
        <button
          type="button"
          aria-pressed={wrap}
          onClick={() => {
            wrapped = !wrap;
            setWrap(!wrap);
          }}
        >
          Wrap lines
        </button>
        <a className="button pill-button" href={urls.raw(path)} download={baseName(path)}>
          <Icon name="download" /> Download
        </a>
      </div>
      <Status loaded={loaded}>
        {(text) => (
          <pre className={wrap ? "raw-file wrap" : "raw-file"}>
            {text
              .replace(/\n$/, "")
              .split("\n")
              .map((line, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a line's place is its identity.
                <span key={i} className="raw-line">
                  {line}
                  {"\n"}
                </span>
              ))}
          </pre>
        )}
      </Status>
    </section>
  );
}
