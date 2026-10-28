/**
 * Diagram lint (tempra-dev: app/diagrams): every `mermaid` fence is checked on write and import, and
 * one that is plainly broken becomes lint naming its block and the line and column inside the
 * fence. Lint only: the write lands either way, and the app shows the fence's source when Pele
 * cannot draw it. Pele itself runs in the browser only; this is a small DOM-free check of what can
 * be told without parsing: the diagram header (the types Pele draws, recognized as Pele does), a
 * body after it, and, where a diagram's syntax makes them structure rather than free text, quotes
 * and brackets that open and close. It reports only what Pele refuses too (tested against Pele,
 * which reads some types leniently); anything subtler is left to the reader's notice.
 */
import {
  chartDataPaths,
  type Doc,
  fenceAttr,
  idOf,
  parseChart,
  sanitizeSvg,
  walk,
} from "@tempra/editor/doc";
import type { Code } from "mdast";
import type { LintWarning } from "./types";

/** The fences drawn as diagrams: a code block whose language is `mermaid`. */
export function isDiagram(n: { type: string; lang?: string | null }): boolean {
  return n.type === "code" && n.lang?.toLowerCase() === "mermaid";
}

/** A problem found in a diagram's source, at a 1-based line and column of the fence. */
export interface DiagramProblem {
  kind: "unsupported-diagram" | "syntax";
  message: string;
  line: number;
  column: number;
}

/**
 * Diagram types by their header, in Pele's order of detection (pele 1.6.0, `detect`), so a header
 * this accepts is one Pele draws. Tested against Pele in worker/test/diagrams.test.ts.
 */
const TYPES: [string, RegExp][] = [
  ["flowchart", /^flowchart-elk/],
  ["mindmap", /^mindmap/],
  ["architecture", /^architecture/],
  ["agentflow", /^agentflow-beta\b/],
  ["c4", /^(C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)/],
  ["kanban", /^kanban/],
  ["class", /^classDiagram/],
  ["er", /^erDiagram/],
  ["gantt", /^gantt/],
  ["info", /^info/],
  ["pie", /^pie/],
  ["requirement", /^requirement(Diagram)?/],
  ["sequence", /^sequenceDiagram/],
  ["swimlane", /^swimlane-beta\b/],
  ["flowchart", /^(graph|flowchart)/],
  ["timeline", /^timeline/],
  ["gitGraph", /^gitGraph/],
  ["state", /^stateDiagram/],
  ["journey", /^journey/],
  ["quadrantChart", /^quadrantChart/],
  ["sankey", /^sankey(-beta)?/],
  ["packet", /^packet(-beta)?/],
  ["xychart", /^xychart(-beta)?/],
  ["block", /^block(-beta)?/],
  ["eventmodeling", /^eventmodeling/],
  ["treeView", /^treeView-beta/],
  ["radar", /^radar-beta/],
  ["ishikawa", /^ishikawa(-beta)?\b/i],
  ["treemap", /^treemap/],
  ["railroad", /^railroad-(?:ebnf-|abnf-|peg-)?beta/i],
  ["venn", /^venn-beta/],
  ["wardley", /^wardley-beta/i],
  ["cynefin", /^cynefin-beta(?:[\s:]|$)/],
  ["usecase", /^usecase-beta(?:\s|$)/],
];

/** The type a header line names, or null. */
export function diagramType(header: string): string | null {
  const h = header.trimStart();
  return TYPES.find(([, re]) => re.test(h))?.[0] ?? null;
}

/** The type a fence's source names on its first line of diagram (frontmatter and comments skipped). */
export function diagramTypeOf(src: string): string | null {
  const header = contentLines(src)[0];
  return header ? diagramType(header.text) : null;
}

/** Types with no body to draw from. */
const HEADER_ONLY = new Set(["info"]);

/**
 * What is structure in the types that have it: in a flowchart, quotes and every bracket; in class,
 * ER and requirement diagrams, the braces of their blocks (members and labels are free text).
 * Elsewhere, state diagrams included (Pele reads them leniently), brackets can be free text.
 */
const STRUCTURE: Record<string, { quotes: boolean; brackets: string }> = {
  flowchart: { quotes: true, brackets: "()[]{}" },
  class: { quotes: false, brackets: "{}" },
  er: { quotes: false, brackets: "{}" },
  requirement: { quotes: false, brackets: "{}" },
};

/** Flowchart statements whose arguments are URLs, callbacks and CSS rather than structure. */
const FLOWCHART_ARGS = /^\s*(click|classDef|class|style|linkStyle)\s/;

const OPEN: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const CLOSE: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

interface Line {
  /** 1-based, in the fence. */
  n: number;
  text: string;
}

