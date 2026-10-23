/**
 * A `mermaid` fence drawn as a diagram (tempra-dev: app/diagrams), the registry's first entry.
 * Pele loads on demand (./pele.ts); the figure is drawn at its width and again when that changes.
 * It sits in a quiet frame with its caption below ("Figure n." and the fence's `title="…"`) and two
 * small controls in its corner: Source (the Mermaid source in place, and back) and Enlarge (the
 * full-screen view, Lightbox.tsx). What it draws, the controls included, is opaque to comments
 * (`data-opaque`), and the controls and caption are not text (`data-skip`). A diagram that fails
 * shows its source as the default code block would, where comments can anchor, with a quiet notice
 * under it.
 */
import type { Code } from "mdast";
import { type RefObject, useContext, useEffect, useId, useRef, useState } from "react";
import { Icon } from "../chrome";
import { Caption, OpenFigure } from "./Figure";
import type { BlockProps } from "./registry";

/** Pele's error, in a line. */
function reason(e: unknown): string {
  const first = (e instanceof Error ? e.message : String(e)).split("\n", 1)[0] ?? "";
  return first.replace(/:$/, "").trim() || "it could not be drawn";
}

/**
 * Draws `source` with Pele into `host` at its width, again when the width changes; `active` false
 * leaves it alone (the host is not shown). Returns Pele's error for this source, or null.
 */
export function useDiagram(
  host: RefObject<HTMLElement | null>,
  source: string,
  idPrefix: string,
  active = true,
): string | null {
  const [failed, setFailed] = useState<{ source: string; message: string } | null>(null);
  const failure = failed?.source === source ? failed.message : null;

  useEffect(() => {
    const el = host.current;
    if (!active || !el || failure !== null) return;
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
        .then((pele) => pele.diagram(el.ownerDocument, source, { width, font, idPrefix }))
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
  }, [host, source, idPrefix, active, failure]);

  return failure;
}

export function Diagram({ node, id, offset, text, figure }: BlockProps<Code>) {
  const host = useRef<HTMLDivElement>(null);
  const open = useContext(OpenFigure);
  const [showSource, setShowSource] = useState(false);
  const failure = useDiagram(host, node.value, `d${id ?? ""}-`, !showSource);
  const captionId = useId();
  const caption = figure && <Caption figure={figure} id={captionId} />;

  if (failure !== null) {
    return (
      <figure className="diagram failed" data-block={id}>
        <pre data-text={offset} data-lang="mermaid">
          <code>{text}</code>
        </pre>
        <p className="diagram-notice" data-skip="">
          Diagram not drawn: {failure}
        </p>
        {caption}
      </figure>
    );
  }
  return (
    <figure className="diagram" data-block={id} data-opaque="">
      <div className="diagram-frame">
        {showSource ? (
          <pre className="diagram-source" data-lang="mermaid">
            <code>{node.value}</code>
          </pre>
        ) : (
          // One image to a screen reader, named by its caption ("Figure 2. The flow"; C-28).
          <div
            ref={host}
            className="diagram-svg"
            role="img"
            aria-labelledby={figure ? captionId : undefined}
            aria-label={figure ? undefined : "Diagram"}
          />
        )}
        <span className="figure-tools" data-skip="">
          <button
            type="button"
            aria-pressed={showSource}
            onClick={(e) => {
              e.stopPropagation();
              setShowSource((s) => !s);
            }}
          >
            Source
          </button>
          {open && figure && (
            <button
              type="button"
              className="figure-enlarge"
              aria-label={`Enlarge diagram${figure.caption ? `: ${figure.caption}` : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                open(figure.n);
              }}
            >
              <Icon name="enlarge" size={14} />
            </button>
          )}
        </span>
      </div>
      {caption}
    </figure>
  );
}
