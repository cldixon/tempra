/**
 * SVG markup into the page with its styles through the CSSOM (tempra-dev:
 * decisions/diagram-styles-through-cssom): `style` attributes are renamed before parsing and each
 * declaration applied with `style.setProperty`, which CSP leaves alone, so the shell keeps
 * `style-src 'self'`. Pele's diagrams (./pele.ts) and SVG fences (./svg-fence.ts) both come in
 * this way.
 */

/** SVG markup as an SVG element of `doc`, with no `style` attribute parsed from markup. */
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
