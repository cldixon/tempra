import { describe, expect, test } from "bun:test";
import type { LinkTarget } from "./src/links";
import { conflicts, merge3, mergeFields, resolve } from "./src/merge";
import { linkParam } from "./src/parse";

const text = (...lines: string[]) => lines.join("\n");

describe("merge3", () => {
  const base = text("# Margin", "", "Margin is revenue minus cost.", "", "Reported monthly.", "");

  test("edits on different lines merge by themselves", () => {
    const mine = base.replace("revenue minus cost", "net sales minus COGS");
    const theirs = base.replace("Reported monthly.", "Reported monthly, in USD.");
    const segs = merge3(base, mine, theirs);
    expect(conflicts(segs)).toHaveLength(0);
    expect(resolve(segs, () => "mine")).toBe(
      text("# Margin", "", "Margin is net sales minus COGS.", "", "Reported monthly, in USD.", ""),
    );
  });

  test("an insertion and an edit elsewhere both land", () => {
    const mine = base.replace("# Margin\n", "# Margin\n\nAn intro.\n");
    const theirs = base.replace("Reported monthly.", "Reported weekly.");
    const out = resolve(merge3(base, mine, theirs), () => "mine");
    expect(out).toContain("An intro.");
    expect(out).toContain("Reported weekly.");
  });

  test("the same line changed both ways is a conflict with both sides", () => {
    const mine = base.replace("revenue minus cost", "net sales minus COGS");
    const theirs = base.replace("revenue minus cost", "revenue less returns");
    const segs = merge3(base, mine, theirs);
    const c = conflicts(segs);
    expect(c).toHaveLength(1);
    expect(c[0]?.mine).toEqual(["Margin is net sales minus COGS."]);
    expect(c[0]?.theirs).toEqual(["Margin is revenue less returns."]);
    expect(resolve(segs, () => "theirs")).toBe(theirs);
    expect(resolve(segs, () => "mine")).toBe(mine);
  });

  test("the same change on both sides is no conflict; unchanged sides return the other", () => {
    const edited = base.replace("monthly", "weekly");
    expect(conflicts(merge3(base, edited, edited))).toHaveLength(0);
    expect(resolve(merge3(base, base, edited), () => "mine")).toBe(edited);
    expect(resolve(merge3(base, edited, base), () => "mine")).toBe(edited);
  });

  test("a deletion on one side and an edit elsewhere", () => {
    const mine = base.replace("Reported monthly.\n", "");
    const theirs = base.replace("# Margin", "# Gross margin");
    expect(resolve(merge3(base, mine, theirs), () => "mine")).toBe(
      text("# Gross margin", "", "Margin is revenue minus cost.", "", ""),
    );
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
