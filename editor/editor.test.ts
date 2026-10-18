import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  type Doc,
  docText,
  linkTarget,
  normalize,
  parseMarkdown,
  reconcile,
  toMarkdown,
  wordDiff,
} from "./src/index";

const FIXTURES = join(import.meta.dir, "..", "fixtures");

/** Every concept body in Google's sample bundles, frontmatter removed. */
export function bodies(): { file: string; body: string }[] {
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith(".md") ? [p] : [];
    });
  return walk(FIXTURES)
    .filter((f) => !/(^|\/)(index|log|README|LICENSE)\.md$/.test(f))
    .map((file) => ({
      file: file.slice(FIXTURES.length + 1),
      body: readFileSync(file, "utf8").replace(/^---\n[\s\S]*?\n---\n?/, ""),
    }));
}

/** A stored tree for some markdown: parsed, with IDs. */
const stored = (md: string): Doc => reconcile(null, parseMarkdown(md));

describe("the sample bundles", () => {
  const all = bodies();

  test("there are bodies to test", () => {
    expect(all.length).toBeGreaterThan(50);
  });

  for (const { file, body } of all) {
    test(file, () => {
      // Normalized once, then byte-stable: written, parsed and written again, the same bytes.
      const once = normalize(body);
      expect(normalize(once)).toBe(once);
      // The canonical form means the same as what was written.
      expect(parseMarkdown(once)).toEqual(parseMarkdown(body));
      // Every textblock has its place in the text, in order, one newline apart.
      const t = docText(stored(body));
      t.blocks.forEach((tb, i) => {
        const prev = t.blocks[i - 1];
        expect(tb.from).toBe(prev ? prev.to + 1 : 0);
      });
      expect(t.text.length).toBe(t.blocks.at(-1)?.to ?? 0);
    });
  }
});

describe("constructs the tree does not model are kept", () => {
  const cases = [
    "Inline <span class=x>html</span> stays.",
    "<div>\nA block of HTML\n</div>",
    "A [reference link][ref].\n\n[ref]: https://example.com",
    "An ![image ref][img].\n\n[img]: /a.png",
    "Hard  \nbreak and\nsoft break.",
    "- [x] done\n- [ ] open",
    "1. one\n2. two\n\n   loose",
    "| a | b |\n|:-:|--:|\n| 1 | 2 |",
    "```sql title=x\nselect 1\n\nfrom t\n```",
    "    indented code",
    "> quote\n>\n> - in a list",
    "~~struck~~ and ***both*** and *a **b***",
    "Autolink https://example.com and <mailto:a@b.c>.",
    "Cites [^src] with no definition, and \\[^not] a reference.",
  ];
  for (const md of cases) {
    test(JSON.stringify(md.slice(0, 30)), () => {
      const once = normalize(md);
      expect(normalize(once)).toBe(once);
      expect(parseMarkdown(once)).toEqual(parseMarkdown(md));
      expect(toMarkdown(stored(md))).toBe(once);
    });
  }

  test("random unknown inline HTML survives unchanged", () => {
    for (let i = 0; i < 200; i++) {
      const tag = `x${Math.random().toString(36).slice(2, 7)}`;
      const md = `Before <${tag} data-n="${i}">mid</${tag}> after ${i}.`;
      expect(normalize(md)).toBe(`${md}\n`);
    }
  });

  test("a footnote reference written with no definition stays one", () => {
    expect(normalize("See [^a].")).toBe("See [^a].\n");
    expect(normalize("Not \\[^a].")).toBe("Not \\[^a].\n");
  });

  test("an empty body is empty", () => {
    expect(normalize("")).toBe("");
    expect(stored("")).toEqual({ type: "root", children: [] });
  });
});

describe("links", () => {
  test("linkTarget follows the server's rules", () => {
    expect(linkTarget("a/b.md", "../c.md#x")).toEqual({
      kind: "internal",
      path: "c.md",
      anchor: "#x",
      dir: false,
    });
    expect(linkTarget("a/b.md", "/d/")).toEqual({
      kind: "internal",
      path: "d",
      anchor: null,
      dir: true,
    });
    expect(linkTarget("a.md", "data:text/html,x")).toBeNull();
    expect(linkTarget("a.md", "//e.com/x")).toEqual({ kind: "external", href: "https://e.com/x" });
  });
});

describe("the document's text", () => {
  test("the text reads as the page does", () => {
    const t = docText(
      parseMarkdown("# A *b*\n\n- `c` [d](/e.md)\n\n| x | y |\n| - | - |\n| 1 | 2 |"),
    );
    expect(t.text).toBe("A b\nc d\nx\ny\n1\n2");
  });
});

describe("word diff", () => {
  const doc = (md: string) => docText(stored(md));
  const text = (d: ReturnType<typeof docText>, r: { from: number; to: number }) =>
    d.text.slice(r.from, r.to);

  test("added words are text ranges of the newer version; removed words sit where they were", () => {
    const older = doc("The margin is 40 percent.\n\nSecond paragraph stays.");
    const newer = doc("The gross margin is 42 percent.\n\nSecond paragraph stays.");
    const d = wordDiff(older, newer);
    expect(d.added.map((r) => text(newer, r))).toEqual(["gross ", "42 "]);
    expect(d.removed.map((r) => r.text)).toEqual(["40"]);
    const at = d.removed[0]?.pos ?? -1;
    expect(newer.text.slice(at, at + 7)).toBe("percent");
  });

  test("identical versions have no changes; a whole new block is added", () => {
    const a = doc("Same words here.");
    expect(wordDiff(a, doc("Same words here."))).toEqual({ added: [], removed: [] });
    const b = doc("Same words here.\n\nA new block.");
    expect(wordDiff(a, b).added.map((r) => text(b, r))).toEqual(["A new block."]);
  });

  test("words removed at the end of a block show at its end, not in the next one", () => {
    const older = doc("First block ends here.\n\nNext.");
    const newer = doc("First block ends\n\nNext.");
    const d = wordDiff(older, newer);
    expect(d.removed.at(-1)?.pos).toBe(newer.blocks[0]?.to ?? -1);
    expect(d.removed.at(-1)?.text).toEndWith("here.");
  });

  test("removed atoms and soft breaks are not shown as text", () => {
    const d = wordDiff(doc("A cited[^a] claim\nwrapped."), doc("A claim."));
    expect(d.removed.map((r) => r.text).join(" ")).not.toContain("\uFFFC");
    expect(d.removed.map((r) => r.text).join(" ")).not.toContain("\n");
  });

  test("works across every fixture against an edited copy", () => {
    for (const { body } of bodies().slice(0, 10)) {
      const older = doc(body);
      const newer = doc(`${body.trimEnd()}\n\nAn added paragraph.\n`);
      const d = wordDiff(older, newer);
      expect(d.added.map((r) => text(newer, r)).join("")).toBe("An added paragraph.");
      expect(wordDiff(older, older)).toEqual({ added: [], removed: [] });
    }
  });
});
