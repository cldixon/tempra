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
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { Reader } from "./src/Reader";
import { Body, Note } from "./src/reader/Body";
import { offsetAt, pointAt, rangeOf, readText, textblocks } from "./src/reader/dom";
import { OpenFigure } from "./src/reader/Figure";
import type { FigureView } from "./src/reader/Lightbox";
import { type BodyOptions, fenceTitle, prepare } from "./src/reader/prepare";

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

/**
 * The reader's counting, checked over one body: every textblock drawn once at its offset and
 * reading as the document's text, every block ID once, offsets through DOM points and back, and
 * selections to the quotes anchors store. A drawn diagram's text is not in the DOM (it is opaque),
 * so its block is left out.
 */
function counts(file: string, tree: Doc, options: BodyOptions = {}) {
  const { p, root } = draw(tree, options);
  const text = p.text;
  const drawn = new Set(
    p.figures.flatMap((f) => (f.kind === "diagram" ? [idOf(f.node) ?? ""] : [])),
  );
  const blocks = text.blocks.filter((b) => !(b.block !== null && drawn.has(b.block)));
  // Every textblock is drawn once, at its offset, reading exactly as the document's text.
  const tbs = textblocks(root);
  expect(tbs.length).toBe(blocks.length);
  tbs.forEach((tb, i) => {
    const b = blocks[i];
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
  for (const b of blocks) {
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
  for (const b of blocks.filter((x) => x.to - x.from > 4)) {
    const range = rangeOf(root, b.from + 1, b.to - 1);
    expect(range).not.toBeNull();
    if (!range) continue;
    const from = offsetAt(root, range.startContainer, range.startOffset, false);
    const to = offsetAt(root, range.endContainer, range.endOffset, true);
    expect({ file, from, to }).toEqual({ file, from: b.from + 1, to: b.to - 1 });
    // …and the stored selector made from it finds the same text again, repeated table cells
    // included (they share their table's block ID, TEMPRA-101).
    const sel = selectorAt(text, b.from + 1, b.to - 1);
    expect(locate(text, sel)).toEqual({ from: b.from + 1, to: b.to - 1 });
  }
  return { p, root };
}

describe("the reader counts text as docText does (tempra-dev: app/reader)", () => {
  const all = bodies();

  test("there are bodies to test", () => {
    expect(all.length).toBeGreaterThan(50);
  });

  for (const { file, body } of all) {
    test(file, () => {
      counts(file, stored(body));
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

/** Internal images to a download path, external ones as they are (as the concept page does). */
const hrefs: BodyOptions["href"] = (t, _raw, kind) =>
  t === null
    ? null
    : t.kind === "internal"
      ? `/o/l/-/${kind === "image" ? "download" : "file"}/${t.path}`
      : t.href;

const FIGURES = [
  "# Figures",
  "Before the figures.",
  '![A tower](assets/tower.png "The tower at dusk")',
  "Text with ![an icon](assets/icon.png) inline, and more words.",
  "![Only alt](https://e.com/photo.jpg)",
  "![](assets/bare.png)",
  '```mermaid title="A write goes through the ledger"\nflowchart LR\n  A --> B\n```',
  "- ![In a list](assets/list.png)\n- an item",
  "> ![Quoted](assets/quoted.png)",
  "```mermaid\nflowchart LR\n  C --> D\n```",
  "After the figures.",
].join("\n\n");

/** A DOM for components with effects and events (happy-dom as the page's globals). */
async function live<T>(fn: (window: Window) => Promise<T>): Promise<T> {
  // A page URL, so relative image paths resolve (happy-dom fails an image whose URL does not).
  const window = new Window({ url: "https://app.test/o/l/c.md" });
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, document: g.document, DOMParser: g.DOMParser };
  Object.assign(g, {
    window,
    document: window.document,
    DOMParser: window.DOMParser,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  try {
    return await fn(window);
  } finally {
    // React's scheduled work reads `window`: let it run before the globals go back.
    await new Promise((r) => setTimeout(r, 20));
    Object.assign(g, saved);
  }
}

async function mount(window: Window, el: ReactNode) {
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(el));
  return { host: host as unknown as HTMLElement, root };
}

describe("figures (tempra-dev: app/reader, Figures)", () => {
  test("the reader's counting holds with figures, captions and diagrams in the body", () => {
    counts("figures", stored(FIGURES), { href: hrefs, path: "c.md" });
    // With no href (images dropped) too.
    counts("figures, no href", stored(FIGURES));
  });

  test("an image alone in its paragraph is a numbered figure; one in running text stays inline", () => {
    const { p, root } = draw(stored(FIGURES), { href: hrefs, path: "c.md" });
    const figures = [...root.querySelectorAll("figure")];
    const captions = figures.map((f) => f.querySelector("figcaption")?.textContent);
    expect(captions).toEqual([
      "Figure 1. The tower at dusk",
      "Figure 2. Only alt",
      "Figure 3.",
      "Figure 4. A write goes through the ledger",
      "Figure 5. In a list",
      "Figure 6. Quoted",
      "Figure 7.",
    ]);
    expect(p.figures.map((f) => [f.n, f.kind])).toEqual([
      [1, "image"],
      [2, "image"],
      [3, "image"],
      [4, "diagram"],
      [5, "image"],
      [6, "image"],
      [7, "diagram"],
    ]);
    // The figure is the block; its paragraph keeps the textblock with the image's one atom.
    const first = figures[0] as Element;
    expect(first.className).toBe("figure");
    expect(first.hasAttribute("data-block")).toBe(true);
    const para = first.querySelector(":scope > p[data-text]") as Element;
    expect(para.querySelectorAll("[data-atom]").length).toBe(1);
    expect(para.querySelector("[data-atom] img")?.getAttribute("src")).toBe(
      "/o/l/-/download/assets/tower.png",
    );
    expect(readText(para)).toBe(ATOM);
    // The caption is not text: outside the textblock and marked data-skip.
    const caption = first.querySelector("figcaption") as Element;
    expect(caption.hasAttribute("data-skip")).toBe(true);
    expect(caption.closest("[data-text]")).toBeNull();
    // An image in running text: inline, its own atom, no figure and no caption.
    const inline = root.querySelector('img[alt="an icon"]') as Element;
    expect(inline.hasAttribute("data-atom")).toBe(true);
    expect(inline.closest("figure")).toBeNull();
    expect(inline.parentElement?.tagName).toBe("P");
    // Image paths: internal ones resolve against the concept's path.
    expect(p.figures[0]?.kind === "image" && p.figures[0].path).toBe("assets/tower.png");
    expect(p.figures[1]?.kind === "image" && p.figures[1].path).toBeNull();
  });

  test("a figure's caption never enters a selection's text", () => {
    const { p, root } = draw(stored(FIGURES), { href: hrefs, path: "c.md" });
    const t = p.text.text;
    const caption = root.querySelector("figcaption") as Element;
    const inCaption = caption.lastChild as Node;
    // A point in the caption snaps to the text after it (a start) or the figure's atom (an end).
    const before = t.indexOf("Before the figures.");
    const atom = t.indexOf(ATOM, before);
    const next = t.indexOf("Text with");
    expect(offsetAt(root, inCaption, 2, false)).toBe(next);
    expect(offsetAt(root, inCaption, 2, true)).toBe(atom + 1);
    // A selection from the paragraph before, across the figure and its caption, into the next.
    const doc = root.ownerDocument;
    const range = doc.createRange();
    const start = pointAt(root, before + 7);
    const end = pointAt(root, next + 4);
    if (!start || !end) throw new Error("no points");
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    expect(range.toString()).toContain("The tower at dusk");
    const from = offsetAt(root, range.startContainer, range.startOffset, false) ?? 0;
    const to = offsetAt(root, range.endContainer, range.endOffset, true) ?? 0;
    expect(t.slice(from, to)).toBe(`the figures.\n${ATOM}\nText`);
    expect(t).not.toContain("Figure 1");
    expect(t).not.toContain("dusk");
  });

  test("a fence's caption comes from its title; other meta is not a caption", () => {
    expect(fenceTitle('title="A flow"')).toBe("A flow");
    expect(fenceTitle("title='Single'")).toBe("Single");
    expect(fenceTitle("theme=dark title=Word")).toBe("Word");
    expect(fenceTitle("subtitle=no")).toBeNull();
    expect(fenceTitle(null)).toBeNull();
  });

  test("an image is an enlarge button only where the reader offers the full-screen view", () => {
    const p = prepare(stored(FIGURES), { href: hrefs, path: "c.md" });
    const plain = renderToStaticMarkup(<Body prepared={p} diff={null} hideFirst={false} />);
    expect(plain).not.toContain("figure-open");
    const offered = renderToStaticMarkup(
      <OpenFigure.Provider value={() => {}}>
        <Body prepared={p} diff={null} hideFirst={false} />
      </OpenFigure.Provider>,
    );
    expect(offered).toContain('aria-label="Enlarge image: A tower"');
    // The button is inside the atom: the counting is the same.
    const window = new Window();
    const root = window.document.createElement("div");
    root.innerHTML = offered;
    const para = root.querySelector("figure p[data-text]") as unknown as Element;
    expect(para.querySelector("[data-atom] > button.figure-open > img")).not.toBeNull();
    expect(readText(para)).toBe(ATOM);
  });

  test("an image that fails to load shows the broken box, still one atom", async () => {
    await live(async (window) => {
      const p = prepare(stored(FIGURES), { href: hrefs, path: "c.md" });
      const { host, root } = await mount(
        window,
        <Body prepared={p} diff={null} hideFirst={false} />,
      );
      const img = host.querySelector('img[alt="A tower"]') as HTMLImageElement;
      await act(async () => {
        img.dispatchEvent(new window.Event("error") as unknown as Event);
      });
      const figure = host.querySelector("figure.figure") as HTMLElement;
      const box = figure.querySelector(".figure-broken") as HTMLElement;
      expect(box).not.toBeNull();
      expect(box.hasAttribute("data-atom")).toBe(true);
      expect(box.getAttribute("role")).toBe("img");
      expect(box.textContent).toContain("This image can't be shown");
      expect(box.textContent).toContain("assets/tower.png");
      expect(box.textContent).toContain("“A tower”");
      expect(figure.querySelector("img")).toBeNull();
      const para = figure.querySelector("p[data-text]") as unknown as Element;
      expect(readText(para)).toBe(ATOM);
      expect(figure.querySelector("figcaption")?.textContent).toBe("Figure 1. The tower at dusk");
      // An inline image that fails: its alt text, still one atom.
      const icon = host.querySelector('img[alt="an icon"]') as HTMLImageElement;
      await act(async () => {
        icon.dispatchEvent(new window.Event("error") as unknown as Event);
      });
      const broken = host.querySelector(".image-broken") as HTMLElement;
      expect(broken.hasAttribute("data-atom")).toBe(true);
      expect(broken.textContent).toBe("an icon");
      // Offsets still hold over the whole body.
      const text = p.text;
      for (const tb of textblocks(host as unknown as Element)) {
        const at = Number(tb.getAttribute("data-text"));
        const b = text.blocks.find((x) => x.from === at);
        expect(readText(tb)).toBe(text.text.slice(b?.from, b?.to));
      }
      await act(async () => root.unmount());
    });
  });

  test("the full-screen view: opens on a figure, previous and next, facts, Escape closes", async () => {
    await live(async (window) => {
      const md = [
        '![A tower](assets/tower.png "The tower at dusk")',
        "Between.",
        "![A remote photo](https://e.com/photo.jpg)",
        "Words ![inline](assets/i.png) here.",
      ].join("\n\n");
      const p = prepare(stored(md), { href: hrefs, path: "c.md" });
      const asked: string[] = [];
      const view: FigureView = {
        title: "Diagrams",
        describe: async (path) => {
          asked.push(path);
          return { size: 316 * 1024, by: "ann", at: "2026-10-18T10:00:00Z" };
        },
        fileHref: (path) => `/o/l/${path}`,
      };
      const { host, root } = await mount(
        window,
        <Reader prepared={p} diff={null} hideFirst={false} figureView={view} />,
      );
      expect(host.querySelector("dialog")).toBeNull();
      const button = host.querySelector("button.figure-open") as HTMLButtonElement;
      expect(button.getAttribute("aria-label")).toBe("Enlarge image: A tower");
      await act(async () => button.click());
      await act(() => new Promise((r) => setTimeout(r, 0)));
      const dialog = () => host.querySelector("dialog.lightbox") as HTMLDialogElement | null;
      const d = dialog() as HTMLDialogElement;
      expect(d).not.toBeNull();
      expect(d.open).toBe(true);
      const label = d.ownerDocument.getElementById(d.getAttribute("aria-labelledby") ?? "");
      expect(label?.textContent).toBe("fig. 1 of 2");
      expect(d.querySelector(".lightbox-where")?.textContent).toBe("Diagrams");
      expect(d.querySelector(".lightbox-figure img")?.getAttribute("src")).toBe(
        "/o/l/-/download/assets/tower.png",
      );
      expect(d.querySelector(".lightbox-caption")?.textContent).toBe("The tower at dusk");
      const links = [...d.querySelectorAll(".lightbox-actions a")];
      // Download, and Open file: the image's attachment page.
      expect(links.map((a) => a.textContent?.trim())).toEqual(["Download", "Open file"]);
      expect(links[0]?.getAttribute("href")).toBe("/o/l/-/download/assets/tower.png");
      expect(links[0]?.hasAttribute("download")).toBe(true);
      expect(links[1]?.getAttribute("href")).toBe("/o/l/assets/tower.png");
      expect(asked).toEqual(["assets/tower.png"]);
      const facts = () => d.querySelector(".lightbox-facts")?.textContent ?? "";
      expect(facts()).toMatch(/^tower\.png · 316 KB · added by ann, /);
      const prev = d.querySelector(".lightbox-prev") as HTMLButtonElement;
      expect(prev.disabled).toBe(true);
      // Next: the external image, its URL and nothing asked.
      await act(async () => (d.querySelector(".lightbox-next") as HTMLButtonElement).click());
      expect(dialog()?.open).toBe(true);
      expect(label?.textContent).toBe("fig. 2 of 2");
      expect(facts()).toMatch(/^https:\/\/e\.com\/photo\.jpg/);
      // An external image has no page here: Open original, in a new tab.
      const outside = [...d.querySelectorAll(".lightbox-actions a")];
      expect(outside.map((a) => a.textContent?.trim())).toEqual(["Download", "Open original"]);
      expect(outside[1]?.getAttribute("target")).toBe("_blank");
      expect(asked).toEqual(["assets/tower.png"]);
      expect((d.querySelector(".lightbox-next") as HTMLButtonElement).disabled).toBe(true);
      // The arrow keys move too.
      const key = (k: string) =>
        act(async () => {
          d.dispatchEvent(
            new window.KeyboardEvent("keydown", { key: k, bubbles: true }) as unknown as Event,
          );
        });
      await key("ArrowLeft");
      expect(label?.textContent).toBe("fig. 1 of 2");
      // Escape closes.
      await key("Escape");
      expect(dialog()).toBeNull();
      await act(async () => root.unmount());
    });
  });

  test("the full-screen view works with nothing from the page, and steps onto diagrams", async () => {
    await live(async (window) => {
      const md = '![](assets/a.png)\n\n```mermaid title="Flow"\nflowchart LR\n  A --> B\n```';
      const p = prepare(stored(md), { href: hrefs, path: "c.md" });
      const { host, root } = await mount(
        window,
        <Reader prepared={p} diff={null} hideFirst={false} />,
      );
      await act(async () => (host.querySelector("button.figure-open") as HTMLElement).click());
      const d = host.querySelector("dialog.lightbox") as HTMLDialogElement;
      expect(d.querySelector(".lightbox-where")).toBeNull();
      expect(d.querySelector(".lightbox-caption")).toBeNull();
      expect(d.querySelector(".lightbox-facts > span")?.textContent).toBe("a.png");
      await act(async () => (d.querySelector(".lightbox-next") as HTMLButtonElement).click());
      expect(d.querySelector(".lightbox-actions a")).toBeNull();
      expect(d.querySelector(".lightbox-caption")?.textContent).toBe("Flow");
      for (let i = 0; i < 100 && !d.querySelector(".lightbox-diagram svg"); i++) {
        await act(() => new Promise((r) => setTimeout(r, 10)));
      }
      expect(d.querySelector(".lightbox-diagram svg")).not.toBeNull();
      await act(async () => (d.querySelector('[aria-label="Close"]') as HTMLElement).click());
      expect(host.querySelector("dialog")).toBeNull();
      await act(async () => root.unmount());
    });
  });
});
