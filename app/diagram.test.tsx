import { describe, expect, test } from "bun:test";
import { type Doc, docText, parseMarkdown, reconcile } from "@tempra/editor";
import { Window } from "happy-dom";
import { render } from "pele";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { Body } from "./src/reader/Body";
import { readText, textblocks } from "./src/reader/dom";
import { OpenFigure } from "./src/reader/Figure";
import { declarations, svgNode } from "./src/reader/pele";
import { prepare } from "./src/reader/prepare";

const good = "flowchart LR\n  A[Write] --> B{Parses?}\n  B -->|yes| C[Drawn]\n  style C fill:#eee";
const broken = "sequenceDiagram\n  Alice->>: hi";
const body = (src: string) => `Before.\n\n\`\`\`mermaid\n${src}\n\`\`\`\n\nAfter.`;
const stored = (md: string): Doc => reconcile(null, parseMarkdown(md));

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
    const html = renderToStaticMarkup(<Body prepared={p} diff={null} hideFirst={false} />);
    const window = new Window();
    const root = window.document.createElement("div");
    root.innerHTML = html;
    const figure = root.querySelector("figure.diagram");
    expect(figure?.hasAttribute("data-opaque")).toBe(true);
    expect(figure?.querySelector("[data-text]")).toBeNull();
    const text = docText(tree);
    const after = textblocks(root as unknown as Element).at(-1) as Element;
    expect(Number(after.getAttribute("data-text"))).toBe(text.text.indexOf("After."));
    expect(readText(after)).toBe("After.");
  });

  test("drawn in the page as SVG; a broken one as its source with a quiet notice", async () => {
    const window = new Window();
    const g = globalThis as Record<string, unknown>;
    const saved = { window: g.window, document: g.document, DOMParser: g.DOMParser };
    Object.assign(g, {
      window,
      document: window.document,
      DOMParser: window.DOMParser,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    try {
      const drawn = async (src: string) => {
        const host = window.document.createElement("div");
        window.document.body.append(host);
        const root = createRoot(host as unknown as Element);
        const p = prepare(stored(body(src)));
        await act(async () => {
          root.render(<Body prepared={p} diff={null} hideFirst={false} />);
        });
        // Pele loads on demand: wait for its chunks and the draw.
        for (let i = 0; i < 100 && !host.querySelector("svg, .diagram-notice"); i++) {
          await act(() => new Promise((r) => setTimeout(r, 10)));
        }
        return { host, root };
      };
      const ok = await drawn(good);
      expect(ok.host.querySelector("figure.diagram .diagram-svg svg")).not.toBeNull();
      expect(ok.host.querySelector(".diagram-notice")).toBeNull();
      await act(async () => ok.root.unmount());
      const bad = await drawn(broken);
      const figure = bad.host.querySelector("figure.diagram.failed");
      expect(figure?.hasAttribute("data-opaque")).toBe(false);
      expect(figure?.querySelector("pre[data-text]")?.textContent).toBe(broken);
      expect(figure?.querySelector(".diagram-notice")?.textContent).toBe(
        "Diagram not drawn: Parse error on line 2",
      );
      await act(async () => bad.root.unmount());
      // React's scheduled work reads `window`: let it run before the globals go back.
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      Object.assign(g, saved);
    }
  });

  test("a quiet frame: Source and Enlarge in its corner, not text; the caption below", () => {
    const md = `Before.\n\n\`\`\`mermaid title="Writes go through the ledger"\n${good}\n\`\`\`\n\nAfter.`;
    const p = prepare(stored(md));
    const window = new Window();
    const root = window.document.createElement("div");
    root.innerHTML = renderToStaticMarkup(
      <OpenFigure.Provider value={() => {}}>
        <Body prepared={p} diff={null} hideFirst={false} />
      </OpenFigure.Provider>,
    );
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
    const bare = window.document.createElement("div");
    bare.innerHTML = renderToStaticMarkup(
      <Body prepared={prepare(stored(body(good)))} diff={null} hideFirst={false} />,
    );
    expect(bare.querySelector(".figure-enlarge")).toBeNull();
    expect(bare.querySelector("figure.diagram figcaption")?.textContent).toBe("Figure 1.");
    // Nothing the frame adds is counted: the text after it keeps its offset.
    const after = textblocks(root as unknown as Element).at(-1) as Element;
    expect(Number(after.getAttribute("data-text"))).toBe(docText(p.tree).text.indexOf("After."));
  });

  test("Source shows the Mermaid source in place, and back to the drawing", async () => {
    const window = new Window();
    const g = globalThis as Record<string, unknown>;
    const saved = { window: g.window, document: g.document, DOMParser: g.DOMParser };
    Object.assign(g, {
      window,
      document: window.document,
      DOMParser: window.DOMParser,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    try {
      const host = window.document.createElement("div");
      window.document.body.append(host);
      const root = createRoot(host as unknown as Element);
      await act(async () => {
        root.render(<Body prepared={prepare(stored(body(good)))} diff={null} hideFirst={false} />);
      });
      const svg = async () => {
        for (let i = 0; i < 100 && !host.querySelector(".diagram-svg svg"); i++) {
          await act(() => new Promise((r) => setTimeout(r, 10)));
        }
        return host.querySelector(".diagram-svg svg");
      };
      expect(await svg()).not.toBeNull();
      const source = host.querySelector(".figure-tools button") as unknown as HTMLButtonElement;
      expect(source.getAttribute("aria-pressed")).toBe("false");
      await act(async () => source.click());
      expect(source.getAttribute("aria-pressed")).toBe("true");
      expect(host.querySelector(".diagram-svg")).toBeNull();
      const pre = host.querySelector("figure.diagram[data-opaque] pre.diagram-source");
      expect(pre?.textContent).toBe(good);
      // The source shown here is not a textblock: comments still cannot anchor in a diagram.
      expect(pre?.hasAttribute("data-text")).toBe(false);
      await act(async () => source.click());
      expect(await svg()).not.toBeNull();
      await act(async () => root.unmount());
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      Object.assign(g, saved);
    }
  });
});
