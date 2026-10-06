import { describe, expect, test } from "bun:test";
import { bodies } from "./editor.test";
import { blockIds, carryIds, reconcile } from "./src/reconcile";
import { type Doc, idOf, parseMarkdown, toMarkdown } from "./src/tree";

const ids = (doc: Doc) => doc.children.map((c) => idOf(c));
const next = (prev: Doc, md: string) => reconcile(prev, parseMarkdown(md));

describe("block IDs across versions", () => {
  const md = "# Title\n\nFirst paragraph.\n\nSecond paragraph.\n\n- one\n- two\n";
  const base = reconcile(null, parseMarkdown(md));

  test("every block gets a unique ID", () => {
    const all = blockIds(base);
    expect(all.length).toBe(8); // heading, 2 paragraphs, list, 2 items, a paragraph in each
    expect(new Set(all).size).toBe(all.length);
  });

  test("an unchanged document keeps every ID", () => {
    expect(blockIds(next(base, toMarkdown(base)))).toEqual(blockIds(base));
  });

  test("a block edited in place keeps its ID", () => {
    const edited = next(base, md.replace("First paragraph.", "First paragraph, rewritten."));
    expect(ids(edited)).toEqual(ids(base));
  });

  test("an insert and a delete are aligned", () => {
    const inserted = next(base, md.replace("# Title\n", "# Title\n\nNew intro.\n"));
    const [h, intro, ...rest] = ids(inserted);
    expect(h).toBe(ids(base)[0]);
    expect(ids(base)).not.toContain(intro);
    expect(rest).toEqual(ids(base).slice(1));
    const deleted = next(base, md.replace("First paragraph.\n\n", ""));
    expect(ids(deleted)).toEqual([ids(base)[0], ...ids(base).slice(2)]);
  });

  test("a block inserted before an edited one does not take its ID", () => {
    const edited = next(
      base,
      md.replace("First paragraph.", "A brand new paragraph.\n\nFirst paragraph, now edited."),
    );
    const [h, added, first, ...rest] = ids(edited);
    expect(h).toBe(ids(base)[0]);
    expect(ids(base)).not.toContain(added);
    expect(first).toBe(ids(base)[1]);
    expect(rest).toEqual(ids(base).slice(2));
  });

  test("blocks swapped keep their IDs", () => {
    const swapped = next(
      base,
      md.replace("First paragraph.\n\nSecond paragraph.", "Second paragraph.\n\nFirst paragraph."),
    );
    expect(ids(swapped)).toEqual([ids(base)[0], ids(base)[2], ids(base)[1], ids(base)[3]]);
  });

  test("list items keep their IDs when one is edited and one added", () => {
    const edited = next(base, md.replace("- two\n", "- two, edited\n- three\n"));
    const items = (d: Doc) => blockIds(d).slice(4);
    expect(items(edited).slice(0, 4)).toEqual(items(base));
    expect(items(edited)).toHaveLength(6);
  });

  test("hints: an ID the app sent is kept, a duplicate is not trusted", () => {
    // A person moved the second paragraph to the top and edited it: by content alone it would
    // look new; its ID says what it is.
    const app = parseMarkdown("Second paragraph, edited.\n\n# Title\n\nFirst paragraph.");
    const [a, b, c] = app.children;
    Object.assign(a as object, { id: ids(base)[2] });
    Object.assign(b as object, { id: ids(base)[0] });
    Object.assign(c as object, { id: ids(base)[0] }); // a split copies the ID: not trusted
    const out = reconcile(base, app);
    expect(ids(out)).toEqual([ids(base)[2], ids(base)[0], ids(base)[1]]);
  });

  test("the app's IDs survive the server's canonical rewrite", () => {
    const app = parseMarkdown("* Title\n\nText");
    Object.assign(app.children[0] as object, { id: "abc" });
    const canonical = parseMarkdown(toMarkdown(app));
    expect(idOf(carryIds(app, canonical).children[0] as never)).toBe("abc");
  });

  test("every fixture keeps all its IDs through a write of itself", () => {
    for (const { body } of bodies()) {
      const doc = reconcile(null, parseMarkdown(body));
      expect(blockIds(next(doc, toMarkdown(doc)))).toEqual(blockIds(doc));
    }
  });
});
