/**
 * SVG fences (TEMPRA-206; tempra-dev: app/diagrams, app/media): SVG an agent writes in a page is
 * rendered media, code Tempra draws, and untrusted. This reads it as XML with no DOM and gives back
 * a sanitized SVG that the reader draws, the Worker exports and the render Worker rasterizes, the
 * same bytes everywhere, or where it does not parse.
 *
 * Sanitizing is an allowlist: shapes, text, paint servers, markers, clips, masks and filters stay;
 * scripts, `foreignObject`, `<style>`, animation, images and anything else that runs, loads or
 * links is dropped (links unwrapped), as are event handlers, references outside the SVG (`href`
 * and `url()` may only name an `#id` in it) and any `javascript:`. Ids are prefixed when asked, so
 * two figures on a page never share one. Style attributes stay as attributes: the reader moves
 * them into the CSSOM (decisions/diagram-styles-through-cssom), so the shell's CSP holds.
 */

/** The largest SVG fence drawn, in characters (as `render`'s limit). */
export const SVG_MAX_SOURCE = 50_000;

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * The palette an SVG fence may paint with (TEMPRA-315; tempra-dev app/diagrams, SVG fences):
 * `var(--name)` in any attribute or style, beside `currentColor`. A contract with agents: add
 * names, never rename or remove one. Their values per theme are `svgPalettes` in
 * `@tempra/design/pele`, generated from reader.css; the reader resolves them through its CSS,
 * tempra-render sets them on the root, and an export writes them in (`resolvePalette`).
 */
export const SVG_PALETTE: readonly string[] = [
  "--ink",
  "--muted",
  "--faint",
  "--bg",
  "--surface",
  "--surface-2",
  "--accent",
  "--series-1",
  "--series-2",
  "--series-3",
  "--series-4",
  "--series-5",
  "--series-6",
  "--series-7",
  "--series-8",
];

const PALETTE = new Set(SVG_PALETTE);

/** The properties that paint, where a fixed colour must hold in both themes (`svg_color`). */
const PAINT = new Set(["fill", "stroke", "color", "stop-color", "flood-color", "lighting-color"]);

/** Paint values that are no fixed colour. */
const NOT_A_COLOR =
  /^(none|transparent|currentcolor|inherit|initial|unset|context-fill|context-stroke)$/i;

/** Elements kept, by their name in the SVG namespace. */
const KEEP = new Set([
  "svg",
  "g",
  "defs",
  "symbol",
  "use",
  "title",
  "desc",
  "switch",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textPath",
  "linearGradient",
  "radialGradient",
  "stop",
  "pattern",
  "clipPath",
  "mask",
  "marker",
  "filter",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
]);

/** Elements dropped with what they hold, and what each is called when reported. */
const UNSAFE: Record<string, string> = {
  script: "scripts",
  foreignObject: "foreignObject",
  style: "<style> elements (use attributes)",
  image: "images",
  feImage: "images",
  iframe: "embedded content",
  embed: "embedded content",
  object: "embedded content",
  video: "embedded content",
  audio: "embedded content",
  canvas: "embedded content",
  animate: "animation",
  animateMotion: "animation",
  animateTransform: "animation",
  animateColor: "animation",
  set: "animation",
  discard: "animation",
  mpath: "animation",
};

/** Elements dropped quietly: editors' and metadata, which draw nothing. */
const QUIET = new Set(["metadata", "cursor", "view"]);

export type SvgCheck =
  | {
      ok: true;
      /** The sanitized SVG, standing alone (its own xmlns). */
      svg: string;
      /** What was taken out, as people say it, each once. */
      removed: string[];
      /** The root's `<title>`, for alt text when the fence gives none. */
      title: string | null;
      /** The root's `<desc>`, its longer description (TEMPRA-315). */
      desc: string | null;
      /** The fixed colours it paints with, each once, as written (`svg_color`, TEMPRA-315). */
      colors: string[];
      /** The `var()` names outside the palette it used, each once; taken out (TEMPRA-315). */
      unknownVars: string[];
    }
  | {
      ok: false;
      message: string;
      /** 1-based in the source; 0 when the problem has no place. */
      line: number;
      column: number;
    };

