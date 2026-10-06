import { describe, expect, test } from "bun:test";
import { type Frontmatter, formOf, frontmatterOf, linkTarget, startMerge } from "./src/Editor";
import { Urls } from "./src/urls";

(globalThis as { location?: unknown }).location ??= new URL("http://localhost/ann/notes/a.md");

const fm: Frontmatter = {
  type: "Metric",
  title: "Revenue",
  description: "Money in.",
  tags: ["finance", "core"],
  stale_after: "2026-12-31T00:00:00Z",
  sources: [{ id: "s1", title: "Ledger", resource: "https://example.com/l" }],
  owner_team: "finance",
  generated: "2026-01-01T00:00:00Z",
  verified: { by: "human:ann", at: "2026-01-02T00:00:00Z", hash: "abc" },
};

describe("the frontmatter form (tempra-dev: app/editor)", () => {
  test("untouched, every field keeps its exact value; stamped fields are dropped", () => {
    const odd: Frontmatter = {
      ...fm,
      tags: "finance",
      stale_after: "2026-12-31T12:34:56+02:00",
      sources: [{ id: "s1", resource: "https://x.test", author: "A. N.", usage_count: 3 }],
    };
    const { generated: _g, verified: _v, ...rest } = odd;
    expect(frontmatterOf(odd, formOf(odd))).toEqual(rest);
  });

  test("changed fields: empty removed, tags split, stale_after in UTC with Z, to the second", () => {
    const form = {
      ...formOf(fm),
      description: " ",
      tags: "a, , b",
      staleAfter: "2027-03-04T05:06:07",
    };
    const out = frontmatterOf(fm, form);
    expect(out.description).toBeUndefined();
    expect(out.tags).toEqual(["a", "b"]);
    expect(out.stale_after).toBe("2027-03-04T05:06:07Z");
    expect(frontmatterOf(fm, { ...form, staleAfter: "2027-03-04T05:06" }).stale_after).toBe(
      "2027-03-04T05:06:00Z",
    );
    expect(frontmatterOf(fm, { ...form, staleAfter: "", tags: "" })).not.toContainKey("tags");
  });

  test("an edited source keeps its other keys; an empty field is left out, not written empty", () => {
    const base: Frontmatter = {
      ...fm,
      sources: [{ id: "s1", title: "Ledger", resource: "https://l.test", author: "A. N." }],
    };
    const form = formOf(base);
    const out = frontmatterOf(base, {
      ...form,
      sources: [
        { ...(form.sources[0] as (typeof form.sources)[0]), title: "", resource: "https://m.test" },
        { id: "s2", title: "Only a title", resource: "" },
      ],
    });
    expect(out.sources).toEqual([
      { id: "s1", resource: "https://m.test", author: "A. N." },
      { id: "s2", title: "Only a title" },
    ]);
  });

  test("status stable is not added where there was none; blank source rows go", () => {
    const bare: Frontmatter = { type: "Metric", title: "T", description: "D" };
    const form = formOf(bare);
    expect(form.status).toBe("stable");
    expect(frontmatterOf(bare, form)).toEqual(bare);
    const draft = frontmatterOf(bare, {
      ...form,
      status: "draft",
      sources: [
        { id: "", title: "", resource: "" },
        { id: "", title: "", resource: "https://x.test" },
      ],
    });
    expect(draft).toEqual({ ...bare, status: "draft", sources: [{ resource: "https://x.test" }] });
  });
});

describe("link targets", () => {
  const urls = new Urls("ann", "notes");
  test("an app URL into this library becomes its bundle path", () => {
    expect(linkTarget(urls, "http://localhost/ann/notes/dir/x.md#h")).toBe("/dir/x.md#h");
    expect(linkTarget(urls, "/ann/notes/a%20b.md")).toBe("/a b.md");
  });
  test("other targets stay as typed; a bare path is made absolute", () => {
    expect(linkTarget(urls, "https://example.com/x")).toBe("https://example.com/x");
    expect(linkTarget(urls, "http://localhost/ann/notes/-/ledger")).toBe(
      "http://localhost/ann/notes/-/ledger",
    );
    expect(linkTarget(urls, "/dir/x.md")).toBe("/dir/x.md");
    expect(linkTarget(urls, "dir/x.md")).toBe("/dir/x.md");
    expect(linkTarget(urls, "#section")).toBe("#section");
  });
});

describe("merging with a version saved meanwhile", () => {
  test("separate changes combine; stamped fields are left out", () => {
    const base = { path: "a.md", hash: "h0", body: "one\ntwo\nthree\n", frontmatter: fm };
    const theirs = { ...base, hash: "h1", body: "one\ntwo\nthree, theirs\n" };
    const m = startMerge(base, "one, mine\ntwo\nthree\n", { ...fm, title: "Mine" }, theirs);
    expect(m.segments).toEqual([
      { kind: "same", lines: ["one, mine", "two", "three, theirs", ""] },
    ]);
    expect(m.fields.find((f) => f.key === "title")).toEqual({
      key: "title",
      kind: "same",
      value: "Mine",
    });
    expect(m.fields.some((f) => f.key === "verified" || f.key === "generated")).toBe(false);
  });

  test("fields the person left alone never overwrite what was changed meanwhile", () => {
    const base = { path: "a.md", hash: "h0", body: "x\n", frontmatter: fm };
    const theirs = {
      ...base,
      hash: "h1",
      frontmatter: { ...fm, tags: ["finance"], stale_after: "2027-01-01T00:00:00Z" },
    };
    const mine = frontmatterOf(fm, { ...formOf(fm), title: "Mine" });
    const m = startMerge(base, "x\n", mine, theirs);
    expect(m.fields.filter((f) => f.kind === "conflict")).toEqual([]);
    const value = (k: string) => m.fields.find((f) => f.key === k);
    expect(value("tags")).toMatchObject({ kind: "same", value: ["finance"] });
    expect(value("stale_after")).toMatchObject({ value: "2027-01-01T00:00:00Z" });
    expect(value("title")).toMatchObject({ value: "Mine" });
  });
});
