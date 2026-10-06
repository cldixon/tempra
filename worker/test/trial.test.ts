/**
 * Fixes from the 2026-10-06 MCP trial (TEMPRA-24, tempra-dev: feedback/mcp-trial-2026-10-06): one
 * test per finding, named by its issue.
 */
import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { OkfError } from "../src/store/errors";
import { LibraryStore, type RequestContext } from "../src/store/store";
import { setup } from "./harness";
import { bunSqlHandle } from "./sqlite";

let n = 0;
const ctx = (actor = "claude-code/test", note?: string): RequestContext => ({
  actor,
  request_id: `req-${++n}`,
  note,
});
const human = () => ctx("human:ana");

function newStore(sql = bunSqlHandle()) {
  let t = Date.parse("2026-10-06T12:00:00Z");
  return new LibraryStore(sql, {
    now: () => {
      t += 1000;
      return new Date(t);
    },
  });
}

function errorOf(fn: () => unknown): OkfError {
  try {
    fn();
  } catch (e) {
    if (e instanceof OkfError) return e;
    throw e;
  }
  throw new Error("expected an OkfError");
}

/** A conformant concept: a specific type, a description and a status. */
const md = (body: string, extra = "") =>
  `---\ntype: Memo\ndescription: A test concept.\nstatus: stable\n${extra}---\n${body}`;

const concept = (s: LibraryStore, path: string) => {
  const v = s.read(path);
  if (v.kind !== "concept") throw new Error(`${path} is not a concept`);
  return v;
};
const codes = (lint: { code: string }[] | undefined) => (lint ?? []).map((l) => l.code);

type Text = { type: "text"; text: string };

async function connect(app: ReturnType<typeof setup>["app"]) {
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    requestInit: { headers: { Authorization: "Bearer writer" } },
    fetch: async (url, init) => app.request(url.toString(), init as RequestInit),
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { text: (r.content as Text[]).map((c) => c.text).join("\n"), isError: !!r.isError };
  };
}

const hashOf = (text: string) => /hash: ([0-9a-f]{64})/.exec(text)?.[1] ?? "";