interface El {
  name: string;
  attrs: [string, string][];
  children: (El | string)[];
}

class XmlError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
  }
}

/**
 * XML's five entities, and the HTML entities agents write in labels (TEMPRA-315): spaces and
 * dashes, quotes, arrows, maths, marks and a few letters. Another name is refused with a line that
 * says to write the character itself; HTML's full table (over 2,000 names) is not worth its size.
 */
const ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  ensp: "\u2002",
  emsp: "\u2003",
  thinsp: "\u2009",
  zwnj: "\u200c",
  zwj: "\u200d",
  shy: "\u00ad",
  ndash: "\u2013",
  mdash: "\u2014",
  minus: "\u2212",
  hellip: "\u2026",
  bull: "\u2022",
  middot: "\u00b7",
  lsquo: "\u2018",
  rsquo: "\u2019",
  sbquo: "\u201a",
  ldquo: "\u201c",
  rdquo: "\u201d",
  bdquo: "\u201e",
  laquo: "\u00ab",
  raquo: "\u00bb",
  lsaquo: "\u2039",
  rsaquo: "\u203a",
  prime: "\u2032",
  Prime: "\u2033",
  larr: "\u2190",
  uarr: "\u2191",
  rarr: "\u2192",
  darr: "\u2193",
  harr: "\u2194",
  crarr: "\u21b5",
  lArr: "\u21d0",
  uArr: "\u21d1",
  rArr: "\u21d2",
  dArr: "\u21d3",
  hArr: "\u21d4",
  times: "\u00d7",
  divide: "\u00f7",
  plusmn: "\u00b1",
  le: "\u2264",
  ge: "\u2265",
  ne: "\u2260",
  asymp: "\u2248",
  equiv: "\u2261",
  infin: "\u221e",
  sum: "\u2211",
  prod: "\u220f",
  radic: "\u221a",
  part: "\u2202",
  nabla: "\u2207",
  isin: "\u2208",
  notin: "\u2209",
  sub: "\u2282",
  sup: "\u2283",
  sube: "\u2286",
  supe: "\u2287",
  cap: "\u2229",
  cup: "\u222a",
  and: "\u2227",
  or: "\u2228",
  not: "\u00ac",
  forall: "\u2200",
  exist: "\u2203",
  empty: "\u2205",
  there4: "\u2234",
  ang: "\u2220",
  perp: "\u22a5",
  sdot: "\u22c5",
  lowast: "\u2217",
  deg: "\u00b0",
  micro: "\u00b5",
  permil: "\u2030",
  frac12: "\u00bd",
  frac14: "\u00bc",
  frac34: "\u00be",
  sup1: "\u00b9",
  sup2: "\u00b2",
  sup3: "\u00b3",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  sect: "\u00a7",
  para: "\u00b6",
  dagger: "\u2020",
  Dagger: "\u2021",
  loz: "\u25ca",
  spades: "\u2660",
  clubs: "\u2663",
  hearts: "\u2665",
  diams: "\u2666",
  cent: "\u00a2",
  pound: "\u00a3",
  yen: "\u00a5",
  euro: "\u20ac",
  curren: "\u00a4",
  iexcl: "\u00a1",
  iquest: "\u00bf",
  Alpha: "\u0391",
  Beta: "\u0392",
  Gamma: "\u0393",
  Delta: "\u0394",
  Theta: "\u0398",
  Lambda: "\u039b",
  Pi: "\u03a0",
  Sigma: "\u03a3",
  Phi: "\u03a6",
  Psi: "\u03a8",
  Omega: "\u03a9",
  alpha: "\u03b1",
  beta: "\u03b2",
  gamma: "\u03b3",
  delta: "\u03b4",
  epsilon: "\u03b5",
  zeta: "\u03b6",
  eta: "\u03b7",
  theta: "\u03b8",
  kappa: "\u03ba",
  lambda: "\u03bb",
  mu: "\u03bc",
  pi: "\u03c0",
  rho: "\u03c1",
  sigma: "\u03c3",
  tau: "\u03c4",
  phi: "\u03c6",
  chi: "\u03c7",
  psi: "\u03c8",
  omega: "\u03c9",
  check: "\u2713",
  cross: "\u2717",
  star: "\u2606",
  starf: "\u2605",
};

