import { describe, expect, test } from "bun:test";
import { linkParam } from "./src/bridge";
import type { LinkTarget } from "./src/links";
import { conflicts, merge3, mergeDocs, mergeFields, resolve } from "./src/merge";
import { reconcile } from "./src/reconcile";
import { type Doc, parseMarkdown, toMarkdown } from "./src/tree";

describe("merge3", () => {
  const key = (x: string) => x;
  const base = ["# Margin", "Margin is revenue minus cost.", "", "Reported monthly."];
  const swap = (lines: string[], from: string, to: string) => lines.map((l) => l.replace(from, to));

  test("edits to different items merge by themselves", () => {
    const mine = swap(base, "revenue minus cost", "net sales minus COGS");
    const theirs = swap(base, "Reported monthly.", "Reported monthly, in USD.");
    const segs = merge3(base, mine, theirs, key);
    expect(conflicts(segs)).toHaveLength(0);
    expect(resolve(segs, () => "mine")).toEqual([
      "# Margin",
      "Margin is net sales minus COGS.",
      "",
      "Reported monthly, in USD.",
    ]);
  });

  test("an insertion and an edit elsewhere both land", () => {
    const mine = ["# Margin", "An intro.", ...base.slice(1)];
    const theirs = swap(base, "monthly", "weekly");
    const out = resolve(merge3(base, mine, theirs, key), () => "mine");
    expect(out).toEqual([
      "# Margin",
      "An intro.",
      "Margin is revenue minus cost.",
      "",
      "Reported weekly.",
    ]);
  });

  test("the same item changed both ways is a conflict with both sides", () => {
    const mine = swap(base, "revenue minus cost", "net sales minus COGS");
    const theirs = swap(base, "revenue minus cost", "revenue less returns");
    const segs = merge3(base, mine, theirs, key);
    const c = conflicts(segs);
    expect(c).toHaveLength(1);
    expect(c[0]?.mine).toEqual(["Margin is net sales minus COGS."]);
    expect(c[0]?.theirs).toEqual(["Margin is revenue less returns."]);
    expect(resolve(segs, () => "theirs")).toEqual(theirs);
    expect(resolve(segs, () => "mine")).toEqual(mine);
  });

  test("the same change on both sides is no conflict; unchanged sides return the other", () => {
    const edited = swap(base, "monthly", "weekly");
    expect(conflicts(merge3(base, edited, edited, key))).toHaveLength(0);
    expect(resolve(merge3(base, base, edited, key), () => "mine")).toEqual(edited);
    expect(resolve(merge3(base, edited, base, key), () => "mine")).toEqual(edited);
  });

  test("a deletion on one side and an edit elsewhere", () => {
    const mine = base.slice(0, 3);
    const theirs = swap(base, "# Margin", "# Gross margin");
    expect(resolve(merge3(base, mine, theirs, key), () => "mine")).toEqual([
      "# Gross margin",
      "Margin is revenue minus cost.",
      "",
    ]);
  });
});

describe("mergeDocs", () => {
  const body = "# Margin\n\nMargin is revenue minus cost.\n\nReported monthly.";
  const edit = (doc: Doc, from: string, to: string): Doc =>
    reconcile(doc, parseMarkdown(toMarkdown(doc).replace(from, to)));

  test("a person and an agent editing different blocks merge without asking", () => {
    const base = reconcile(null, parseMarkdown(body));
    const mine = edit(base, "revenue minus cost", "net sales minus COGS");
    const theirs = edit(base, "monthly", "weekly");
    const segs = mergeDocs(base, mine, theirs);
    expect(conflicts(segs)).toHaveLength(0);
    const merged: Doc = { type: "root", children: resolve(segs, () => "mine") };
    expect(toMarkdown(merged)).toBe(
      "# Margin\n\nMargin is net sales minus COGS.\n\nReported weekly.\n",
    );
  });

  test("both editing one block is a conflict over that block", () => {
    const base = reconcile(null, parseMarkdown(body));
    const mine = edit(base, "revenue minus cost", "net sales");
    const theirs = edit(base, "revenue minus cost", "turnover");
    const c = conflicts(mergeDocs(base, mine, theirs));
    expect(c).toHaveLength(1);
    expect(c[0]?.mine.map((n) => (n as { id?: string }).id)).toEqual([
      (base.children[1] as { id?: string }).id,
    ]);
  });
});

describe("mergeFields", () => {
  test("a field one side changed wins; both changed differently is a conflict", () => {
    const base = { title: "Margin", status: "stable", tags: ["a"] };
    const mine = { title: "Gross margin", status: "stable", tags: ["a", "b"] };
    const theirs = { title: "Margin", status: "draft", tags: ["a", "c"] };
    const out = mergeFields(base, mine, theirs);
    expect(out.find((f) => f.key === "title")).toEqual({
      key: "title",
      kind: "same",
      value: "Gross margin",
    });
    expect(out.find((f) => f.key === "status")).toEqual({
      key: "status",
      kind: "same",
      value: "draft",
    });
    expect(out.find((f) => f.key === "tags")?.kind).toBe("conflict");
  });
});

describe("links made in the editor (linkParam)", () => {
  const opts = {
    path: "dir/a.md",
    href: (t: LinkTarget | null) =>
      t === null ? null : t.kind === "internal" ? `/app/${t.path}` : t.href,
  };
  test("an internal target is drawn as the parser draws it", () => {
    expect(linkParam(opts, "/dir/b.md")).toEqual({
      url: "/dir/b.md",
      title: null,
      href: "/app/dir/b.md",
      path: "dir/b.md",
      broken: false,
    });
  });
  test("schemes a browser must not follow get no href", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "vbscript:x"]) {
      expect(linkParam(opts, bad).href).toBeNull();
    }
    expect(linkParam(opts, "https://example.com").href).toBe("https://example.com");
  });
});
