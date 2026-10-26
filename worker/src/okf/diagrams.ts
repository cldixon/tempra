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
import { type Doc, idOf, walk } from "@tempra/editor/doc";
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

/** Lint for each diagram in a body that is plainly broken. */
export function diagramLint(doc: Doc): LintWarning[] {
  const out: LintWarning[] = [];
  let n = 0;
  walk(doc, (node) => {
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
  };
}
