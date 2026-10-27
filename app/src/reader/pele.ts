/**
 * Pele behind the reader's diagrams (tempra-dev: app/diagrams), imported on demand so a page
 * without a diagram never loads it; each diagram type is a further chunk, fetched on first use.
 *
 * The SVG is drawn here rather than by Pele's `mount()`: Pele's markup carries `style` attributes,
 * which the shell's `style-src 'self'` refuses, and `mount()` writes its error notice as one. So
 * the markup is parsed with its `style` attributes renamed, and each declaration is applied
 * through the CSSOM, which CSP leaves alone (tempra-dev: decisions/diagram-styles-through-cssom).
 */
import { detectType, load, render } from "pele/lazy";
import { svgNode } from "./svgdom";

export { declarations, svgNode } from "./svgdom";

/**
 * `source` drawn as an SVG element of `doc` at `width` (0: Pele's natural width), in `font`.
 * Throws Pele's error when the diagram does not parse or render.
 */
export async function diagram(
  doc: Document,
  source: string,
  opts: { width: number; font?: string; idPrefix: string },
): Promise<SVGSVGElement> {
  let type = null;
  try {
    type = detectType(source);
  } catch {
    // render() below reports it.
  }
  await load(type);
  const result = render(source, {
    idPrefix: opts.idPrefix,
    maxWidth: opts.width > 0 ? opts.width : undefined,
    fontFamily: opts.font || undefined,
    links: false,
    images: false,
  });
  return svgNode(result.svg, doc);
}
