import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ATOM,
  type Doc,
  type DocNode,
  docText,
  idOf,
  locate,
  parseMarkdown,
  reconcile,
  selectorAt,
  walk,
  wordDiff,
} from "@tempra/editor";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { Body, Note } from "./src/reader/Body";
import { offsetAt, pointAt, rangeOf, readText, textblocks } from "./src/reader/dom";
import { type BodyOptions, prepare } from "./src/reader/prepare";

const FIXTURES = join(import.meta.dir, "..", "fixtures");

/** Every concept body in Google's sample bundles, frontmatter removed. */
function bodies(): { file: string; body: string }[] {
  const all = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? all(p) : p.endsWith(".md") ? [p] : [];
    });
  return all(FIXTURES)
    .filter((f) => !/(^|\/)(index|log|README|LICENSE)\.md$/.test(f))
    .map((file) => ({
      file: file.slice(FIXTURES.length + 1),
      body: readFileSync(file, "utf8").replace(/^---\n[\s\S]*?\n---\n?/, ""),
    }));
}

const stored = (md: string): Doc => reconcile(null, parseMarkdown(md));

/** A body drawn by the reader into a DOM, as the app draws it. */
function draw(tree: Doc, options: BodyOptions = {}, older?: Doc) {
  const p = prepare(tree, options);
  const diff = older ? wordDiff(docText(older), p.text) : null;
  const html = renderToStaticMarkup(<Body prepared={p} diff={diff} hideFirst={false} />);
  const window = new Window();
  const root = window.document.createElement("div");
  root.innerHTML = html;
  window.document.body.append(root);
  return { p, html, root: root as unknown as Element, diff };
}

/** The blocks of a tree that carry IDs, outside footnote definitions (drawn beside the body). */
function blockIds(tree: Doc): string[] {
  const ids: string[] = [];
  walk(tree, (n: DocNode) => {
    if (n.type === "footnoteDefinition") return false;
    const id = idOf(n);
    if (id !== undefined && n.type !== "root") ids.push(id);
    return undefined;
  });
  return ids;
}

