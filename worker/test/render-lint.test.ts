/**
 * Diagram lint from the real renderer (TEMPRA-167): after a write commits, the diagrams the fast
 * checker passed go to the render service, and a fence Pele refuses becomes `diagram_unrendered`.
 * The render service is a double here, drawing with Pele itself (a dev dependency).
 */
import { describe, expect, test } from "bun:test";
import { PeleError, render as peleRender } from "pele";
import { fakeRenderer, type RenderResult, serviceRenderer } from "../src/render";
import { LibraryStore, RENDERS_PER_WRITE } from "../src/store/store";
import { writeTar } from "../src/util/tar";
import { setup } from "./harness";
import { bunSqlHandle } from "./sqlite";

const fence = (src: string) => `\`\`\`mermaid\n${src}\n\`\`\``;
const md = (body: string) =>
  `---\ntype: Memo\ntitle: D\ndescription: A test concept.\nstatus: stable\n---\n${body}\n`;
const GOOD = "flowchart LR\n  A --> B";
/** Balanced and of a known type, so the fast checker passes it; Pele refuses the arrow. */
const SUBTLE = "flowchart LR\n  A -->> B";

/** The render service as a double, answering as Pele does. */
const pele = (delayMs = 0) =>
  fakeRenderer(async (req): Promise<RenderResult> => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    try {
      return { svg: peleRender(req.source).svg };
    } catch (e) {
      if (!(e instanceof PeleError)) throw e;
      return {
        error: { message: e.message.split("\n", 1)[0] ?? "", line: e.line, column: e.column },
      };
    }
  });

type Put = { hash: string; lint: { code: string; message: string; block?: string }[] };
const codes = (lint: { code: string }[]) => lint.map((l) => l.code);

function world(render = pele(), budgetMs?: number) {
  const s = setup();
  s.deps.renderDiagram = render;
  if (budgetMs !== undefined) s.deps.renderBudgetMs = budgetMs;
  const put = async (path: string, body: string, ifMatch?: string) => {
    const r = await s.req(`/files/${path}`, {
      method: "PUT",
      body: md(body),
      headers: ifMatch ? { "If-Match": `"${ifMatch}"` } : { "If-None-Match": "*" },
    });
    expect(r.status).toBe(200);
    return (await r.json()) as Put;
  };
  const lintOf = async (path: string) => {
    const r = await s.req(`/files/${path}`, { headers: { Accept: "application/json" } });
    return ((await r.json()) as { lint: Put["lint"] }).lint;
  };
  return { ...s, render, put, lintOf };
}

