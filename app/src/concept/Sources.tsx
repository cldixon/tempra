import { docText } from "@tempra/editor";
import type { ReactNode } from "react";
import { Note } from "../reader/Body";
import type { Footnote, Prepared } from "../reader/prepare";
import { anchorId } from "../ui";
import type { Urls } from "../urls";
import type { JsonObject, Sources as SourcesData } from "./data";

/** A footnote definition's text, for comparing with a source's title. */
function plain(f: Footnote): string {
  return docText({ type: "root", children: f.node.children }).text.trim();
}

/** A footnote definition, drawn as the body draws it. */
function FootnoteNote({ prepared, f }: { prepared: Prepared; f: Footnote }) {
  return (
    <div className="small note">
      <Note prepared={prepared} nodes={f.node.children} />
    </div>
  );
}

/**
 * The concept's sources as a section at the end of the body (take 3; tempra-dev: app/reader,
 * Sources), numbered as the footnote markers and their cards number them, then any footnotes that
 * cite no source. Not part of the document's text: it sits after the reader, outside it.
 */
export function SourcesSection(props: {
  urls: Urls;
  data: SourcesData;
  prepared: Prepared;
  /** Each footnote label's number, as the body's markers show it. */
  numbers: Map<string, number>;
}) {
  const { urls, data, prepared } = props;
  const footnotes = prepared.footnotes;
  const used = new Set<string>();
  const items = data.sources.map((s, i) => {
    const id = typeof s.id === "string" ? s.id : null;
    if (id) used.add(id);
    const name = typeof s.title === "string" ? s.title : (id ?? "Source");
    const resource = typeof s.resource === "string" ? s.resource : null;
    const internal = (s.internal ?? null) as JsonObject | null;
    // People's words only (TEMPRA-131): no paths, trust tiers or citation counts.
    const meta: string[] = [];
    let link: ReactNode = <span>{name}</span>;
    if (internal?.broken) {
      meta.push("missing");
    } else if (internal && typeof internal.path === "string") {
      link = <a href={urls.file(internal.path)}>{name}</a>;
      meta.push("in this library");
      if (internal.stale) meta.push("stale");
      if (internal.status && internal.status !== "stable") meta.push(String(internal.status));
    } else if (resource && /^https?:\/\//i.test(resource)) {
      link = (
        <a href={resource} rel="noopener noreferrer nofollow">
          {name}
        </a>
      );
      meta.push("external");
    } else if (resource) meta.push(resource);
    // The footnote's own text, unless it only repeats the source's title.
    const note = id ? footnotes.find((f) => f.label === id) : undefined;
    const def = note && plain(note) !== name.trim() ? note : undefined;
    return (
      <li key={id ?? i} id={id ? anchorId("src", id) : undefined}>
        <span className="num">{i + 1}</span>
        <span>
          {link}
          <span className="meta">{meta.join(" · ")}</span>
          {def && (
            <span className="meta">
              <FootnoteNote prepared={prepared} f={def} />
            </span>
          )}
        </span>
      </li>
    );
  });
  const others = footnotes.filter((f) => !used.has(f.label));
  if (items.length === 0 && others.length === 0 && data.unmatched_footnotes.length === 0) {
    return null;
  }
  return (
    <section id="doc-sources" className="doc-sources" aria-labelledby="doc-sources-title">
      <h2 id="doc-sources-title">Sources</h2>
      {items.length > 0 && <ol className="sources">{items}</ol>}
      {others.length > 0 && (
        <>
          <h3>Notes</h3>
          <ul className="sources">
            {others.map((f) => (
              <li key={f.label} id={anchorId("fn", f.label)}>
                <span className="num">{props.numbers.get(f.label) ?? f.label}</span>
                <FootnoteNote prepared={prepared} f={f} />
              </li>
            ))}
          </ul>
        </>
      )}
      {data.unmatched_footnotes.length > 0 && (
        <p className="small warn">
          No source for {data.unmatched_footnotes.map((l) => `[^${l}]`).join(", ")}
        </p>
      )}
    </section>
  );
}
