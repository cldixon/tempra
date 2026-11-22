/**
 * SVG fences as rendered media (TEMPRA-206; tempra-dev: app/diagrams, app/media): lint on write,
 * figures in `read`, the render tool and drawn figures for agents, the render client sanitizing
 * before the render Worker, the render Worker's drawing, and exports.
 */
import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { svgPalettes } from "@tempra/design/pele";
import { SVG_PALETTE } from "@tempra/editor/doc";
import {
  FONT,
  overflowFindings,
  pageFor,
  type RenderCache,
  renderDiagram,
  svgFigure,
} from "../render/src/render";
import { colorFailsIn, contrast, parseColor } from "../src/format/svg-color";
import { fakeRenderer, type RenderService, serviceRenderer } from "../src/render";
import { readTar } from "../src/util/tar";
import { setup } from "./harness";

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

const SVG = '<svg viewBox="0 0 20 10"><title>Two squares</title><rect width="5" height="5"/></svg>';
const UNSAFE = '<svg viewBox="0 0 2 2" onload="x()"><script>x()</script><circle r="1"/></svg>';
const doc = (body: string) =>
  `---\ntype: Figure Test\ntitle: S\ndescription: SVG.\nstatus: draft\n---\n${body}`;
const fence = (src: string, meta = "") => `\`\`\`svg${meta ? ` ${meta}` : ""}\n${src}\n\`\`\`\n`;

type Text = { type: "text"; text: string };

async function connect(app: ReturnType<typeof setup>["app"]) {
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    requestInit: { headers: { Authorization: "Bearer writer" } },
    fetch: async (url, init) => app.request(url.toString(), init as RequestInit),
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return {
      content: r.content as (Text | { type: "image"; data: string; mimeType: string })[],
      text: (r.content as Text[]).map((c) => c.text ?? "").join("\n"),
      isError: !!r.isError,
    };
  };
  return { call };
}

const codes = (lint: { code: string }[]) => lint.map((l) => l.code).sort();

