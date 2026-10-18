/**
 * Diagram lint (tempra-dev: app/diagrams): every `mermaid` fence is parsed with Pele on write and
 * import, and one that does not parse becomes lint naming its block and the line and column inside
 * the fence. Lint only: the write lands either way, and the app shows the fence's source. Pele's
 * parse is synchronous and DOM-free, with its default limits, so it runs in the write path.
 */

import { type Doc, idOf, walk } from "@tempra/editor/doc";
import type { Code } from "mdast";
import { PeleError, parse } from "pele";
import type { LintWarning } from "./types";

/** The fences drawn as diagrams: a code block whose language is `mermaid`. */
export function isDiagram(n: { type: string; lang?: string | null }): boolean {
  return n.type === "code" && n.lang?.toLowerCase() === "mermaid";
}

/** Lint for each diagram in a body that Pele cannot parse. */
export function diagramLint(doc: Doc): LintWarning[] {
  const out: LintWarning[] = [];
  let n = 0;
  walk(doc, (node) => {
    if (!isDiagram(node)) return undefined;
    n++;
    const code = node as Code;
    try {
      parse(code.value);
    } catch (e) {
      out.push(diagramWarning(code, n, e));
    }
    return false;
  });
  return out;
}

function diagramWarning(code: Code, n: number, e: unknown): LintWarning {
  const first = code.value.split("\n", 1)[0]?.trim() || "(empty)";
  const block = idOf(code);
  const which = `Mermaid diagram ${n} (\`${first.slice(0, 40)}\`${block ? `, block ${block}` : ""})`;
  const tail = "The app shows its source until it parses; fix the fence.";
  if (!(e instanceof PeleError)) {
    return { code: "diagram_invalid", message: `${which} could not be parsed. ${tail}`, block };
  }
  const at =
    e.line > code.value.split("\n").length
      ? " at the end of the fence"
      : e.line > 0
        ? ` at line ${e.line}, column ${e.column} of the fence`
        : "";
  const kind = {
    syntax: "has a syntax error",
    semantic: "is not valid",
    limit: "is over Pele's size limits",
    "unsupported-diagram": "is not a diagram type Pele draws",
  }[e.code];
  return {
    code: "diagram_invalid",
    message: `${which} ${kind}${at}: ${reasonOf(e)} ${tail}`,
    block,
  };
}

/**
 * What went wrong, in a line: a parse error's last line ("Expecting …, got …"), else the first,
 * without the snippet and caret Pele puts between them (the line and column say where).
 */
function reasonOf(e: PeleError): string {
  const lines = e.message.split("\n").filter((l) => l.trim() !== "");
  const last = lines[lines.length - 1] ?? "";
  const pick = lines.length > 1 && /^Expecting /.test(last) ? last : (lines[0] ?? "");
  const line = pick.replace(/:$/, "").trim();
  return /[.!?]$/.test(line) ? line : `${line}.`;
}
