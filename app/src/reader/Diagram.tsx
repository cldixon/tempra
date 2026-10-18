/**
 * A `mermaid` fence drawn as a diagram (tempra-dev: app/diagrams), the registry's first entry.
 * Pele loads on demand (./pele.ts); the figure is drawn at its width and again when that changes.
 * What it draws is opaque to comments (`data-opaque`). A diagram that fails shows its source as the
 * default code block would, where comments can anchor, with a quiet notice under it.
 */
import type { Code } from "mdast";
import { useEffect, useRef, useState } from "react";
import type { BlockProps } from "./registry";

/** Pele's error, in a line. */
function reason(e: unknown): string {
  const first = (e instanceof Error ? e.message : String(e)).split("\n", 1)[0] ?? "";
  return first.replace(/:$/, "").trim() || "it could not be drawn";
}

export function Diagram({ node, id, offset, text }: BlockProps<Code>) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<{ source: string; message: string } | null>(null);
  const failure = failed?.source === node.value ? failed.message : null;

  useEffect(() => {
    const el = host.current;
    if (!el || failure !== null) return;
    const source = node.value;
    const view = el.ownerDocument.defaultView;
    let live = true;
    let latest = 0;
    let drawnAt = -1;
    let frame = 0;
    const redraw = () => {
      const width = Math.floor(el.clientWidth);
      if (width === drawnAt) return;
      drawnAt = width;
      const turn = ++latest;
      const font = view?.getComputedStyle(el).fontFamily;
      import("./pele")
        .then((pele) =>
          pele.diagram(el.ownerDocument, source, { width, font, idPrefix: `d${id ?? ""}-` }),
        )
        .then(
          (svg) => {
            if (live && turn === latest) el.replaceChildren(svg);
          },
          (e) => {
            if (live) setFailed({ source, message: reason(e) });
          },
        );
    };
    redraw();
    const resized =
      view && typeof view.ResizeObserver === "function"
        ? new view.ResizeObserver(() => {
            view.cancelAnimationFrame(frame);
            frame = view.requestAnimationFrame(redraw);
          })
        : null;
    resized?.observe(el);
    return () => {
      live = false;
      resized?.disconnect();
      view?.cancelAnimationFrame(frame);
    };
  }, [node.value, id, failure]);

  if (failure !== null) {
    return (
      <figure className="diagram failed" data-block={id}>
        <pre data-text={offset} data-lang="mermaid">
          <code>{text}</code>
        </pre>
        <figcaption className="diagram-notice">Diagram not drawn: {failure}</figcaption>
      </figure>
    );
  }
  return (
    <figure className="diagram" data-block={id} data-opaque="">
      <div ref={host} className="diagram-svg" />
    </figure>
  );
}