/**
 * The fence's lines without what is not the diagram: a leading `---` frontmatter block, `%%{…}%%`
 * directives (what follows one on its line stays), `%%` comments and blank lines.
 */
function contentLines(src: string): Line[] {
  const all = src.split("\n");
  const out: Line[] = [];
  let i = 0;
  while (i < all.length && (all[i] ?? "").trim() === "") i++;
  if ((all[i] ?? "").trim() === "---") {
    const end = all.findIndex((l, k) => k > i && l.trim() === "---");
    if (end !== -1) i = end + 1;
  }
  let directive = false;
  for (; i < all.length; i++) {
    const text = all[i] ?? "";
    const t = text.trim();
    if (directive || t.startsWith("%%{")) {
      const end = text.indexOf("}%%");
      directive = end === -1;
      const rest = end === -1 ? "" : text.slice(end + 3);
      if (rest.trim() !== "") out.push({ n: i + 1, text: " ".repeat(end + 3) + rest });
      continue;
    }
    if (t === "" || t.startsWith("%%")) continue;
    out.push({ n: i + 1, text });
  }
  return out;
}

/** A line with what is not structure blanked to spaces, so columns stay put. */
function structureOf(type: string, text: string): string {
  if (type === "flowchart") return FLOWCHART_ARGS.test(text) ? "" : text;
  const blank = (m: string) => " ".repeat(m.length);
  // Crow's-foot cardinality (`||--o{`, `}|..|{`) uses braces that are not blocks.
  let s = type === "er" ? text.replace(/[|}][o|](?:--|\.\.)[o|][|{]/g, blank) : text;
  // Quoted text (labels, comments) is free text, and so is what follows a colon (members, labels).
  s = s.replace(/"[^"]*"/g, blank);
  const colon = type === "er" ? -1 : s.indexOf(":");
  return colon === -1 ? s : s.slice(0, colon);
}

/** The first plainly broken thing in a diagram's source, or null. */
export function checkDiagram(src: string): DiagramProblem | null {
  const lines = contentLines(src);
  const header = lines[0];
  if (!header) {
    return {
      kind: "unsupported-diagram",
      message: "The fence has no diagram in it.",
      line: 1,
      column: 1,
    };
  }
  const type = diagramType(header.text);
  if (!type) {
    const word = header.text.trim().split(/\s/, 1)[0] ?? "";
    return {
      kind: "unsupported-diagram",
      message: `\`${word.slice(0, 40)}\` is not a diagram type Pele draws (flowchart, sequenceDiagram, classDiagram, stateDiagram, erDiagram, gantt, pie, mindmap and others).`,
      line: header.n,
      column: header.text.length - header.text.trimStart().length + 1,
    };
  }
  const body = lines.slice(1);
  if (body.length === 0 && !HEADER_ONLY.has(type)) {
    return {
      kind: "syntax",
      message: `Nothing follows \`${header.text.trim().slice(0, 40)}\`, so it draws nothing.`,
      line: header.n,
      column: header.text.trimEnd().length + 1,
    };
  }
  const structure = STRUCTURE[type];
  return structure ? balance(type, structure, body) : null;
}

/** Quotes that close, and brackets that close in order, where they are a diagram's structure. */
function balance(
  type: string,
  structure: { quotes: boolean; brackets: string },
  body: Line[],
): DiagramProblem | null {
  const stack: { ch: string; line: number; column: number }[] = [];
  // A quoted string may run over several lines (a markdown string, "`…`", or a plain one).
  let quote: { line: number; column: number; markdown: boolean } | null = null;
  for (const { n, text } of body) {
    const s = structureOf(type, text);
    let pipe = false;
    for (let k = 0; k < s.length; k++) {
      const c = s[k] as string;
      if (quote) {
        if (c === '"' && (!quote.markdown || s[k - 1] === "`")) quote = null;
        continue;
      }
      if (structure.quotes && c === '"') {
        quote = { line: n, column: k + 1, markdown: s[k + 1] === "`" };
        if (quote.markdown) k++;
        continue;
      }
      if (type === "flowchart" && stack.length === 0) {
        // Edge text between pipes is text; `id>text]` is the asymmetric shape.
        if (c === "|") pipe = !pipe;
        if (pipe || c === "|") continue;
        if (c === ">" && /\w/.test(s[k - 1] ?? "")) {
          stack.push({ ch: ">", line: n, column: k + 1 });
          continue;
        }
      }
      if (!structure.brackets.includes(c)) continue;
      if (OPEN[c]) {
        stack.push({ ch: c, line: n, column: k + 1 });
        continue;
      }
      const top = stack[stack.length - 1];
      if (!top || !(top.ch === CLOSE[c] || (top.ch === ">" && c === "]"))) {
        return {
          kind: "syntax",
          message: top
            ? `\`${c}\` closes \`${top.ch}\` from line ${top.line}, column ${top.column}.`
            : `\`${c}\` closes nothing.`,
          line: n,
          column: k + 1,
        };
      }
      stack.pop();
    }
  }
  if (quote) {
    return {
      kind: "syntax",
      message: "A quote is never closed.",
      line: quote.line,
      column: quote.column,
    };
  }
  const open = stack[stack.length - 1];
  if (open) {
    const ch = open.ch === ">" ? "]" : OPEN[open.ch];
    return {
      kind: "syntax",
      message: `\`${open.ch}\` is never closed with \`${ch}\`.`,
      line: open.line,
      column: open.column,
    };
  }
  return null;
}

