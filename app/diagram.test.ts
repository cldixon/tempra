import { afterEach, describe, expect, test } from "bun:test";
import { type Doc, docText, parseMarkdown, reconcile } from "@tempra/editor";
import { Window } from "happy-dom";
import { render } from "pele";
import { flushSync, mount, unmount } from "svelte";
import Body from "./src/reader/Body.svelte";
import { readText, textblocks } from "./src/reader/dom";
import { openFigureContext } from "./src/reader/open-figure";
import { declarations, svgNode } from "./src/reader/pele";
import { type Prepared, prepare } from "./src/reader/prepare";

const good = "flowchart LR\n  A[Write] --> B{Parses?}\n  B -->|yes| C[Drawn]\n  style C fill:#eee";
const broken = "sequenceDiagram\n  Alice->>: hi";
const body = (src: string) => `Before.\n\n\`\`\`mermaid\n${src}\n\`\`\`\n\nAfter.`;
const stored = (md: string): Doc => reconcile(null, parseMarkdown(md));

/** What is mounted in a test, unmounted after it. */
const mounted: (() => void)[] = [];
afterEach(() => {
  for (const done of mounted.splice(0)) done();
});

/** A body mounted into the page's DOM (test/setup.ts) and flushed; `open` offers Enlarge. */
function drawBody(p: Prepared, open?: (n: number) => void) {
  const host = document.createElement("div");
  document.body.append(host);
  const instance = mount(Body, {
    target: host,
    props: { prepared: p, diff: null, hideFirst: false },
    context: open ? openFigureContext(open) : undefined,
  });
  flushSync();
  let gone = false;
  const done = () => {
    if (gone) return;
    gone = true;
    unmount(instance);
    host.remove();
  };
  mounted.push(done);
  return { host, done };
}

/** Lets Pele's chunks load and the diagram draw, then flushes. */
const tick = async () => {
  await new Promise((r) => setTimeout(r, 10));
  flushSync();
};

describe("diagrams (tempra-dev: app/diagrams)", () => {
  test("Pele's markup enters the page with its styles through the CSSOM, none parsed", () => {
    const window = new Window();
    const svg = render(good).svg;
    expect(svg).toContain(' style="');
    const out = svgNode(svg, window.document as unknown as Document);
    expect(out.localName).toBe("svg");
    expect(out.querySelector("[data-pele-style]")).toBeNull();
    expect(out.style.getPropertyValue("max-width")).toBe("100%");
    expect(out.style.getPropertyValue("--_bg").replace(/\s/g, "")).toBe("var(--pele-bg,#fff)");
    // An author's `style` line, on its node.
    const styled = Array.from(out.querySelectorAll("rect")).find(
      (r) => (r as SVGElement).style.getPropertyValue("fill") !== "",
    );
    expect(styled).toBeDefined();
  });

  test("declarations split outside quotes and parentheses", () => {
    expect(declarations("a:1; --b: var(--c, rgb(1;2)) ;c:'x;y' !important;;bad")).toEqual([
      ["a", "1", ""],
      ["--b", "var(--c, rgb(1;2))", ""],
      ["c", "'x;y'", "important"],
    ]);
  });

  test("a diagram's figure is opaque, and the text around it keeps its offsets", () => {
    const tree = stored(body(good));
    const p = prepare(tree);
    const root = drawBody(p).host;
    const figure = root.querySelector("figure.diagram");
    expect(figure?.hasAttribute("data-opaque")).toBe(true);
    expect(figure?.querySelector("[data-text]")).toBeNull();
    const text = docText(tree);
    const after = textblocks(root).at(-1) as Element;
    expect(Number(after.getAttribute("data-text"))).toBe(text.text.indexOf("After."));
    expect(readText(after)).toBe("After.");
  });

  test("drawn in the page as SVG; a broken one as its source with a quiet notice", async () => {
    const drawn = async (src: string) => {
      const out = drawBody(prepare(stored(body(src))));
      // Pele loads on demand: wait for its chunks and the draw.
      for (let i = 0; i < 100 && !out.host.querySelector("svg, .diagram-notice"); i++) await tick();
      return out;
    };
    const ok = await drawn(good);
    expect(ok.host.querySelector("figure.diagram .diagram-svg svg")).not.toBeNull();
    expect(ok.host.querySelector(".diagram-notice")).toBeNull();
    // One image to a screen reader, named by its caption (C-28).
    const image = ok.host.querySelector(".diagram-svg");
    expect(image?.getAttribute("role")).toBe("img");
    const label = image?.getAttribute("aria-labelledby");
    const name = label
      ? document.getElementById(label)?.textContent
      : image?.getAttribute("aria-label");
    expect(name).toMatch(/^(Figure \d+\.|Diagram)/);
    ok.done();
    const bad = await drawn(broken);
    const figure = bad.host.querySelector("figure.diagram.failed");
    expect(figure?.hasAttribute("data-opaque")).toBe(false);
    expect(figure?.querySelector("pre[data-text]")?.textContent).toBe(broken);
    expect(figure?.querySelector(".diagram-notice")?.textContent).toBe(
      "Diagram not drawn: Parse error on line 2",
    );
    bad.done();
  });

  test("a quiet frame: Source and Enlarge in its corner, not text; the caption below", () => {
    const md = `Before.\n\n\`\`\`mermaid title="Writes go through the ledger"\n${good}\n\`\`\`\n\nAfter.`;
    const p = prepare(stored(md));
    const root = drawBody(p, () => {}).host;
    const figure = root.querySelector("figure.diagram");
    expect(figure?.hasAttribute("data-opaque")).toBe(true);
    const tools = figure?.querySelector(".diagram-frame > .figure-tools");
    expect(tools?.hasAttribute("data-skip")).toBe(true);
    expect([...(tools?.querySelectorAll("button") ?? [])].map((b) => b.textContent)).toEqual([
      "Source",
      "",
    ]);
    expect(tools?.querySelector(".figure-enlarge")?.getAttribute("aria-label")).toBe(
      "Enlarge diagram: Writes go through the ledger",
    );
    const caption = figure?.querySelector(":scope > figcaption");
    expect(caption?.hasAttribute("data-skip")).toBe(true);
    expect(caption?.textContent).toBe("Figure 1. Writes go through the ledger");
    // No full-screen view offered: no Enlarge. No title: the number alone.
    const bare = drawBody(prepare(stored(body(good)))).host;
    expect(bare.querySelector(".figure-enlarge")).toBeNull();
    expect(bare.querySelector("figure.diagram figcaption")?.textContent).toBe("Figure 1.");
    // Nothing the frame adds is counted: the text after it keeps its offset.
    const after = textblocks(root).at(-1) as Element;
    expect(Number(after.getAttribute("data-text"))).toBe(docText(p.tree).text.indexOf("After."));
  });

  test("Source shows the Mermaid source in place, and back to the drawing", async () => {
    const { host } = drawBody(prepare(stored(body(good))));
    const svg = async () => {
      for (let i = 0; i < 100 && !host.querySelector(".diagram-svg svg"); i++) await tick();
      return host.querySelector(".diagram-svg svg");
    };
    expect(await svg()).not.toBeNull();
    const source = host.querySelector(".figure-tools button") as HTMLButtonElement;
    expect(source.getAttribute("aria-pressed")).toBe("false");
    source.click();
    flushSync();
    expect(source.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector(".diagram-svg")).toBeNull();
    const pre = host.querySelector("figure.diagram[data-opaque] pre.diagram-source");
    expect(pre?.textContent).toBe(good);
    // The source shown here is not a textblock: comments still cannot anchor in a diagram.
    expect(pre?.hasAttribute("data-text")).toBe(false);
    source.click();
    flushSync();
    expect(await svg()).not.toBeNull();
  });
});