describe("MCP trial 2026-10-06", () => {
  test("TEMPRA-25: restoring a deleted target clears its inbound links' broken-link lint", () => {
    const s = newStore();
    s.apply(ctx(), [
      { op: "write", path: "g.md", content: md("G.\n") },
      { op: "write", path: "b.md", content: md("See [g](/g.md).\n") },
    ]);
    const del = s.apply(ctx(), [{ op: "delete", path: "g.md", if_match: concept(s, "g.md").hash }]);
    expect(codes(concept(s, "b.md").lint)).toEqual(["broken_link"]);
    expect(s.work().items.map((i) => [i.kind, i.path])).toEqual([["broken_link", "b.md"]]);

    s.revert(ctx(), { request_id: del.request_id });
    expect(s.links("g.md").inbound.map((l) => l.path)).toEqual(["b.md"]);
    expect(concept(s, "b.md").lint).toEqual([]);
    expect(s.work().items).toEqual([]);
  });

  test("TEMPRA-27: writes refuse a concept with no frontmatter, invalid YAML or no type", () => {
    const s = newStore();
    const head = s.headSeq();
    const none = errorOf(() =>
      s.apply(ctx(), [{ op: "write", path: "a.md", content: "# Just a body\n" }]),
    );
    expect([none.status, none.code]).toEqual([400, "missing_type"]);
    expect(none.message).toContain("no YAML frontmatter");
    const yaml = errorOf(() =>
      s.apply(ctx(), [
        { op: "write", path: "a.md", content: "---\ntype: Memo\ntitle: [unclosed\n---\nx\n" },
      ]),
    );
    expect([yaml.status, yaml.code]).toEqual([400, "bad_frontmatter"]);
    expect(yaml.message).toMatch(/not valid YAML \(line \d+ of the file\)/);
    const untyped = errorOf(() =>
      s.apply(ctx(), [{ op: "write", path: "a.md", content: "---\ntitle: A\n---\nx\n" }]),
    );
    expect([untyped.status, untyped.code]).toEqual([400, "missing_type"]);
    expect(s.headSeq()).toBe(head);

    // Import keeps such files, with lint; a write that fixes one is accepted, an edit that
    // leaves it invalid is not.
    s.import(ctx(), [{ path: "b.md", markdown: "---\ntitle: B\n---\nx\n" }]);
    expect(codes(concept(s, "b.md").lint)).toContain("missing_type");
    const edit = errorOf(() =>
      s.apply(ctx(), [{ op: "edit", path: "b.md", edits: [{ old: "x", new: "y" }] }]),
    );
    expect(edit.code).toBe("missing_type");
    s.apply(ctx(), [
      {
        op: "edit",
        path: "b.md",
        edits: [{ old: "title: B", new: "type: Memo\ntitle: B\ndescription: B.\nstatus: draft" }],
      },
    ]);
    expect(concept(s, "b.md").lint).toEqual([]);
  });

  test("TEMPRA-28: search indexes text, highlights runs once, and never inside link targets", () => {
    const sql = bunSqlHandle();
    const s = newStore(sql);
    s.apply(ctx(), [
      {
        op: "write",
        path: "a.md",
        content: md(
          "The **Wordgard document** is stored, see [the decision](/decisions/structured-documents.md) on markdown.\n",
        ),
      },
    ]);
    const [hit] = s.search("wordgard document markdown").results;
    expect(hit?.snippet).toContain("**Wordgard document**");
    expect(hit?.snippet).toContain("**markdown**");
    expect(hit?.snippet).not.toContain("****");
    expect(hit?.snippet).not.toContain("/decisions");
    // A link target is not text: searching for it finds nothing.
    expect(s.search("decisions").results).toEqual([]);

    // A library indexed before (markdown in the index) is reindexed once when opened.
    sql.run("UPDATE fts SET body = 'stale markdown **x**'");
    sql.run("DELETE FROM meta WHERE key = 'fts_text'");
    const reopened = newStore(sql);
    expect(reopened.search("wordgard").results.map((r) => r.path)).toEqual(["a.md"]);
    expect(reopened.search("stale").results).toEqual([]);
  });

  test("TEMPRA-32: log.md labels each file in a mixed request and links where files are now", () => {
    const s = newStore();
    s.apply(ctx(), [{ op: "write", path: "a.md", content: md("A.\n") }]);
    s.apply(ctx("agent/2", "both"), [
      { op: "write", path: "b.md", content: md("B.\n") },
      { op: "write", path: "a.md", content: md("A2.\n"), if_match: concept(s, "a.md").hash },
    ]);
    expect(s.log()).toContain(
      "* **Changes** by `agent/2`: both created [b.md](/b.md), updated [a.md](/a.md)",
    );
    s.apply(ctx(), [{ op: "move", path: "a.md", to: "x/a.md" }]);
    expect(s.log()).toContain("* **Move** by `claude-code/test`: a.md → [x/a.md](/x/a.md)");
    expect(s.log()).toContain("updated [a.md](/x/a.md)");
  });

  test("TEMPRA-34: comment work items read cleanly", () => {
    const s = newStore();
    s.apply(ctx(), [{ op: "write", path: "a.md", content: md("Body.\n") }]);
    const t = s.comment(human(), { kind: "open", path: "a.md", body: "Fix this." }).thread;
    s.comment(ctx(), { kind: "reply", thread: t.id, body: "On it." });
    const [item] = s.work({ kind: "comment" }).items;
    expect(item?.detail).toBe("human:ana commented: Fix this. (1 reply, last by claude-code/test)");
  });

  test("TEMPRA-36: writes lint what the instructions ask for; imports do not", () => {
    const s = newStore();
    s.apply(ctx(), [{ op: "write", path: "guide.md", content: md("# Guide\n\nHi.\n") }]);
    const loose =
      "---\ntype: note\nstale_after: 2020-01-01T00:00:00Z\n---\nSee [g](guide.md) and [h](/guide.md#no-such-heading) and [ok](/guide.md#guide).\n\n[^orphan]: Never cited.\n";
    const r = s.apply(ctx(), [{ op: "write", path: "x.md", content: loose }]).results[0];
    expect(codes(r?.lint)).toEqual([
      "generic_type",
      "missing_description",
      "missing_status",
      "footnote_uncited",
      "relative_link",
    ]);
    expect(codes(r?.notices)).toEqual(["stale_on_write", "missing_heading"]);
    expect(r?.notices?.[1]?.message).toContain("#no-such-heading");

    const imported = s.import(ctx(), [{ path: "y.md", markdown: loose }]);
    expect(imported.warnings).toEqual([]);
  });

  test("TEMPRA-38: a write reports when it was stored in a different form", () => {
    const s = newStore();
    const r = s.apply(ctx(), [
      {
        op: "write",
        path: "a.md",
        content: md("* one\n* two\n", "sources:\n  - id: a\n    resource: https://e.com\n"),
      },
    ]).results[0];
    expect(codes(r?.notices)).toEqual(["normalized"]);
    expect(r?.normalized).toContain("-* one");
    expect(r?.normalized).toContain("+- one");
    // Writing the stored form back, or editing it, reports nothing.
    const v = concept(s, "a.md");
    const again = s.apply(ctx(), [
      { op: "write", path: "a.md", content: v.markdown, if_match: v.hash },
    ]);
    expect(again.results[0]?.normalized).toBeUndefined();
    const edited = s.apply(ctx(), [
      { op: "edit", path: "a.md", edits: [{ old: "- two", new: "- three" }] },
    ]);
    expect(edited.results[0]?.notices).toBeUndefined();
  });

  test("TEMPRA-39: diffs leave out the generated stamp; query matches type in any case", () => {
    const s = newStore();
    s.apply(ctx(), [{ op: "write", path: "a.md", content: md("One.\n") }]);
    s.apply(ctx(), [
      { op: "write", path: "a.md", content: md("Two.\n"), if_match: concept(s, "a.md").hash },
    ]);
    const d = s.diff("a.md").diff;
    expect(d).toContain("+Two.");
    expect(d).not.toContain("generated");
    expect(s.concepts({ type: "memo" }).total).toBe(1);
    const none = s.concepts({ type: "mem" });
    expect(none.total).toBe(0);
    expect(none.types).toEqual(["Memo"]);
  });

  test("TEMPRA-40: an edit names open threads and the ones it left outdated", () => {
    const s = newStore();
    s.apply(ctx(), [{ op: "write", path: "a.md", content: md("Keep this. Drop that.\n") }]);
    const t = s.comment(human(), {
      kind: "open",
      path: "a.md",
      body: "Why?",
      anchor: { quote: "Drop that." },
    }).thread;
    const r = s.apply(ctx(), [
      { op: "edit", path: "a.md", edits: [{ old: " Drop that.", new: "" }] },
    ]).results[0];
    expect(codes(r?.notices)).toEqual(["open_comments", "comment_outdated"]);
    expect(r?.notices?.[0]?.message).toContain(t.id);
    expect(r?.notices?.[1]?.message).toContain("Drop that.");
  });
});