/** The fences drawn as SVG figures (TEMPRA-206): a code block whose language is `svg`. */
export function isSvgFence(n: { type: string; lang?: string | null }): boolean {
  return n.type === "code" && n.lang?.toLowerCase() === "svg";
}

/**
 * Lint for an SVG fence (TEMPRA-206): `svg_invalid` when it does not parse (or is over the size
 * limit), `svg_unsafe` naming what sanitizing took out, `image_no_alt` when neither the fence's
 * `alt="…"` nor the SVG's own `<title>` says what it shows.
 */
export function svgLint(code: Code, name: string): LintWarning[] {
  const block = idOf(code);
  const r = sanitizeSvg(code.value);
  if (!r.ok) {
    const at = r.line > 0 ? ` at line ${r.line}, column ${r.column} of the fence` : "";
    return [
      {
        code: "svg_invalid",
        message: `${name} does not parse${at}: ${r.message}. The app shows its source until it does; fix the fence.`,
        block,
      },
    ];
  }
  const out: LintWarning[] = [];
  if (r.removed.length > 0) {
    out.push({
      code: "svg_unsafe",
      message: `${name} is drawn without what could run, load or link: ${r.removed.join(", ")}. Take those out of the fence (use attributes for styles, and draw what an image or a link would show).`,
      block,
    });
  }
  if (!fenceAttr(code.meta, "alt") && !r.title) {
    out.push({
      code: "image_no_alt",
      message: `${name} has no alt text: say what it shows with \`alt="…"\` after \`svg\` on the fence (or a <title> first in the SVG).`,
      block,
    });
  }
  return out;
}

/** The fences drawn as charts (TEMPRA-207): a code block whose language is `vega-lite`. */
export function isChartFence(n: { type: string; lang?: string | null }): boolean {
  return n.type === "code" && n.lang?.toLowerCase() === "vega-lite";
}

const chartName = (code: Code, n: number) => {
  const block = idOf(code);
  return `Vega-Lite chart ${n}${block ? ` (block ${block})` : ""}`;
};

/** What the write can tell of a chart without Vega: JSON, data only from the library. */
function chartProblems(code: Code): { message: string; line: number; column: number }[] {
  const r = parseChart(code.value);
  if (!r.ok) {
    return [{ message: `is not a Vega-Lite spec: ${r.message}`, line: r.line, column: r.column }];
  }
  return chartDataPaths(r.spec, "").problems.map((p) => ({ message: p, line: 0, column: 0 }));
}

/**
 * Lint for a Vega-Lite fence on write (TEMPRA-207): `chart_invalid` when it is not a JSON object
 * or names data outside the library (never fetched), `image_no_alt` when neither the fence's
 * `alt="…"` nor the spec's `description` says what it shows. Vega-Lite's own compile errors come
 * from the render service after the write (`chartRenderWarning`).
 */
export function chartLint(code: Code, name: string): LintWarning[] {
  const block = idOf(code);
  const out: LintWarning[] = chartProblems(code).map((p) => ({
    code: "chart_invalid",
    message: `${name}${p.message.startsWith("is ") ? " " : ": "}${p.message}${
      p.line > 0 ? ` (line ${p.line}, column ${p.column} of the fence)` : ""
    }. The app shows its source until it draws; fix the fence.`,
    block,
  }));
  const r = parseChart(code.value);
  const described = r.ok && typeof r.spec.description === "string" && r.spec.description.trim();
  if (r.ok && !fenceAttr(code.meta, "alt") && !described) {
    out.push({
      code: "image_no_alt",
      message: `${name} has no alt text: say what it shows with \`alt="…"\` after \`vega-lite\` on the fence (or a \`description\` in the spec).`,
      block,
    });
  }
  return out;
}

/** A chart the write's checks passed, for the render service to compile and draw (TEMPRA-207). */
export function checkedCharts(doc: Doc): CheckedFence[] {
  const out: CheckedFence[] = [];
  let n = 0;
  walk(doc, (node) => {
    if (!isChartFence(node)) return undefined;
    n++;
    const code = node as Code;
    if (chartProblems(code).length === 0) {
      out.push({ n, code, block: idOf(code), source: code.value });
    }
    return false;
  });
  return out;
}