describe("SVG fences (TEMPRA-206)", () => {
  const svgBody = (src: string, meta = "") =>
    `Before.\n\n\`\`\`svg${meta ? ` ${meta}` : ""}\n${src}\n\`\`\`\n\nAfter.`;
  const drawn = async (md: string) => {
    const out = drawBody(prepare(stored(md)), () => {});
    for (let i = 0; i < 100 && !out.host.querySelector(".diagram-svg svg, .diagram-notice"); i++)
      await tick();
    return out;
  };

  test("drawn sanitized, styles through the CSSOM, named by its alt, a figure in the numbering", async () => {
    const src =
      '<svg viewBox="0 0 20 10" onload="x()"><script>x()</script><rect id="r" width="5" height="5" style="fill:currentColor;opacity:0.5"/><use href="#r" x="10"/></svg>';
    const { host } = await drawn(svgBody(src, 'alt="Two squares" title="Squares"'));
    const svg = host.querySelector("figure.diagram .diagram-svg svg");
    expect(svg).not.toBeNull();
    expect(host.querySelector("script")).toBeNull();
    expect(svg?.getAttribute("onload")).toBeNull();
    const rect = svg?.querySelector("rect") as SVGElement;
    // Its id prefixed for this figure, and the reference with it.
    expect(rect.getAttribute("id")).toMatch(/^d.+-r$/);
    expect(svg?.querySelector("use")?.getAttribute("href")).toBe(`#${rect.getAttribute("id")}`);
    // No style attribute parsed from markup; the declarations set through the CSSOM.
    expect(svg?.outerHTML).not.toContain("data-pele-style");
    expect(rect.style.getPropertyValue("opacity")).toBe("0.5");
    const image = host.querySelector(".diagram-svg");
    expect(image?.getAttribute("aria-label")).toBe("Two squares");
    expect(host.querySelector("figure.diagram figcaption")?.textContent).toBe("Figure 1. Squares");
    expect(host.querySelector(".figure-enlarge")?.getAttribute("aria-label")).toBe(
      "Enlarge figure: Squares",
    );
  });

  test("its <title> names it when the fence has no alt", async () => {
    const { host } = await drawn(
      svgBody('<svg><title>A dot &amp; a line</title><circle r="1"/></svg>'),
    );
    expect(host.querySelector(".diagram-svg")?.getAttribute("aria-label")).toBe("A dot & a line");
  });

  test("one that does not parse shows its source, with where", async () => {
    const src = "<svg><rect></svg>";
    const { host } = await drawn(svgBody(src));
    const figure = host.querySelector("figure.diagram.failed");
    expect(figure?.querySelector("pre[data-text]")?.textContent).toBe(src);
    expect(figure?.querySelector(".diagram-notice")?.textContent).toBe(
      "SVG not drawn: </svg> closes <rect> (line 1, column 12)",
    );
  });
});
