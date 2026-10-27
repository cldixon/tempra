/**
 * An `svg` fence drawn in the reader (TEMPRA-206; tempra-dev: app/diagrams): the source sanitized
 * as the Worker sanitizes it (@tempra/editor `sanitizeSvg`, its ids prefixed for this figure),
 * then brought in with its styles through the CSSOM (./svgdom.ts). Loaded on demand, like Pele.
 */
import { sanitizeSvg } from "@tempra/editor/doc";
import { svgNode } from "./svgdom";

/** `source` as an SVG element of `doc`; throws what is wrong when it does not parse. */
export function svgFigure(doc: Document, source: string, idPrefix: string): SVGSVGElement {
  const r = sanitizeSvg(source, { idPrefix });
  if (!r.ok) {
    throw new Error(`${r.message}${r.line > 0 ? ` (line ${r.line}, column ${r.column})` : ""}`);
  }
  return svgNode(r.svg, doc);
}
