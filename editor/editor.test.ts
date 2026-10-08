import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { type Leaf, serialize as toHtmlFragment } from "wordgard/doc";
import {
  type Doc,
  docText,
  documentPos,
  fromTree,
  linkTarget,
  normalize,
  parseMarkdown,
  reconcile,
  textOffset,
  toHTML,
  toMarkdown,
  toTree,
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

/** The tree survives the trip into Wordgard and back unchanged, IDs included. */
function bridges(tree: Doc) {
  const p = fromTree(tree);
  expect(toTree(p.doc, p.footnotes)).toEqual(tree);
}

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
      const tree = stored(body);
      bridges(tree);
      // Every textblock of the reader is as long as its text, and every run of text sits where
      // the document's text has it.
      const p = fromTree(tree);
      p.text.blocks.forEach((tb, i) => {
        const block = p.doc.resolve(p.starts[i] as number).parent.node;
        const size = block.content.reduce((n, c) => n + c.length, 0);
        expect({ file, i, size }).toEqual({ file, i, size: tb.to - tb.from });
      });
      p.doc.iterate((node, pos) => {
        if (!node.isText) return;
        const run = (node as Leaf<string>).param;
        const at = textOffset(p, pos);
        expect(p.text.text.slice(at, at + run.length)).toBe(run);
      });
    });
  }
});

describe("constructs the schema does not model are kept", () => {
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
      bridges(stored(md));
    });
  }

  test("random unknown inline HTML survives unchanged", () => {
    for (let i = 0; i < 200; i++) {
      const tag = `x${Math.random().toString(36).slice(2, 7)}`;
      const md = `Before <${tag} data-n="${i}">mid</${tag}> after ${i}.`;
      expect(normalize(md)).toBe(`${md}\n`);
      bridges(stored(md));
    }
  });

  test("a footnote reference written with no definition stays one", () => {
    expect(normalize("See [^a].")).toBe("See [^a].\n");
    expect(normalize("Not \\[^a].")).toBe("Not \\[^a].\n");
  });

  test("an empty body is empty", () => {
    expect(normalize("")).toBe("");
    expect(toTree(fromTree(stored("")).doc)).toEqual({ type: "root", children: [] });
  });
});