function decode(s: string, at: number): string {
  return s.replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);?/g,
    (m, e: string, i: number) => {
      if (!m.endsWith(";")) throw new XmlError(`"&" must start an entity such as &amp;`, at + i);
      if (e.startsWith("#x") || e.startsWith("#")) {
        const n = e.startsWith("#x") ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
        if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) {
          throw new XmlError(`${m} is not a character`, at + i);
        }
        return String.fromCodePoint(n);
      }
      const v = ENTITIES[e];
      if (v === undefined || !Object.hasOwn(ENTITIES, e)) {
        throw new XmlError(`unknown entity ${m} (write the character itself)`, at + i);
      }
      return v;
    },
  );
}

const NAME = /[A-Za-z_][\w.:-]*/y;

/** XML to a tree: elements, attributes and text; comments, PIs and the doctype skipped. */
function parse(src: string): El {
  let i = 0;
  const stack: El[] = [{ name: "#root", attrs: [], children: [] }];
  let root: El | null = null;
  const top = () => stack[stack.length - 1] as El;
  const name = (): string => {
    NAME.lastIndex = i;
    const m = NAME.exec(src);
    if (!m) throw new XmlError("expected a name", i);
    i += m[0].length;
    return m[0];
  };
  const space = () => {
    while (i < src.length && /\s/.test(src[i] as string)) i++;
  };
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    const text = src.slice(i, lt < 0 ? src.length : lt);
    if (text) {
      if (stack.length === 1) {
        if (text.trim()) throw new XmlError("text outside the <svg> element", i);
      } else top().children.push(decode(text, i));
    }
    if (lt < 0) break;
    i = lt;
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      if (end < 0) throw new XmlError("a comment is not closed", i);
      i = end + 3;
    } else if (src.startsWith("<![CDATA[", i)) {
      const end = src.indexOf("]]>", i + 9);
      if (end < 0) throw new XmlError("a CDATA section is not closed", i);
      if (stack.length === 1) throw new XmlError("text outside the <svg> element", i);
      top().children.push(src.slice(i + 9, end));
      i = end + 3;
    } else if (src.startsWith("<?", i)) {
      const end = src.indexOf("?>", i + 2);
      if (end < 0) throw new XmlError("a processing instruction is not closed", i);
      i = end + 2;
    } else if (src.startsWith("<!", i)) {
      if (root) throw new XmlError("a declaration after the <svg> element", i);
      // A doctype; one with an internal subset (entity declarations) is not read.
      const end = src.indexOf(">", i);
      if (end < 0) throw new XmlError("a declaration is not closed", i);
      if (src.slice(i, end).includes("[")) {
        throw new XmlError("a DOCTYPE with declarations is not read", i);
      }
      i = end + 1;
    } else if (src.startsWith("</", i)) {
      const at = i;
      i += 2;
      const n = name();
      space();
      if (src[i] !== ">") throw new XmlError(`expected ">" to close </${n}>`, i);
      i++;
      const open = top();
      if (stack.length === 1 || open.name !== n) {
        throw new XmlError(
          stack.length === 1 ? `</${n}> closes nothing` : `</${n}> closes <${open.name}>`,
          at,
        );
      }
      stack.pop();
    } else {
      const at = i;
      i++;
      const el: El = { name: name(), attrs: [], children: [] };
      if (stack.length === 1 && root) throw new XmlError("a second top-level element", at);
      for (;;) {
        const before = i;
        space();
        if (src[i] === ">" || src.startsWith("/>", i)) break;
        if (i === before) throw new XmlError(`expected a space, ">" or "/>" in <${el.name}>`, i);
        const an = name();
        space();
        if (src[i] !== "=") throw new XmlError(`expected "=" after ${an}`, i);
        i++;
        space();
        const q = src[i];
        if (q !== '"' && q !== "'") throw new XmlError(`${an}'s value must be quoted`, i);
        const end = src.indexOf(q, i + 1);
        if (end < 0) throw new XmlError(`${an}'s value is not closed`, i);
        const raw = src.slice(i + 1, end);
        if (raw.includes("<")) throw new XmlError(`"<" in ${an}'s value`, i + 1 + raw.indexOf("<"));
        if (el.attrs.some(([k]) => k === an)) throw new XmlError(`${an} is given twice`, i);
        el.attrs.push([an, decode(raw, i + 1).replace(/[\t\n\r]/g, " ")]);
        i = end + 1;
      }
      top().children.push(el);
      if (stack.length === 1) root = el;
      if (src.startsWith("/>", i)) i += 2;
      else {
        i++;
        stack.push(el);
      }
    }
  }
  if (stack.length > 1) throw new XmlError(`<${top().name}> is not closed`, src.length);
  if (!root) throw new XmlError("no <svg> element", 0);
  return root;
}

