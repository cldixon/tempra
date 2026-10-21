import { useLoad } from "../api";
import { Icon } from "../chrome";
import { Status } from "../ui";
import { baseName, type Urls } from "../urls";
import { storedFile } from "./Tools";

/**
 * The Markdown view (take 4, TEMPRA-114; tempra-dev: app/reader, Markdown view): the file as
 * stored, frontmatter and body, in the mono with line numbers, in place of the page, with Back
 * to page, its path and Download.
 */
export function RawMarkdown(props: { urls: Urls; path: string; hash: string; onBack(): void }) {
  const { urls, path, hash } = props;
  const loaded = useLoad(`markdown ${urls.file(path)} ${hash}`, () => storedFile(urls, path));
  return (
    <section className="raw-markdown" aria-label="Markdown">
      <div className="raw-head">
        <button type="button" className="pill-button" onClick={props.onBack}>
          <Icon name="previous" /> Back to page
        </button>
        <code className="raw-path">{path}</code>
        <a className="button pill-button" href={urls.raw(path)} download={baseName(path)}>
          <Icon name="download" /> Download
        </a>
      </div>
      <Status loaded={loaded}>
        {(text) => {
          const lines = text.replace(/\n$/, "").split("\n");
          return (
            <div className="raw-file">
              <div className="raw-lines" aria-hidden="true">
                {lines.map((_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: line numbers are their index.
                  <span key={i}>{i + 1}</span>
                ))}
              </div>
              <pre>{text}</pre>
            </div>
          );
        }}
      </Status>
    </section>
  );
}
