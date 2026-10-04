import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Nodes } from "mdast";
import { Leaf, serialize as toHtmlFragment } from "wordgard/doc";
import {
  documentPos,
  linkTarget,
  markdownOffset,
  Paragraph,
  parse,
  parseMdast,
  serialize,
  toMdast,
} from "./src/index";

const FIXTURES = join(import.meta.dir, "..", "fixtures");

/** Every concept body in Google's sample bundles, frontmatter removed. */
function bodies(): { file: string; body: string }[] {
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

/** mdast without positions, for comparing trees. */
function strip(node: Nodes): unknown {
  const { position: _p, ...rest } = node as Nodes & { position?: unknown };
  if ("children" in rest) {
    return { ...rest, children: (rest.children as Nodes[]).map(strip) };
  }
  return rest;
}

describe("round trip on the sample bundles", () => {
  const all = bodies();

  test("there are bodies to test", () => {
    expect(all.length).toBeGreaterThan(50);
  });

  for (const { file, body } of all) {
    test(file, () => {
      const parsed = parse(body, { path: file });
      // Unchanged, the body comes back byte for byte.
      expect(serialize(parsed.doc, parsed)).toBe(body);
      // Written from scratch, it parses to the same tree.
      const canonical = serialize(parsed.doc);
      const again = parseMdast(
        `${canonical}${parsed.footnotes.length ? "\n\n" : ""}${parsed.footnotes
          .map((f) => body.slice(f.from, f.to))
          .join("\n\n")}`,
      );
      const original = parseMdast(body);
      expect(strip(again)).toEqual(strip(original));
      // And through mdast directly, footnotes included.
      expect(
        strip(
          toMdast(
            parsed.doc,
            parsed.footnotes.map((f) => f.mdast),
          ) as never,
        ),
      ).toEqual(
        strip({
          ...original,
          children: [
            ...original.children.filter((c) => c.type !== "footnoteDefinition"),
            ...original.children.filter((c) => c.type === "footnoteDefinition"),
          ],
        }),
      );
    });
  }
});

describe("byte-stable serialization", () => {
  const body = [
    "# Title",
    "",
    "Some *odd*   spacing and a [link](../x.md 'T').",
    "",
    "* star bullets",
    "* kept",
    "",
    "Setext heading",
    "==============",
    "",
    "Cites a source.[^s]",
    "",
    "[^s]: The source.",
    "",
  ].join("\n");

  test("an untouched body is unchanged", () => {
    const p = parse(body);
    expect(serialize(p.doc, p)).toBe(body);
  });

  test("changing one block rewrites only that block", () => {
    const p = parse(body);
    const blocks = [...p.doc.content];
    blocks[1] = Paragraph.create([Leaf.text("A new paragraph.")]);
    const doc = p.doc.schema.doc(blocks);
    const out = serialize(doc, p);
    expect(out).toBe(
      body.replace("Some *odd*   spacing and a [link](../x.md 'T').", "A new paragraph."),
    );
  });

  test("removing the last block keeps the footnotes", () => {
    const p = parse(body);
    const doc = p.doc.schema.doc(p.doc.content.slice(0, -1));
    const out = serialize(doc, p);
    expect(out).toContain("Setext heading\n==============");
    expect(out).not.toContain("Cites a source.");
    expect(out.endsWith("[^s]: The source.\n")).toBe(true);
  });

  test("an empty body", () => {
    const p = parse("");
    expect(serialize(p.doc, p)).toBe("");
  });
});

describe("constructs the schema does not model are kept as source", () => {
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
  ];
  for (const md of cases) {
    test(JSON.stringify(md.slice(0, 30)), () => {
      const p = parse(md);
      expect(serialize(p.doc, p)).toBe(md);
      expect(strip(parseMdast(serialize(p.doc)))).toEqual(strip(parseMdast(md)));
    });
  }

  test("random unknown inline HTML survives unchanged", () => {
    for (let i = 0; i < 200; i++) {
      const tag = `x${Math.random().toString(36).slice(2, 7)}`;
      const md = `Before <${tag} data-n="${i}">mid</${tag}> after ${i}.`;
      const p = parse(md);
      expect(serialize(p.doc, p)).toBe(md);
      expect(serialize(p.doc)).toBe(`${md}\n`);
    }
  });
});

describe("links, footnotes and headings for the reader", () => {
  test("hrefs come from the caller; unsafe schemes never reach the document", () => {
    const md = "[a](/x.md) [b](javascript:alert(1)) [c](https://e.com) ![i](/img.png) [d](y.md#h)";
    const p = parse(md, {
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
    // Serialization keeps what was written, whatever the reader made of it.
    expect(serialize(p.doc, p)).toBe(md);
    expect(strip(parseMdast(serialize(p.doc)))).toEqual(strip(parseMdast(md)));
  });

  test("footnote references point where the caller says; headings get the server's anchors", () => {
    const md = "# Intro\n\n## Intro\n\n## `code` & more!\n\nSee [^a] and [^b].\n\n[^a]: Note.";
    const p = parse(md, { footnote: (label, defined) => (defined ? `#src-${label}` : null) });
    const html = toHtmlFragment(p.doc).toHTML();
    expect(html).toContain('<h1 id="intro">');
    expect(html).toContain('<h2 id="intro-1">');
    expect(html).toContain('<h2 id="code-more">');
    expect(html).toContain('<sup class="fnref" data-label="a"><a href="#src-a">[a]</a></sup>');
    // GFM leaves a reference with no definition as literal text, as the server shows it.
    expect(html).toContain("and [^b].");
    expect(p.headings.map((h) => h.id)).toEqual(["intro", "intro-1", "code-more"]);
    expect(p.footnotes.map((f) => f.label)).toEqual(["a"]);
    expect(toHtmlFragment(p.footnotes[0]?.doc as never).toHTML()).toBe("<p>Note.</p>");
  });

  test("raw HTML is shown as code, never rendered", () => {
    const html = toHtmlFragment(parse('Hi <img src=x onerror="alert(1)"> there').doc).toHTML();
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

describe("the position map", () => {
  test("document text and markdown offsets agree, both ways", () => {
    for (const { file, body } of bodies()) {
      const p = parse(body, { path: file });
      for (const s of p.segments) {
        const text = p.doc.textContent({ from: s.pos, to: s.end });
        if (s.end - s.pos === s.to - s.from) {
          expect({ file, text }).toEqual({ file, text: body.slice(s.from, s.to) });
          const mid = s.pos + Math.floor((s.end - s.pos) / 2);
          expect(documentPos(p, markdownOffset(p, mid))).toBe(mid);
        }
      }
    }
  });
});