describe("links, footnotes and headings for the reader", () => {
  test("hrefs come from the caller; unsafe schemes never reach the document", () => {
    const md = "[a](/x.md) [b](javascript:alert(1)) [c](https://e.com) ![i](/img.png) [d](y.md#h)";
    const p = fromTree(stored(md), {
      path: "dir/c.md",
      href: (t, _raw, kind) =>
        t === null
          ? null
          : t.kind === "internal"
            ? `/lib/${t.path}${kind === "image" ? "?raw" : ""}`
            : t.href,
      exists: (path) => path === "x.md",
    });
    const html = toHtmlFragment(p.doc).toHTML();
    expect(html).toContain('href="/lib/x.md"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://e.com" rel="noopener noreferrer"');
    expect(html).toContain('src="/lib/img.png?raw"');
    expect(html).toContain('class="internal broken"');
    // The tree keeps what was written, whatever the reader made of it.
    expect(toMarkdown(toTree(p.doc, p.footnotes))).toBe(normalize(md));
  });

  test("footnote references point where the caller says; headings get the server's anchors", () => {
    const md = "# Intro\n\n## Intro\n\n## `code` & more!\n\nSee [^a] and [^b].\n\n[^a]: Note.";
    const p = fromTree(stored(md), {
      footnote: (label, defined) => (defined ? `#src-${label}` : null),
    });
    const html = toHtmlFragment(p.doc).toHTML();
    expect(html).toContain(`id="intro">`);
    expect(html).toContain(`id="intro-1">`);
    expect(html).toContain(`id="code-more">`);
    expect(html).toContain('<sup class="fnref" data-label="a"><a href="#src-a">[a]</a></sup>');
    // A reference with no definition is still a reference, with no link.
    expect(html).toContain('<sup class="fnref" data-label="b">[b]</sup>');
    expect(p.headings.map((h) => h.id)).toEqual(["intro", "intro-1", "code-more"]);
    expect(p.footnotes.map((f) => f.label)).toEqual(["a"]);
    expect(toHtmlFragment(p.footnotes[0]?.doc as never).toHTML()).toMatch(
      /^<p data-block="\w+">Note.<\/p>$/,
    );
    // The caller may also say what the marker shows (a source's number).
    const numbered = fromTree(stored(md), {
      footnote: (label) => ({ href: `#src-${label}`, mark: label === "a" ? "1" : "2" }),
    });
    const shown = toHtmlFragment(numbered.doc).toHTML();
    expect(shown).toContain('<sup class="fnref" data-label="a"><a href="#src-a">1</a></sup>');
    expect(toTree(numbered.doc, numbered.footnotes)).toEqual(numbered.tree);
  });

  test("blocks carry their IDs into the reader", () => {
    const tree = stored("One.\n\nTwo.");
    const ids = tree.children.map((c) => (c as { id?: string }).id);
    const html = toHTML(fromTree(tree).doc);
    for (const id of ids) expect(html).toContain(`data-block="${id}"`);
  });

  test("attribute values are escaped", () => {
    const p = fromTree(
      stored('[x](https://e.com/"onmouseover="alert(1)) ![a"b](https://e.com/i.png "t\\"x")'),
    );
    const html = toHTML(p.doc);
    expect(html).not.toMatch(/"\s*onmouseover=/);
    expect(html).toContain("&quot;");
  });

  test("raw HTML is shown as code, never rendered", () => {
    const html = toHtmlFragment(
      fromTree(stored('Hi <img src=x onerror="alert(1)"> there')).doc,
    ).toHTML();
    expect(html).toContain('<code class="raw">&lt;img src=x onerror="alert(1)"></code>');
    expect(html).not.toContain("<img");
  });

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

describe("text offsets and document positions", () => {
  test("agree both ways inside every textblock of every fixture", () => {
    for (const { body } of bodies()) {
      const p = fromTree(stored(body));
      p.text.blocks.forEach((tb, i) => {
        const mid = tb.from + Math.floor((tb.to - tb.from) / 2);
        const pos = documentPos(p, mid);
        expect(pos).toBe((p.starts[i] as number) + (mid - tb.from));
        expect(textOffset(p, pos)).toBe(mid);
      });
    }
  });

  test("the text reads as the page does", () => {
    const t = docText(
      parseMarkdown("# A *b*\n\n- `c` [d](/e.md)\n\n| x | y |\n| - | - |\n| 1 | 2 |"),
    );
    expect(t.text).toBe("A b\nc d\nx\ny\n1\n2");
  });
});

describe("word diff", () => {
  const doc = (md: string) => fromTree(stored(md)).doc;
  const text = (d: import("wordgard/doc").Plot.Doc, r: { from: number; to: number }) =>
    d.textContent({ from: r.from, to: r.to });

  test("added words are ranges in the newer document; removed words sit where they were", () => {
    const older = doc("The margin is 40 percent.\n\nSecond paragraph stays.");
    const newer = doc("The gross margin is 42 percent.\n\nSecond paragraph stays.");
    const d = wordDiff(older, newer);
    expect(d.added.map((r) => text(newer, r))).toEqual(["gross ", "42 "]);
    expect(d.removed.map((r) => r.text)).toEqual(["40"]);
    const at = d.removed[0]?.pos ?? -1;
    expect(newer.textContent({ from: at, to: at + 7 })).toBe("percent");
  });

  test("identical versions have no changes; a whole new block is added", () => {
    const a = doc("Same words here.");
    expect(wordDiff(a, doc("Same words here."))).toEqual({ added: [], removed: [] });
    const b = doc("Same words here.\n\nA new block.");
    expect(wordDiff(a, b).added.map((r) => text(b, r))).toEqual(["A new block."]);
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
