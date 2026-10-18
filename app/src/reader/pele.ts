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

/** Pele's markup as an SVG element of `doc`, with no `style` attribute parsed from markup. */
export function svgNode(svg: string, doc: Document): SVGSVGElement {
  // Inside a tag only; attribute values have their quotes escaped, so `style="` starts one.
  const marked = svg.replace(/(<[^<>]*?\s)style="/g, '$1data-pele-style="');
  const Parser = doc.defaultView?.DOMParser ?? DOMParser;
  const parsed = new Parser().parseFromString(marked, "image/svg+xml");
  const root = parsed.documentElement;
  if (root.localName !== "svg" || parsed.getElementsByTagName("parsererror").length > 0) {
    throw new Error("The diagram's SVG did not parse.");
  }
  const out = doc.importNode(root, true) as unknown as SVGSVGElement;
  for (const el of [out, ...Array.from(out.querySelectorAll("[data-pele-style]"))]) {
    const css = el.getAttribute("data-pele-style");
    if (css === null) continue;
    el.removeAttribute("data-pele-style");
    const style = (el as SVGElement).style;
    for (const [name, value, priority] of declarations(css))
      style.setProperty(name, value, priority);
  }
  return out;
}

/** A style attribute's declarations: name, value and priority, split outside quotes and parens. */
export function declarations(css: string): [string, string, string][] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === ";" && depth === 0) {
      parts.push(css.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(css.slice(start));
  return parts.flatMap((part): [string, string, string][] => {
    const colon = part.indexOf(":");
    if (colon < 1) return [];
    const name = part.slice(0, colon).trim();
    let value = part.slice(colon + 1).trim();
    const important = /\s*!important$/i.exec(value);
    if (important) value = value.slice(0, important.index).trim();
    return name && value ? [[name, value, important ? "important" : ""]] : [];
  });
}

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