describe("SVG fences (TEMPRA-206)", () => {
  test("lint on write: invalid, unsafe and without alt; a clean one has none", async () => {
    const s = setup();
    const { call } = await connect(s.app);
    const write = async (path: string, body: string) => {
      const r = await call("write", { path, content: doc(body), note: "svg" });
      expect(r.isError).toBe(false);
      return r.text;
    };
    expect(await write("ok.md", fence(SVG))).toContain("Lint: none");
    const bad = await write("bad.md", fence("<svg><rect></svg>", 'alt="x"'));
    expect(bad).toContain("svg_invalid");
    expect(bad).toContain("Figure 1 (svg, block ");
    expect(bad).toContain("does not parse at line 1, column 12 of the fence: </svg> closes <rect>");
    const unsafe = await write("unsafe.md", fence(UNSAFE));
    expect(unsafe).toContain("svg_unsafe");
    expect(unsafe).toContain("scripts");
    expect(unsafe).toContain("event handlers");
    expect(unsafe).toContain("image_no_alt");
    const res = (await (
      await s.req("/files/unsafe.md", { headers: { Accept: "application/json" } })
    ).json()) as { lint: { code: string }[] };
    expect(codes(res.lint)).toEqual(["image_no_alt", "svg_unsafe"]);
    // The fence's alt says what it shows.
    expect(
      await write("alt.md", fence(UNSAFE.replace('onload="x()"', ""), 'alt="A dot"')),
    ).not.toContain("image_no_alt");
  });

  test("read lists it as a figure with its alt; render and diagrams: true draw it sanitized", async () => {
    const s = setup();
    // The real client around a recording render Worker: what it is sent is what is drawn.
    const sent: { source: string; lang?: string; png?: boolean }[] = [];
    s.deps.renderDiagram = serviceRenderer({
      async render(req) {
        sent.push(req);
        return {
          svg: req.source,
          ...(req.png ? { png: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) } : {}),
        };
      },
    });
    const { call } = await connect(s.app);
    await call("write", {
      path: "f.md",
      content: doc(`Intro.\n\n${fence(UNSAFE, 'alt="A dot" title="The dot"')}`),
    });
    const read = await call("read", { path: "f.md" });
    expect(read.text).toContain('Figure 1 · diagram (svg) · alt "A dot" · caption "The dot"');
    const drawn = await call("read", { path: "f.md", diagrams: true });
    expect(drawn.content.some((c) => c.type === "image")).toBe(true);
    // The render Worker is sent the sanitized SVG, never the fence as written.
    expect(sent.at(-1)).toMatchObject({
      lang: "svg",
      source:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2" width="2" height="2"><circle r="1"/></svg>',
      png: true,
      measure: true,
    });
    const byFigure = await call("render", { path: "f.md", figure: 1 });
    expect(byFigure.content[0]).toMatchObject({ type: "text" });
    expect((byFigure.content[0] as Text).text).toContain(
      'Figure 1 of /f.md ("The dot") · svg · light',
    );
    expect(byFigure.content[1]?.type).toBe("image");
    // A source, by lang or as a pasted fence.
    expect((await call("render", { source: SVG, lang: "svg" })).content[1]?.type).toBe("image");
    expect((await call("render", { source: fence(SVG) })).text).toContain("· svg ·");
    // Before it is written (TEMPRA-213): told from the source with no lang, and checked as a
    // write would check it, what a write would report said with the drawing.
    const before = sent.length;
    const told = await call("render", { source: UNSAFE });
    expect(told.content[1]?.type).toBe("image");
    expect(sent.length).toBe(before + 1);
    const said = (told.content[0] as Text).text;
    expect(said).toContain("Diagram · svg · light");
    expect(said).toContain("A write would report:\n- svg_unsafe: The SVG is drawn without");
    expect(said).toContain("event handlers, scripts");
    // Alt text lives on the fence's header, so it is asked for only when the fence is given.
    expect(said).not.toContain("image_no_alt");
    expect((await call("render", { source: fence(UNSAFE) })).text).toContain(
      "- image_no_alt: The SVG has no alt text",
    );
    expect((await call("render", { source: fence(SVG) })).text).not.toContain("A write would");
    // One a write would call invalid is not sent to be drawn.
    const broken = await call("render", { source: "<svg><g></svg>", lang: "svg" });
    expect(broken.text).toContain(
      "Not drawn.\nA write would report:\n- svg_invalid: The SVG does not parse at line 1, column 9 of the fence: </svg> closes <g>.",
    );
    expect(sent.length).toBe(before + 3);
  });

  test("the render client sanitizes before the render Worker, and passes lang", async () => {
    const seen: unknown[] = [];
    const service: RenderService = {
      async render(req) {
        seen.push(req);
        return { svg: req.source };
      },
    };
    const render = serviceRenderer(service);
    await render({ source: UNSAFE, lang: "svg", theme: "light" }, { account: "a" });
    expect(seen).toEqual([
      {
        source:
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2" width="2" height="2"><circle r="1"/></svg>',
        lang: "svg",
        theme: "light",
        width: undefined,
        png: false,
      },
    ]);
    const bad = await render({ source: "<svg>", lang: "svg", theme: "light" }, { account: "a" });
    expect(bad.error).toMatchObject({
      message: "The SVG does not parse: <svg> is not closed.",
      line: 1,
    });
    expect(seen).toHaveLength(1);
  });

  test("the render Worker draws a sanitized SVG at its size, scaled to the width, in the theme's ink", async () => {
    const pages: { html: string; width: number; height: number }[] = [];
    const objects = new Map<string, string | Uint8Array>();
    const cache: RenderCache = {
      async get(key) {
        const v = objects.get(key);
        if (v === undefined) return null;
        return {
          text: async () => (typeof v === "string" ? v : new TextDecoder().decode(v)),
          arrayBuffer: async () =>
            (typeof v === "string" ? new TextEncoder().encode(v) : v).slice().buffer as ArrayBuffer,
        };
      },
      async put(key, value) {
        objects.set(key, value);
      },
    };
    const deps = {
      cache,
      rasterizer: {
        async png(html: string, size: { width: number; height: number }) {
          pages.push({ html, ...size });
          return new Uint8Array([0x89]);
        },
      },
    };
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" width="1360" height="200" viewBox="0 0 1360 200"><rect width="10" height="10" fill="currentColor"/></svg>';
    const r = await renderDiagram(
      { source, lang: "svg", theme: "dark", width: 680, png: true },
      deps,
    );
    expect(r.error).toBeUndefined();
    expect(r.svg).toStartWith('<svg width="680" height="100" color="');
    expect(pages[0]).toMatchObject({ width: 680, height: 100 });
    expect([...objects.keys()].every((k) => k.includes("/svg-3/"))).toBe(true);
    // The palette's values for the theme on its root (TEMPRA-315), as the reader's CSS gives them.
    expect(r.svg).toContain(`--accent:${svgPalettes.dark["--accent"]}`);
    expect(r.svg?.match(/ style="/g)).toHaveLength(1);
    expect(() => svgFigure("<svg><script>x()</script></svg>", "light", 0)).toThrow("not sanitized");
  });

  test("the render Worker draws an SVG fence's text in the reader's Inter, unless the author chose (TEMPRA-216)", () => {
    const plain = svgFigure(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><text y="8">a</text></svg>',
      "light",
      0,
    );
    expect(plain).toStartWith(
      `<svg width="20" height="10" color="#282a2f" font-family="${attr(FONT)}"`,
    );
    expect(FONT).toStartWith('"Inter"');
    const own = svgFigure(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10" font-family="Georgia"><text y="8">a</text></svg>',
      "light",
      0,
    );
    expect(own).toContain(' font-family="Georgia"');
    expect(own.match(/font-family=/g)).toHaveLength(1);
    // The page around it is in Inter as well, so no text falls back to the browser's serif.
    expect(pageFor(plain, "dark")).toContain(`font-family:${FONT}}`);
  });

  test("exports carry a sanitized SVG beside the page, with no renderer needed", async () => {
    const s = setup();
    s.deps.renderDiagram = undefined;
    const body = `![x](/pic.png)\n\n${fence(UNSAFE)}\n\`\`\`mermaid\nflowchart LR\n  A --> B\n\`\`\`\n`;
    expect((await s.req("/files/n/a.md", { method: "PUT", body: doc(body) })).status).toBe(200);
    const r = await s.req("/export");
    const out = new Map(
      readTar(new Uint8Array(await r.arrayBuffer())).map((f) => [
        f.path,
        new TextDecoder().decode(f.bytes),
      ]),
    );
    // Figure 1 is the image, 2 the SVG fence; the Mermaid one needs the renderer it lacks.
    expect([...out.keys()].filter((p) => p.includes(".diagrams/"))).toEqual(["n/a.diagrams/2.svg"]);
    // The palette's light values and the ink written in, so the file stands alone (TEMPRA-315).
    expect(out.get("n/a.diagrams/2.svg")).toBe(
      '<svg color="#282a2f" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2" width="2" height="2"><circle r="1"/></svg>',
    );
  });
});

describe("SVG-first diagrams (TEMPRA-315)", () => {
  test("the palette's names are the design's, with a value in each theme", () => {
    for (const theme of ["light", "dark"] as const) {
      expect(Object.keys(svgPalettes[theme])).toEqual([...SVG_PALETTE]);
      for (const v of Object.values(svgPalettes[theme])) expect(v).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("colours: parsed as CSS reads them, and judged against the page in both themes", () => {
    expect(parseColor("#fff")).toEqual([255, 255, 255, 1]);
    expect(parseColor("#00000080")?.[3]).toBeCloseTo(0.5);
    expect(parseColor("rgb(255 0 0 / 50%)")).toEqual([255, 0, 0, 0.5]);
    expect(parseColor("hsl(120, 100%, 25%)")).toEqual([0, 127.5, 0, 1]);
    expect(parseColor("RebeccaPurple")).toEqual([102, 51, 153, 1]);
    expect(parseColor("toString")).toBeNull();
    expect(parseColor("oklch(0.5 0.1 200)")).toBeNull();
    expect(contrast([0, 0, 0, 1], [255, 255, 255, 1])).toBeCloseTo(21);
    expect(colorFailsIn("black")).toEqual(["dark"]);
    expect(colorFailsIn("#fff")).toEqual(["light"]);
    expect(colorFailsIn("#f0f0f0")).toEqual(["light"]);
    expect(colorFailsIn("#808080")).toEqual([]);
    expect(colorFailsIn("rgba(0,0,0,0.1)")).toEqual([]);
    expect(colorFailsIn("bogus")).toEqual([]);
    // The palette itself holds on its own page.
    expect(colorFailsIn(svgPalettes.light["--muted"] as string)).not.toContain("light");
  });

  test("lint on write: svg_color names fixed colours and foreign var()s; the palette passes", async () => {
    const s = setup();
    const { call } = await connect(s.app);
    const write = async (path: string, body: string) =>
      (await call("write", { path, content: doc(body), note: "svg" })).text;
    const good = await write(
      "good.md",
      fence(
        '<svg viewBox="0 0 20 10"><title>t</title><rect fill="var(--surface)" stroke="var(--muted)"/><text fill="currentColor">a</text><rect fill="#808080"/></svg>',
      ),
    );
    expect(good).toContain("Lint: none");
    const bad = await write(
      "bad.md",
      fence(
        '<svg viewBox="0 0 20 10"><title>t</title><text fill="black">a</text><rect fill="#fafafa" stroke="var(--tempra-color-agent)"/></svg>',
      ),
    );
    expect(bad).toContain("svg_color");
    expect(bad).toContain("black (dark), #fafafa (light)");
    expect(bad).toContain("var(--tempra-color-agent), which is not in the palette");
    expect(bad).not.toContain("svg_unsafe");
  });

  test("lint on write: a fence's width= and layout= that are not one are figure_invalid", async () => {
    const s = setup();
    const { call } = await connect(s.app);
    const ok = await call("write", {
      path: "ok.md",
      content: doc(fence(SVG, "width=480 layout=wide")),
      note: "svg",
    });
    expect(ok.text).toContain("Lint: none");
    const bad = await call("write", {
      path: "bad.md",
      content: doc(`\`\`\`mermaid width=huge layout=side\nflowchart LR\n  A --> B\n\`\`\`\n`),
      note: "m",
    });
    expect(bad.text).toContain("figure_invalid");
    expect(bad.text).toContain("width=huge is not a width");
    expect(bad.text).toContain("layout=side is not a layout");
  });

  test("overflow: a label wider than its box and drawing past the viewBox, found from a layout", () => {
    const found = overflowFindings({
      width: 300,
      height: 100,
      items: [
        { tag: "rect", x: 0, y: 0, w: 300, h: 100 },
        { tag: "rect", x: 10, y: 30, w: 80, h: 40 },
        { tag: "text", text: "A much longer label", x: 5, y: 42, w: 120, h: 16 },
        { tag: "rect", x: 150, y: 30, w: 100, h: 40 },
        { tag: "text", text: "Fits", x: 185, y: 42, w: 30, h: 16 },
        { tag: "text", text: "Edge", x: 270, y: 80, w: 44, h: 16 },
        { tag: "path", x: -6, y: 10, w: 20, h: 2 },
      ],
    });
    expect(found).toEqual([
      "“A much longer label” is 40 px wider than the <rect> around it",
      "“Edge” runs 14 px past the right edge of the viewBox",
      "a <path> runs 6 px past the left edge of the viewBox",
    ]);
    const many = overflowFindings({
      width: 10,
      height: 10,
      items: Array.from({ length: 8 }, (_, i) => ({ tag: "circle", x: 20 + i, y: 0, w: 5, h: 5 })),
    });
    expect(many).toHaveLength(6);
    expect(many.at(-1)).toBe("3 more");
  });

  test("overflow: measured by the render Worker when it can, cached, and kept as svg_overflow lint", async () => {
    // The render Worker with a rasterizer that lays out: what it answers is the overflow.
    const objects = new Map<string, string | Uint8Array>();
    let layouts = 0;
    const deps = {
      cache: {
        async get(key: string) {
          const v = objects.get(key);
          return v === undefined
            ? null
            : {
                text: async () => (typeof v === "string" ? v : new TextDecoder().decode(v)),
                arrayBuffer: async () => new ArrayBuffer(0),
              };
        },
        async put(key: string, value: string | Uint8Array) {
          objects.set(key, value);
        },
      } satisfies RenderCache,
      rasterizer: {
        async png() {
          return new Uint8Array([0x89]);
        },
        async layout() {
          layouts++;
          return {
            width: 20,
            height: 10,
            items: [{ tag: "text", text: "Wide", x: 2, y: 2, w: 30, h: 6 }],
          };
        },
      },
    };
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10" width="20" height="10"><text>Wide</text></svg>';
    const one = await renderDiagram({ source, lang: "svg", theme: "light", measure: true }, deps);
    expect(one.overflow).toEqual(["“Wide” runs 12 px past the right edge of the viewBox"]);
    const again = await renderDiagram({ source, lang: "svg", theme: "light", measure: true }, deps);
    expect(again.overflow).toEqual(one.overflow);
    expect(layouts).toBe(1);
    // A rasterizer that cannot measure answers no overflow at all.
    const blind = await renderDiagram(
      { source: `${source} `, lang: "svg", theme: "light", measure: true },
      { cache: deps.cache, rasterizer: { png: deps.rasterizer.png } },
    );
    expect(blind.overflow).toBeUndefined();

    // After a write: the verdict becomes svg_overflow lint on the page.
    const s = setup();
    const render = fakeRenderer((req) =>
      req.lang === "svg"
        ? {
            svg: req.source,
            overflow: req.measure ? ["“Wide” runs 12 px past the right edge of the viewBox"] : [],
          }
        : { svg: "<svg/>" },
    );
    s.deps.renderDiagram = render;
    s.deps.renderBudgetMs = 5_000;
    const { call } = await connect(s.app);
    const w = await call("write", {
      path: "o.md",
      content: doc(fence('<svg viewBox="0 0 20 10"><title>t</title><text>Wide</text></svg>')),
      note: "svg",
    });
    expect(w.text).toContain("svg_overflow: o.md: Figure 1 (svg, block");
    expect(w.text).toContain(
      "overflows as drawn: “Wide” runs 12 px past the right edge of the viewBox.",
    );
    expect(render.calls.find((c) => c.lang === "svg")).toMatchObject({ measure: true, png: false });
    expect((await call("read", { path: "o.md" })).text).toContain("svg_overflow");
  });

  test("render says what the browser measured, as a write would", async () => {
    const s = setup();
    s.deps.renderDiagram = fakeRenderer((req) => ({
      svg: req.source,
      png: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      ...(req.measure ? { overflow: ["“X” is 4 px wider than the <rect> around it"] } : {}),
    }));
    const { call } = await connect(s.app);
    const r = await call("render", { source: SVG, lang: "svg" });
    expect(r.text).toContain(
      "A write would report:\n- svg_overflow: “X” is 4 px wider than the <rect> around it.",
    );
  });
});
