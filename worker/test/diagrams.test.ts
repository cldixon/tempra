import { describe, expect, test } from "bun:test";
import { parseMarkdown, reconcile } from "@tempra/editor/doc";
import { diagramLint } from "../src/okf/diagrams";
import { LibraryStore, type RequestContext } from "../src/store/store";
import { bunSqlHandle } from "./sqlite";

const fence = (src: string, lang = "mermaid") => `\`\`\`${lang}\n${src}\n\`\`\``;
const good = "flowchart LR\n  A[Write] --> B{Parses?}\n  B -->|yes| C[Drawn]";
const broken = "sequenceDiagram\n  Alice->>: hi";

const md = (body: string) =>
  `---\ntype: Memo\ndescription: A test concept.\nstatus: stable\n---\n${body}\n`;

let n = 0;
const ctx = (): RequestContext => ({ actor: "claude-code/test", request_id: `req-${++n}` });

const codes = (lint: { code: string }[]) => lint.map((l) => l.code);

describe("diagram lint (TEMPRA-98)", () => {
  test("a diagram that parses, and other fences, are no lint", () => {
    const doc = reconcile(null, parseMarkdown(`${fence(good)}\n\n${fence("not mermaid", "text")}`));
    expect(diagramLint(doc)).toEqual([]);
  });

  test("a broken fence names its block, the line and column, and the error", () => {
    const doc = reconcile(null, parseMarkdown(`Intro.\n\n${fence(good)}\n\n${fence(broken)}`));
    const [w, ...rest] = diagramLint(doc);
    expect(rest).toEqual([]);
    expect(w?.code).toBe("diagram_invalid");
    expect(w?.block).toBe((doc.children[2] as { id?: string }).id);
    expect(w?.message).toContain("Mermaid diagram 2 (`sequenceDiagram`");
    expect(w?.message).toContain("has a syntax error at line 2, column 11 of the fence");
    expect(w?.message).toContain("Expecting 'ACTOR', got 'TXT'.");
    // Input that ends too soon is placed at the end of the fence, not on a line past it.
    const open = reconcile(null, parseMarkdown(fence("flowchart LR\n  A --> B[[")));
    expect(diagramLint(open)[0]?.message).toContain("at the end of the fence");
  });

  test("an unknown diagram type, and one over the size limit", () => {
    const doc = reconcile(
      null,
      parseMarkdown(
        `${fence("notadiagram\n  x")}\n\n${fence(`flowchart TD\n${"  a --> b\n".repeat(6000)}`)}`,
      ),
    );
    const lint = diagramLint(doc);
    expect(lint.map((l) => l.message.match(/is (.*?)[:.]/)?.[1])).toEqual([
      "not a diagram type Pele draws",
      "over Pele's size limits",
    ]);
  });

  test("a write lands with the lint, stores it, and a fix clears it; import lints too", () => {
    const s = new LibraryStore(bunSqlHandle());
    const res = s.apply(ctx(), [{ op: "write", path: "d.md", content: md(fence(broken)) }]);
    expect(codes(res.results[0]?.lint ?? [])).toEqual(["diagram_invalid"]);
    const v = s.read("d");
    expect(v.kind === "concept" && codes(v.lint)).toEqual(["diagram_invalid"]);
    expect(s.work({ kind: "lint" }).items.map((i) => i.path)).toEqual(["d.md"]);
    const hash = v.kind === "concept" ? v.hash : "";
    const fixed = s.apply(ctx(), [
      { op: "write", path: "d.md", content: md(fence(good)), if_match: hash },
    ]);
    expect(fixed.results[0]?.lint).toEqual([]);
    const imported = s.import(ctx(), [{ path: "e.md", markdown: md(fence(broken)) }]);
    expect(imported.warnings.flatMap((w) => codes(w.lint))).toContain("diagram_invalid");
  });
});