const local = (n: string) => n.slice(n.indexOf(":") + 1);
const prefix = (n: string) => (n.includes(":") ? n.slice(0, n.indexOf(":")) : "");

/** `javascript:` however it is spelt: spaces, controls and case aside. */
const SCRIPTY = /j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:|v\s*b\s*s\s*c\s*r\s*i\s*p\s*t\s*:/i;

/** A value's `url(…)`s, each to an `#id` only (rewritten with the prefix); null when one is not. */
function internalUrls(value: string, idPrefix: string): string | null {
  let bad = false;
  const out = value.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_m, _q, target: string) => {
    if (!/^#[\w.:-]+$/.test(target)) {
      bad = true;
      return "";
    }
    return `url(#${idPrefix}${target.slice(1)})`;
  });
  return bad || /url\(/i.test(out.replace(/url\(#[\w.:-]+\)/g, "")) ? null : out;
}

/** What sanitizing found besides what it removed (TEMPRA-315). */
interface Found {
  colors: Set<string>;
  unknownVars: Set<string>;
}

/**
 * A value's `var()`s against the palette: a palette name kept as `var(--name)`; another name its
 * fallback when it gives one, else null (the attribute or declaration goes), each noted.
 */
function paletteVars(value: string, found: Found): string | null {
  let dropped = false;
  const out = value.replace(
    /var\(\s*(--[\w-]*)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/gi,
    (_m, name: string, fallback: string | undefined) => {
      if (PALETTE.has(name)) return `var(${name})`;
      found.unknownVars.add(name);
      if (fallback?.trim()) return fallback.trim();
      dropped = true;
      return "";
    },
  );
  // A var() the pattern could not read (nested, unclosed) is not kept either.
  const rest = out.replace(/var\((--[\w-]+)\)/g, (m, name: string) => (PALETTE.has(name) ? "" : m));
  return dropped || /var\(/i.test(rest) ? null : out;
}

/** Notes a paint's fixed colour (not none, currentColor, a palette name or a reference). */
function noteColor(prop: string, value: string, found: Found): void {
  if (!PAINT.has(prop.toLowerCase())) return;
  const v = value.trim();
  if (!v || NOT_A_COLOR.test(v) || /var\(|url\(/i.test(v)) return;
  found.colors.add(v);
}

/** A style attribute kept declaration by declaration; what loads anything is dropped. */
function cleanStyle(css: string, idPrefix: string, removed: Set<string>, found: Found): string {
  const kept: string[] = [];
  for (const part of css.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 1) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    let value = part.slice(colon + 1).trim();
    if (!/^-?[a-z][a-z-]*$/.test(prop) || !value) continue;
    // Nothing that could load or hide a load: escapes, `image-set("…")`, `src()`, any `//`.
    if (
      /expression\s*\(|@|behavior|binding|\\|image-set|image\s*\(|src\s*\(|\/\//i.test(part) ||
      SCRIPTY.test(value)
    ) {
      removed.add("unsafe styles");
      continue;
    }
    if (/url\(/i.test(value)) {
      const v = internalUrls(value, idPrefix);
      if (v === null) {
        removed.add("references outside the SVG");
        continue;
      }
      value = v;
    }
    if (/var\(/i.test(value)) {
      const v = paletteVars(value, found);
      if (v === null) continue;
      value = v;
    }
    noteColor(prop, value, found);
    kept.push(`${prop}:${value}`);
  }
  return kept.join(";");
}

function cleanAttrs(
  el: El,
  idPrefix: string,
  removed: Set<string>,
  found: Found,
): [string, string][] {
  const out: [string, string][] = [];
  for (const [rawName, rawValue] of el.attrs) {
    let n = rawName;
    let v = rawValue;
    const p = prefix(n);
    if (p === "xmlns" || n === "xmlns") continue;
    if (p === "xlink" && local(n) === "href") n = "href";
    else if (p === "xml" && (local(n) === "space" || local(n) === "lang")) {
      // kept as is
    } else if (p) continue; // editors' own (inkscape:, sodipodi:, …)
    // No stylesheet reaches a fence, so a class means nothing (TEMPRA-315): the palette does.
    if (n === "class") continue;
    if (/^on/i.test(n)) {
      removed.add("event handlers");
      continue;
    }
    if (SCRIPTY.test(v)) {
      removed.add("javascript: links");
      continue;
    }
    if (n === "href") {
      if (!/^#[\w.:-]+$/.test(v.trim())) {
        removed.add("references outside the SVG");
        continue;
      }
      v = `#${idPrefix}${v.trim().slice(1)}`;
    } else if (n === "id") {
      v = `${idPrefix}${v}`;
    } else if (n === "style") {
      v = cleanStyle(v, idPrefix, removed, found);
      if (!v) continue;
      out.push([n, v]);
      continue;
    } else if (/url\(/i.test(v)) {
      const u = internalUrls(v, idPrefix);
      if (u === null) {
        removed.add("references outside the SVG");
        continue;
      }
      v = u;
    } else if (n === "src" || n === "action" || n === "formaction" || v.includes("://")) {
      removed.add("references outside the SVG");
      continue;
    }
    if (/var\(/i.test(v)) {
      const kept = paletteVars(v, found);
      if (kept === null) continue;
      v = kept;
    }
    noteColor(n, v, found);
    out.push([n, v]);
  }
  return out;
}

function clean(el: El, idPrefix: string, removed: Set<string>, found: Found): (El | string)[] {
  const n = local(el.name);
  const ns = prefix(el.name);
  if (ns && ns !== "svg") return [];
  if (n === "a") {
    removed.add("links (their contents are kept)");
    return el.children.flatMap((c) =>
      typeof c === "string" ? [c] : clean(c, idPrefix, removed, found),
    );
  }
  const unsafe = UNSAFE[n];
  if (unsafe) {
    removed.add(unsafe);
    return [];
  }
  if (QUIET.has(n)) return [];
  if (!KEEP.has(n)) {
    removed.add(`unknown elements (<${n}>)`);
    return [];
  }
  const attrs = cleanAttrs(el, idPrefix, removed, found);
  // A <use> that names nothing in this SVG draws nothing; dropped with its reference.
  if (n === "use" && !attrs.some(([k]) => k === "href")) return [];
  return [
    {
      name: n,
      attrs,
      children: el.children.flatMap((c) =>
        typeof c === "string" ? [c] : clean(c, idPrefix, removed, found),
      ),
    },
  ];
}

const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => escText(s).replace(/"/g, "&quot;");

function serialize(el: El | string): string {
  if (typeof el === "string") return escText(el);
  const attrs = el.attrs.map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("");
  if (el.children.length === 0) return `<${el.name}${attrs}/>`;
  return `<${el.name}${attrs}>${el.children.map(serialize).join("")}</${el.name}>`;
}

function textOf(el: El): string {
  return el.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");
}

/** 1-based line and column of an offset. */
function place(src: string, at: number): { line: number; column: number } {
  const before = src.slice(0, Math.max(0, Math.min(at, src.length)));
  const lines = before.split("\n");
  return { line: lines.length, column: (lines[lines.length - 1] as string).length + 1 };
}

/**
 * Reads an SVG fence's source and sanitizes it. `idPrefix` is put before every id and every
 * reference to one (the reader passes one per figure; exports and renders none). `maxLength`
 * raises the size limit for SVG Tempra drew itself (a chart's, TEMPRA-207).
 */
export function sanitizeSvg(
  source: string,
  opts: { idPrefix?: string; maxLength?: number } = {},
): SvgCheck {
  const max = opts.maxLength ?? SVG_MAX_SOURCE;
  if (source.length > max) {
    return {
      ok: false,
      message: `it is longer than the limit of ${max} characters`,
      line: 0,
      column: 0,
    };
  }
  let root: El;
  try {
    root = parse(source);
  } catch (e) {
    if (e instanceof XmlError) return { ok: false, message: e.message, ...place(source, e.at) };
    throw e;
  }
  if (local(root.name) !== "svg" || (prefix(root.name) && prefix(root.name) !== "svg")) {
    return {
      ok: false,
      message: `the top element is <${root.name}>, not <svg>`,
      line: 1,
      column: 1,
    };
  }
  const removed = new Set<string>();
  const found: Found = { colors: new Set(), unknownVars: new Set() };
  const [cleaned] = clean(root, opts.idPrefix ?? "", removed, found) as [El];
  const attrs = cleaned.attrs.filter(([k]) => k !== "xmlns");
  // Sized by its viewBox, so it scales to the column; one from width and height when it has none.
  const has = (k: string) => attrs.find(([a]) => a === k)?.[1];
  const w = Number.parseFloat(has("width") ?? "");
  const h = Number.parseFloat(has("height") ?? "");
  if (!has("viewBox") && w > 0 && h > 0) attrs.push(["viewBox", `0 0 ${w} ${h}`]);
  // And its own size from its viewBox when it gives none: one unit is one CSS pixel, so a small
  // drawing is never stretched to the column, nor its text with it (TEMPRA-315).
  const box = (has("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const [bw, bh] = [box[2] ?? 0, box[3] ?? 0];
  if (has("width") === undefined && has("height") === undefined && bw > 0 && bh > 0) {
    attrs.push(["width", String(bw)], ["height", String(bh)]);
  }
  cleaned.attrs = [["xmlns", SVG_NS], ...attrs];
  const first = (name: string) => {
    const el = cleaned.children.find((c): c is El => typeof c !== "string" && c.name === name);
    return el ? textOf(el).replace(/\s+/g, " ").trim() || null : null;
  };
  return {
    ok: true,
    svg: serialize(cleaned),
    removed: [...removed],
    title: first("title"),
    desc: first("desc"),
    colors: [...found.colors],
    unknownVars: [...found.unknownVars],
  };
}

/** A fence's attribute after its language, `name="…"` (or `'…'`, or one word). */
export function fenceAttr(meta: string | null | undefined, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|'([^']*)'|(\\S+))`).exec(meta ?? "");
  const t = (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
  return t || null;
}

/**
 * A sanitized SVG standing alone, for a file (exports, TEMPRA-315): each palette `var()` written
 * as its value in `palette` (one theme's, `svgPalettes` in `@tempra/design/pele`), and the text
 * colour as the root's `color`, so `currentColor` reads as on the page, unless the root sets one.
 */
export function resolvePalette(svg: string, palette: Record<string, string>): string {
  const out = svg.replace(/var\((--[\w-]+)\)/g, (m, name: string) =>
    PALETTE.has(name) && palette[name] ? palette[name] : m,
  );
  const ink = palette["--ink"];
  const open = /^<svg\b[^>]*>/.exec(out)?.[0];
  if (!ink || !open || / color="/.test(open)) return out;
  return out.replace(/^<svg\b/, `<svg color="${escAttr(ink)}"`);
}