/** Vega's verdict on a chart the write's checks passed: `chart_invalid`, with its message. */
export function chartRenderWarning(f: CheckedFence, e: RenderFailure): LintWarning {
  const message = e.message.trim().replace(/[.…]?$/, (end) => end || ".");
  return {
    code: "chart_invalid",
    message: `${chartName(f.code, f.n)} could not be drawn by Vega: ${message} The app shows its source until it draws; fix the fence (\`render\` previews it).`,
    block: f.block,
    rendered: true,
  };
}

/**
 * What a write would lint in one SVG or chart fence, for `render`'s preview of a source not yet
 * written (TEMPRA-213): the same checks, the fence named as what it is rather than by its place.
 * `image_no_alt` only when the fence's header was given, since that is where alt text goes.
 */
export function previewLint(lang: string, source: string, meta: string | null): LintWarning[] {
  const code: Code = { type: "code", lang, meta, value: source };
  const found =
    lang === "svg"
      ? svgLint(code, "The SVG")
      : lang === "vega-lite"
        ? chartLint(code, "The chart")
        : [];
  return meta === null ? found.filter((l) => l.code !== "image_no_alt") : found;
}

/** Lint for each diagram in a body that is plainly broken, and for each SVG and chart fence. */
export function diagramLint(doc: Doc): LintWarning[] {
  const out: LintWarning[] = [];
  let n = 0;
  let svgs = 0;
  let charts = 0;
  walk(doc, (node) => {
    if (isSvgFence(node)) {
      const code = node as Code;
      const block = idOf(code);
      out.push(...svgLint(code, `SVG figure ${++svgs}${block ? ` (block ${block})` : ""}`));
      return false;
    }
    if (isChartFence(node)) {
      out.push(...chartLint(node as Code, chartName(node as Code, ++charts)));
      return false;
    }
    if (!isDiagram(node)) return undefined;
    n++;
    const code = node as Code;
    const problem = checkDiagram(code.value);
    if (problem) out.push(diagramWarning(code, n, problem));
    return false;
  });
  return out;
}

/** "Mermaid diagram 2 (`flowchart LR`, block b7)": a diagram by its place, first line and block. */
function diagramName(code: Code, n: number): string {
  const first =
    code.value
      .split("\n")
      .find((l) => l.trim() !== "")
      ?.trim() || "(empty)";
  const block = idOf(code);
  return `Mermaid diagram ${n} (\`${first.slice(0, 40)}\`${block ? `, block ${block}` : ""})`;
}

function diagramWarning(code: Code, n: number, p: DiagramProblem): LintWarning {
  const kind = p.kind === "unsupported-diagram" ? "is not a diagram" : "has a syntax error";
  return {
    code: "diagram_invalid",
    message: `${diagramName(code, n)} ${kind} at line ${p.line}, column ${p.column} of the fence: ${p.message} The app shows its source until it draws; fix the fence.`,
    block: idOf(code),
  };
}

/**
 * A diagram the fast check passed, for the render service to try (TEMPRA-167): its place among
 * the body's diagrams, its block and its source.
 */
export interface CheckedFence {
  n: number;
  code: Code;
  block: string | undefined;
  source: string;
}

/** The body's diagrams that `diagramLint` finds nothing wrong with, in order. */
export function checkedFences(doc: Doc): CheckedFence[] {
  const out: CheckedFence[] = [];
  let n = 0;
  walk(doc, (node) => {
    if (!isDiagram(node)) return undefined;
    n++;
    const code = node as Code;
    if (!checkDiagram(code.value)) out.push({ n, code, block: idOf(code), source: code.value });
    return false;
  });
  return out;
}

/** Where Pele failed and why, at a 1-based line and column of the fence (0 when it names none). */
export interface RenderFailure {
  message: string;
  line: number;
  column: number;
}

/**
 * Lint for a diagram the fast check passed and Pele, on the render service, could not draw
 * (TEMPRA-167): `diagram_unrendered`, with Pele's message and place in the fence.
 */
export function unrenderedWarning(f: CheckedFence, e: RenderFailure): LintWarning {
  const at =
    e.line > 0
      ? ` at line ${e.line}${e.column > 0 ? `, column ${e.column}` : ""} of the fence`
      : "";
  const message = e.message.trim().replace(/[.…]?$/, (end) => end || ".");
  return {
    code: "diagram_unrendered",
    message: `${diagramName(f.code, f.n)} could not be drawn by Pele${at}: ${message} The app shows its source until it draws; fix the fence.`,
    block: f.block,
    rendered: true,
  };
}
