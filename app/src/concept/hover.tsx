import { type ReactNode, useRef } from "react";
import { api } from "../api";
import type { Hovered } from "../Reader";
import { Note } from "../reader/Body";
import type { Prepared } from "../reader/prepare";
import { baseName, enc, type Urls } from "../urls";
import type { FileJson, JsonObject, Sources } from "./data";

/**
 * Cards over the body: a footnote marker shows the source it cites (or its note), an internal
 * link the target's title, type and staleness (no trust tiers: those are for agents), an
 * external link its URL.
 */
export function useHoverCards(urls: Urls, sources: Sources, prepared: Prepared) {
  const targets = useRef(new Map<string, Promise<FileJson | null>>());
  return (h: Hovered): ReactNode | Promise<ReactNode> | null => {
    if (h.kind === "footnote") {
      const s = sources.sources.find((x) => x.id === h.label);
      if (!s) {
        const note = prepared.footnotes.find((f) => f.label === h.label);
        if (!note) return null;
        return (
          <div className="small">
            <Note prepared={prepared} nodes={note.node.children} />
          </div>
        );
      }
      const internal = (s.internal ?? null) as JsonObject | null;
      return (
        <div>
          <strong>{typeof s.title === "string" ? s.title : h.label}</strong>
          {typeof s.resource === "string" && <div className="small muted">{s.resource}</div>}
          {internal?.broken ? <div className="small">Missing</div> : null}
          {internal?.stale ? <div className="small">Stale</div> : null}
        </div>
      );
    }
    if (h.path === null) return h.href ? <div className="small">{h.href}</div> : null;
    if (h.broken) return <div className="small">Missing: no page is at this link</div>;
    const path = h.path;
    let target = targets.current.get(path);
    if (!target) {
      target = api<FileJson>(urls.api(`files/${enc(path)}`)).catch(() => null);
      targets.current.set(path, target);
    }
    return target.then((t) => {
      if (!t) return <div className="small">{baseName(path)}</div>;
      if (t.kind !== "concept") return <div className="small">{`${baseName(t.path)} · file`}</div>;
      const tfm = t.frontmatter;
      const facts = [typeof tfm.type === "string" ? tfm.type : "", t.stale ? "Stale" : ""];
      return (
        <div>
          <strong>{typeof tfm.title === "string" ? tfm.title : baseName(t.path)}</strong>
          {facts.some(Boolean) && (
            <div className="small muted">{facts.filter(Boolean).join(" · ")}</div>
          )}
          {typeof tfm.description === "string" && <div className="small">{tfm.description}</div>}
        </div>
      );
    });
  };
}