describe("diagram_unrendered (TEMPRA-167)", () => {
  test("a subtle error lints after the write, in its result, read and work; a fix clears it", async () => {
    const w = world();
    const first = await w.put("d.md", `Intro.\n\n${fence(GOOD)}\n\n${fence(SUBTLE)}`);
    const [lint, ...rest] = first.lint.filter((l) => l.code === "diagram_unrendered");
    expect(rest).toEqual([]);
    expect(codes(first.lint)).not.toContain("diagram_invalid");
    expect(lint?.message).toContain("Mermaid diagram 2 (`flowchart LR`");
    expect(lint?.message).toContain("could not be drawn by Pele at line 2, column 8 of the fence");
    expect(lint?.block).toBeTruthy();
    // SVG only, light, one call per diagram.
    expect(w.render.calls.map((c) => [c.source, c.png])).toEqual([
      [GOOD, false],
      [SUBTLE, false],
    ]);
    expect(codes(await w.lintOf("d.md"))).toEqual(["diagram_unrendered"]);
    const work = w.store().work({ kind: "lint" });
    expect(
      work.items.map((i) => [i.path, i.detail.includes("could not be drawn by Pele")]),
    ).toEqual([["d.md", true]]);

    // An edit elsewhere keeps the verdict without asking again.
    const again = await w.put(
      "d.md",
      `Intro, edited.\n\n${fence(GOOD)}\n\n${fence(SUBTLE)}`,
      first.hash,
    );
    expect(codes(again.lint)).toEqual(["diagram_unrendered"]);
    expect(w.render.calls.length).toBe(2);

    const fixed = await w.put(
      "d.md",
      `Intro.\n\n${fence(GOOD)}\n\n${fence("flowchart LR\n  A --> C")}`,
      again.hash,
    );
    expect(fixed.lint).toEqual([]);
    expect(await w.lintOf("d.md")).toEqual([]);
    expect(w.store().work({ kind: "lint" }).items).toEqual([]);
    expect(w.render.calls.length).toBe(3);
  });

  test("a fence the fast checker reports is not sent, nor reported twice", async () => {
    const w = world();
    const r = await w.put("d.md", fence("flowchart LR\n  A[Start --> B"));
    expect(codes(r.lint)).toEqual(["diagram_invalid"]);
    expect(w.render.calls).toEqual([]);
  });

  test("past the budget, the lint lands later; an older version's late answer is ignored", async () => {
    const w = world(pele(30), 1);
    const first = await w.put("d.md", fence(SUBTLE));
    expect(first.lint).toEqual([]);
    await w.settled();
    expect(codes(await w.lintOf("d.md"))).toEqual(["diagram_unrendered"]);

    // A write whose render is still out, then a newer write before it answers.
    const slow = await w.put("e.md", fence("sequenceDiagram\n  A->>B hello"));
    const s = w.store();
    const newer = s.apply({ actor: "claude-code/test", request_id: "r-newer" }, [
      { op: "write", path: "e.md", content: md("No diagram now."), if_match: slow.hash },
    ]);
    expect(newer.render).toBeUndefined();
    await w.settled();
    expect(await w.lintOf("e.md")).toEqual([]);
  });

  test("the store ignores verdicts for a version that is not the concept's current one", () => {
    const s = new LibraryStore(bunSqlHandle());
    const ctx = (id: string) => ({ actor: "claude-code/test", request_id: id });
    const a = s.apply(ctx("a"), [{ op: "write", path: "d.md", content: md(fence(SUBTLE)) }]);
    const job = a.render?.[0];
    expect(job?.diagrams.map((d) => d.source)).toEqual([SUBTLE]);
    s.apply(ctx("b"), [
      {
        op: "write",
        path: "d.md",
        content: md(`Text.\n\n${fence(SUBTLE)}`),
        if_match: a.results[0]?.hash,
      },
    ]);
    const key = job?.diagrams[0]?.key ?? "";
    const error = { message: "Parse error on line 2:", line: 2, column: 8 };
    expect(
      s.setDiagramRenders([
        { concept_id: job?.concept_id ?? "", hash: job?.hash ?? "", verdicts: [{ key, error }] },
      ]),
    ).toEqual([]);
    const v = s.read("d");
    expect(v.kind === "concept" && v.lint).toEqual([]);
    // The verdict is kept, so the next write lints at once without asking.
    const c = s.apply(ctx("c"), [
      {
        op: "write",
        path: "d.md",
        content: md(`Other.\n\n${fence(SUBTLE)}`),
        if_match: v.kind === "concept" ? v.hash : null,
      },
    ]);
    expect(c.render).toBeUndefined();
    expect(codes(c.results[0]?.lint ?? [])).toEqual(["diagram_unrendered"]);
  });

  test("render unavailable leaves no lint and fails no write; the next write asks again", async () => {
    const w = world(Object.assign(serviceRenderer(undefined), { calls: [] }));
    const first = await w.put("d.md", fence(SUBTLE));
    expect(first.lint).toEqual([]);
    await w.settled();
    expect(await w.lintOf("d.md")).toEqual([]);
    const s = w.store();
    const again = s.apply({ actor: "claude-code/test", request_id: "r2" }, [
      { op: "write", path: "d.md", content: md(`Text.\n\n${fence(SUBTLE)}`), if_match: first.hash },
    ]);
    expect(again.render?.[0]?.diagrams.length).toBe(1);
  });

  test(`at most ${RENDERS_PER_WRITE} renders per write`, async () => {
    const w = world();
    const body = Array.from({ length: RENDERS_PER_WRITE + 3 }, (_, i) =>
      fence(`flowchart LR\n  A${i} --> B${i}`),
    ).join("\n\n");
    await w.put("d.md", body);
    expect(w.render.calls.length).toBe(RENDERS_PER_WRITE);
  });

  test("import lints too", async () => {
    const w = world();
    const enc = (s: string) => new TextEncoder().encode(s);
    const r = await w.req("/import", {
      method: "POST",
      body: writeTar([
        { path: "a.md", bytes: enc(md(fence(SUBTLE))) },
        { path: "b.md", bytes: enc(md(fence(GOOD))) },
      ]) as unknown as BodyInit,
      headers: { "Content-Type": "application/x-tar" },
    });
    expect(r.status).toBe(200);
    const res = (await r.json()) as {
      warnings: { path: string; lint: { code: string }[] }[];
      render?: unknown;
    };
    expect(res.render).toBeUndefined();
    expect(res.warnings.map((x) => [x.path, codes(x.lint)])).toEqual([
      ["a.md", ["diagram_unrendered"]],
    ]);
    expect(codes(await w.lintOf("a.md"))).toEqual(["diagram_unrendered"]);
  });

  test("renders are metered against the writer's account", async () => {
    const w = world();
    // The double does not meter; the service client does.
    const metered: string[] = [];
    w.deps.renderDiagram = serviceRenderer({ render: async () => ({ svg: "<svg></svg>" }) }, (e) =>
      metered.push(`${e.kind}:${e.account}:${e.library}`),
    );
    await w.put("d.md", fence(GOOD));
    await w.settled();
    expect(metered).toEqual(["render:owner:lib-1"]);
  });
});