describe("the reader counts text as docText does (tempra-dev: app/reader)", () => {
  const all = bodies();

  test("there are bodies to test", () => {
    expect(all.length).toBeGreaterThan(50);
  });

  for (const { file, body } of all) {
    test(file, () => {
      const tree = stored(body);
      const { p, root } = draw(tree);
      const text = p.text;
      // Every textblock is drawn once, at its offset, reading exactly as the document's text.
      const tbs = textblocks(root);
      expect(tbs.length).toBe(text.blocks.length);
      tbs.forEach((tb, i) => {
        const b = text.blocks[i];
        expect({ file, i, at: Number(tb.getAttribute("data-text")) }).toEqual({
          file,
          i,
          at: b?.from ?? -1,
        });
        expect(readText(tb)).toBe(text.text.slice(b?.from, b?.to));
      });
      // Every block with an ID carries it, once.
      for (const id of blockIds(tree)) {
        expect(root.querySelectorAll(`[data-block="${id}"]`).length).toBe(1);
      }
      // Offsets survive the trip to a DOM point and back, at the start, middle and end of each
      // textblock, before and after every atom.
      for (const b of text.blocks) {
        const atoms = [...text.text.slice(b.from, b.to)].flatMap((ch, k) =>
          ch === ATOM ? [b.from + k, b.from + k + 1] : [],
        );
        for (const at of [b.from, Math.floor((b.from + b.to) / 2), b.to, ...atoms]) {
          const point = pointAt(root, at);
          expect(point).not.toBeNull();
          if (!point) continue;
          expect({ file, at: offsetAt(root, point.node, point.offset, false) }).toEqual({
            file,
            at,
          });
        }
      }
      // A selection inside each longer textblock maps to the quote an anchor stores.
      for (const b of text.blocks.filter((x) => x.to - x.from > 4)) {
        const range = rangeOf(root, b.from + 1, b.to - 1);
        expect(range).not.toBeNull();
        if (!range) continue;
        const from = offsetAt(root, range.startContainer, range.startOffset, false);
        const to = offsetAt(root, range.endContainer, range.endOffset, true);
        expect({ file, from, to }).toEqual({ file, from: b.from + 1, to: b.to - 1 });
        // …and the stored selector made from it finds the same text again (a quote that occurs
        // once: repeated table cells share their table's block ID, TEMPRA-101).
        const quote = text.text.slice(b.from + 1, b.to - 1);
        if (text.text.indexOf(quote) !== text.text.lastIndexOf(quote)) continue;
        const sel = selectorAt(text, b.from + 1, b.to - 1);
        expect(locate(text, sel)).toEqual({ from: b.from + 1, to: b.to - 1 });
      }
    });
  }

  test("a selection across blocks, and points between blocks, snap to the nearest text", () => {
    const md = "# Title\n\nFirst *para*graph.\n\n- one\n- two\n\n> quoted\n\n---\n\nLast.";
    const { p, root } = draw(stored(md));
    const t = p.text;
    // From the start of the body to its end: the whole text.
    expect(offsetAt(root, root, 0, false)).toBe(0);
    expect(offsetAt(root, root, root.childNodes.length, true)).toBe(t.text.length);
    // Around the rule (no text): the end of "quoted", the start of "Last.".
    const hr = root.querySelector("hr") as Element;
    const parent = hr.parentNode as Node;
    const index = Array.prototype.indexOf.call(parent.childNodes, hr);
    expect(offsetAt(root, parent, index, true)).toBe(t.text.indexOf("quoted") + 6);
    expect(offsetAt(root, parent, index + 1, false)).toBe(t.text.indexOf("Last."));
    // A list item's element boundary (between its marker and its paragraph).
    const li = root.querySelector("li") as Element;
    expect(offsetAt(root, li, 0, false)).toBe(t.text.indexOf("one"));
    // A range from inside a heading to inside the list reads as the text between.
    const range = rangeOf(root, 2, t.text.indexOf("two") + 2);
    const from = offsetAt(root, range?.startContainer as Node, range?.startOffset ?? 0, false);
    const to = offsetAt(root, range?.endContainer as Node, range?.endOffset ?? 0, true);
    expect(t.text.slice(from ?? 0, to ?? 0)).toBe("tle\nFirst paragraph.\none\ntw");
  });

  test("inside an atom, a start snaps before it and an end after it", () => {
    const { p, root } = draw(stored("See [^a] here.\n\n[^a]: A note."), {
      footnote: () => ({ href: "#fn-a", mark: "12" }),
    });
    const sup = root.querySelector("sup.fnref") as Element;
    const inner = sup.querySelector("a")?.firstChild as Node;
    const at = p.text.text.indexOf(ATOM);
    expect(offsetAt(root, inner, 1, false)).toBe(at);
    expect(offsetAt(root, inner, 1, true)).toBe(at + 1);
  });

  test("the verification diff's ins and del leave the counting alone", () => {
    for (const { file, body } of bodies().slice(0, 20)) {
      const older = stored(body);
      const tree = stored(
        `Inserted first words.\n\n${body.replace(/\b(the|a)\b/, "one").trimEnd()}\n\nAn added paragraph.\n`,
      );
      const { p, root, diff } = draw(tree, {}, older);
      expect(diff?.added.length).toBeGreaterThan(0);
      const tbs = textblocks(root);
      tbs.forEach((tb, i) => {
        const b = p.text.blocks[i];
        expect({ file, i, text: readText(tb) }).toEqual({
          file,
          i,
          text: p.text.text.slice(b?.from, b?.to),
        });
      });
      const added = [...root.querySelectorAll("ins.diff-added")].map((e) => e.textContent).join("");
      expect(added).toContain("An added paragraph.");
    }
  });
});

