/**
 * Drawing a `mermaid` fence (tempra-dev: app/diagrams; Diagram.svelte and the full-screen view):
 * Pele loads on demand (./pele.ts), and the diagram is drawn at its host's width and again when
 * that changes, as an attachment on the host element.
 */
import type { Attachment } from "svelte/attachments";

/** Pele's error, in a line. */
export function reason(e: unknown): string {
  const first = (e instanceof Error ? e.message : String(e)).split("\n", 1)[0] ?? "";
  return first.replace(/:$/, "").trim() || "it could not be drawn";
}

/**
 * Draws `source` with Pele into the element it is attached to, at its width, again when the width
 * changes; `failed` gets Pele's error for this source.
 */
export function drawDiagram(
  source: string,
  idPrefix: string,
  failed: (source: string, message: string) => void,
): Attachment<HTMLElement> {
  return (el) => {
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
            if (live) failed(source, reason(e));
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
  };
}
