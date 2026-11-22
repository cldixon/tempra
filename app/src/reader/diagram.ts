/**
 * Drawing a fence that is rendered media (tempra-dev: app/diagrams; Diagram.svelte and the
 * full-screen view): a `mermaid` fence with Pele, loaded on demand (./pele.ts), drawn at its host's
 * width and again when that changes; an `svg` fence sanitized (./svg-fence.ts, TEMPRA-206), which
 * scales by its viewBox. Each is an attachment on the host element.
 */
import { fenceAttr, fencePlacement, sanitizeSvg } from "@tempra/editor/doc";
import type { Attachment } from "svelte/attachments";

/** The fence languages drawn as figures, as the registry maps them. */
export type FigureLang = "mermaid" | "svg" | "vega-lite";

/** A chart's place in the library: its page's path, and a library file's text (TEMPRA-207). */
export interface ChartSource {
  path: string;
  read(path: string): Promise<string | null>;
}

/** A fence's language as the registry draws it. */
export function figureLang(lang: string | null | undefined): FigureLang {
  const l = lang?.toLowerCase();
  return l === "svg" || l === "vega-lite" ? l : "mermaid";
}

/**
 * An SVG's own <title>, read without parsing (the fence's alt when it has no `alt="…"`); the
 * sanitizer keeps the same element, so what is named is what is drawn.
 */
export function svgTitle(source: string): string | null {
  const m = /<title\b[^>]*>([^<]*)<\/title>/.exec(source);
  const t = (m?.[1] ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return t || null;
}

/** A chart's own `description`, read without Vega (its alt when the fence gives none). */
export function chartDescription(source: string): string | null {
  try {
    const spec = JSON.parse(source) as { description?: unknown };
    return typeof spec?.description === "string" && spec.description.trim()
      ? spec.description.trim()
      : null;
  } catch {
    return null;
  }
}

/** What a figure fence is named by when its fence gives no `alt`: an SVG's <title>, a chart's description. */
export function fenceAlt(
  lang: FigureLang,
  meta: string | null | undefined,
  source: string,
): string | null {
  if (lang === "mermaid") return null;
  return fenceAttr(meta, "alt") ?? (lang === "svg" ? svgTitle(source) : chartDescription(source));
}

/** An SVG fence's `<desc>`, its longer description (TEMPRA-315), as the sanitizer reads it. */
export function svgDesc(lang: FigureLang, source: string): string | null {
  if (lang !== "svg") return null;
  const r = sanitizeSvg(source);
  return r.ok ? r.desc : null;
}

/**
 * A fence's placement (TEMPRA-315): its classes, as figure markup's (prose.css), and its width
 * for `--figure-width`; a value that is not one is left out (the Worker lints it).
 */
export function fenceLayout(meta: string | null | undefined): {
  classes: string;
  width: string | null;
} {
  const p = fencePlacement((name) => fenceAttr(meta, name));
  const width = p.width ? `${p.width.value}${p.width.unit}` : null;
  return {
    classes: [p.layout !== "column" ? `figure-${p.layout}` : "", width ? "figure-sized" : ""]
      .filter(Boolean)
      .join(" "),
    width,
  };
}

/** Sets `--figure-width` on a figure through the CSSOM (no style attribute; CSP). */
export function figureWidthProperty(width: string | null): Attachment<HTMLElement> {
  return (el) => {
    if (width) el.style.setProperty("--figure-width", width);
    else el.style.removeProperty("--figure-width");
  };
}

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
  lang: FigureLang = "mermaid",
  chart?: ChartSource,
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
      (lang === "svg"
        ? import("./svg-fence").then((m) => m.svgFigure(el.ownerDocument, source, idPrefix))
        : lang === "vega-lite"
          ? import("./chart").then((m) =>
              m.chartFigure(el.ownerDocument, source, {
                width,
                idPrefix,
                path: chart?.path ?? "",
                read: chart?.read ?? (async () => null),
              }),
            )
          : import("./pele").then((pele) =>
              pele.diagram(el.ownerDocument, source, { width, font, idPrefix }),
            )
      ).then(
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