describe("what the reader draws", () => {
  test("hrefs come from the caller; unsafe schemes never reach the page", () => {
    const md = "[a](/x.md) [b](javascript:alert(1)) [c](https://e.com) ![i](/img.png) [d](y.md#h)";
    const { html } = draw(stored(md), {
      path: "dir/c.md",
      href: (t, _raw, kind) =>
        t === null
          ? null
          : t.kind === "internal"
            ? `/lib/${t.path}${kind === "image" ? "?raw" : ""}`
            : t.href,
      exists: (path) => path === "x.md",
    });
    expect(html).toContain('href="/lib/x.md"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://e.com" rel="noopener noreferrer"');
    expect(html).toContain('src="/lib/img.png?raw"');
    expect(html).toContain('class="internal broken"');
    expect(html).toContain('data-path="dir/y.md"');
  });

  test("footnote markers show what the caller says; headings get the server's anchors", () => {
    const md = "# Intro\n\n## Intro\n\n## `code` & more!\n\nSee [^a] and [^b].\n\n[^a]: Note.";
    const { html, p } = draw(stored(md), {
      footnote: (label, defined) => (defined ? { href: `#src-${label}`, mark: "1" } : null),
    });
    expect(html).toContain('id="intro"');
    expect(html).toContain('id="intro-1"');
    expect(html).toContain('id="code-more"');
    expect(html).toContain('<sup class="fnref" data-atom="" data-label="a"><a href="#src-a">1</a>');
    // A reference with no definition is still a marker, with no link.
    expect(html).toContain('<sup class="fnref" data-atom="" data-label="b">[b]</sup>');
    expect(p.headings.map((h) => h.id)).toEqual(["intro", "intro-1", "code-more"]);
    expect(p.headings[0]?.first).toBe(true);
    // The definition is drawn beside the body, not in it.
    expect(html).not.toContain("Note.");
    expect(p.footnotes.map((f) => f.label)).toEqual(["a"]);
    const note = renderToStaticMarkup(
      <Note prepared={p} nodes={p.footnotes[0]?.node.children ?? []} />,
    );
    expect(note).toMatch(/^<p data-block="\w+">Note.<\/p>$/);
  });

  test("markers are numbered in reading order: the body first, then the definitions", () => {
    const seen: string[] = [];
    prepare(stored("A [^x] and [^y].\n\n[^y]: Cites [^z].\n\n[^x]: Plain."), {
      footnote: (label) => {
        seen.push(label);
        return { href: null, mark: String(seen.length) };
      },
    });
    expect(seen).toEqual(["x", "y", "z"]);
  });

  test("attribute values and text are escaped", () => {
    const { html } = draw(
      stored('[x](https://e.com/"onmouseover="alert(1)) ![a"b](https://e.com/i.png "t\\"x")'),
    );
    expect(html).not.toMatch(/"\s*onmouseover=/);
    expect(html).toContain("&quot;");
  });

  test("raw HTML is shown as its markdown, as code, never rendered", () => {
    const { html, root } = draw(
      stored('Hi <img src=x onerror="alert(1)"> there\n\n<div>\nblock\n</div>'),
    );
    expect(html).toContain(
      '<code class="raw" data-atom="">&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</code>',
    );
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("pre.raw code")?.textContent).toBe("<div>\nblock\n</div>");
  });

  test("tables keep their alignment; tasks show a disabled checkbox; a code fence its language", () => {
    const { root } = draw(
      stored("| a | b |\n|:-:|--:|\n| 1 | 2 |\n\n- [x] done\n- [ ] open\n\n```sql\nselect 1\n```"),
    );
    expect(root.querySelector("th")?.getAttribute("data-align")).toBe("center");
    expect(root.querySelectorAll("td")[1]?.getAttribute("data-align")).toBe("right");
    expect(root.querySelector(".table > table")).not.toBeNull();
    const boxes = root.querySelectorAll("li.task input[type=checkbox]");
    expect(boxes.length).toBe(2);
    expect(root.querySelector("pre")?.getAttribute("data-lang")).toBe("sql");
  });

  test("a leading heading can be hidden and keeps its place in the text", () => {
    const p = prepare(stored("# Same as the title\n\nBody."));
    const html = renderToStaticMarkup(<Body prepared={p} diff={null} hideFirst />);
    expect(html).toMatch(/^<h1 id="same-as-the-title" data-block="\w+" data-text="0" hidden="">/);
  });
});