describe("MCP trial 2026-10-06, through the MCP tools", () => {
  test("TEMPRA-29, 33, 35, 37: read header, move results, transcripts and errors", async () => {
    const { app } = setup();
    const call = await connect(app);
    const plain = "---\ntype: Memo\ndescription: No status.\n---\nBody.\n";
    let r = await call("write", { path: "d/a.md", content: plain });
    expect(r.text).toContain("missing_status");
    expect((await call("read", { path: "d/a.md" })).text).toContain(
      "status: not set (reads as stable)",
    );

    // Creating over an existing path is a 409 that says how to replace it.
    r = await call("write", { path: "d/a.md", content: plain });
    expect(r.text).toContain("Error 409 exists");
    expect(r.text).toContain("pass current_hash as if_match");

    await call("write", { path: "d/b.md", content: md("B.\n") });
    r = await call("move", { from: "d", to: "e" });
    expect(r.text).toContain("Moved to d/a.md → e/a.md (move, seq ");
    expect(r.text).toContain("Moved to d/b.md → e/b.md (move, seq ");
    expect(r.text).toContain("(2 files, seq ");

    // A moved path says where the file went; a deleted one says how to get it back.
    r = await call("read", { path: "d/a.md" });
    expect(r.text).toContain("Error 404 moved");
    expect(r.text).toContain("it moved to e/a.md");
    const hb = hashOf((await call("read", { path: "e/b.md" })).text);
    await call("delete", { path: "e/b.md", if_match: hb });
    r = await call("read", { path: "e/b.md" });
    expect(r.text).toContain("Error 404 deleted");

    // A batch error names the op that failed.
    r = await call("batch", {
      ops: [
        { op: "write", path: "c.md", content: md("C.\n") },
        { op: "edit", path: "e/a.md", edits: [{ old: "nowhere", new: "x" }] },
      ],
    });
    expect(r.text).toContain("Op 2 of 2 (edit e/a.md)");

    // The transcript shows a resolve with its note and a reopen.
    r = await call("comment", { action: "open", path: "e/a.md", body: "Add a status." });
    const thread = /Opened thread (\S+)/.exec(r.text)?.[1] ?? "";
    await call("comment", { action: "resolve", thread, body: "Done." });
    await call("comment", { action: "reopen", thread });
    const transcript = (await call("comments", { path: "e/a.md" })).text;
    expect(transcript).toMatch(/- claude-code\/test at \S+:\n {2}Add a status\./);
    expect(transcript).toMatch(/- claude-code\/test resolved it at \S+:\n {2}Done\./);
    expect(transcript).toMatch(/- claude-code\/test reopened it at \S+\./);
  });
});
