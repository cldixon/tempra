import { describe, expect, test } from "bun:test";
import { peleThemeHash, peleThemes } from "@tempra/design/pele";
import {
  cacheKey,
  MAX_SOURCE,
  PELE_MESSAGE_FORMAT,
  PELE_VERSION,
  type Rasterizer,
  RENDERS_PREFIX,
  type RenderCache,
  renderDiagram,
  sha256,
  themed,
} from "../render/src/render";
import {
  fakeRenderer,
  RENDER_UNAVAILABLE,
  type RenderService,
  serviceRenderer,
} from "../src/render";
import type { UsageEvent } from "../src/usage";

const flowchart = "flowchart LR\n  A[Write] --> B{Parses?}\n  B -->|yes| C[Drawn]";
const broken = "flowchart LR\n  A[Write --> B";

/** An in-memory bucket with the R2 calls the cache makes, counting gets and puts. */
function bucket() {
  const objects = new Map<string, { value: string | Uint8Array; type?: string }>();
  const calls = { get: 0, put: 0 };
  const cache: RenderCache = {
    async get(key) {
      calls.get++;
      const o = objects.get(key);
      if (!o) return null;
      return {
        text: async () =>
          typeof o.value === "string" ? o.value : new TextDecoder().decode(o.value),
        arrayBuffer: async () =>
          (typeof o.value === "string" ? new TextEncoder().encode(o.value) : o.value).slice()
            .buffer as ArrayBuffer,
      };
    },
    async put(key, value, opts) {
      calls.put++;
      objects.set(key, { value, type: opts?.httpMetadata?.contentType });
    },
  };
  return { cache, objects, calls };
}

/** A rasterizer double: records each page and answers a PNG signature and the size. */
function raster(fail?: Error | "hang") {
  const pages: { html: string; width: number; height: number; scale: number }[] = [];
  const r: Rasterizer = {
    async png(html, size) {
      pages.push({ html, ...size });
      if (fail === "hang") return new Promise(() => {});
      if (fail) throw fail;
      return new Uint8Array([0x89, 0x50, 0x4e, 0x47, size.width & 0xff]);
    },
  };
  return { rasterizer: r, pages };
}

describe("the render Worker's logic (TEMPRA-165)", () => {
  test("an SVG themed with the reader's greys, light and dark, standing alone", async () => {
    const b = bucket();
    const { rasterizer, pages } = raster();
    for (const theme of ["light", "dark"] as const) {
      const r = await renderDiagram({ source: flowchart, theme }, { cache: b.cache, rasterizer });
      expect(r.error).toBeUndefined();
      expect(r.svg?.startsWith("<svg")).toBe(true);
      expect(r.svg).toContain(`--pele-bg:${peleThemes[theme]["--pele-bg"]}`);
      expect(r.svg).toContain(`--pele-fg:${peleThemes[theme]["--pele-fg"]}`);
      // The font's quotes are escaped inside the style attribute.
      expect(r.svg).toContain("--pele-font:&quot;Inter&quot;");
      expect(r.png).toBeUndefined();
    }
    expect(pages).toHaveLength(0);
  });

  test("a fence that did not change never renders twice; width and theme are part of the key", async () => {
    const b = bucket();
    const { rasterizer } = raster();
    const deps = { cache: b.cache, rasterizer };
    const first = await renderDiagram({ source: flowchart, theme: "light", width: 600 }, deps);
    expect(b.calls.put).toBe(1);
    // Whatever is cached is what comes back: change it and see.
    const key = cacheKey(await sha256(flowchart), "light", 600, "svg");
    expect(b.objects.get(key)?.value).toBe(first.svg as string);
    expect(b.objects.get(key)?.type).toBe("image/svg+xml");
    b.objects.set(key, { value: "<svg>cached</svg>" });
    expect((await renderDiagram({ source: flowchart, theme: "light", width: 600 }, deps)).svg).toBe(
      "<svg>cached</svg>",
    );
    expect(b.calls.put).toBe(1);
    await renderDiagram({ source: flowchart, theme: "light", width: 300 }, deps);
    await renderDiagram({ source: flowchart, theme: "dark", width: 600 }, deps);
    expect(b.calls.put).toBe(3);
  });

  test("the key: renders/, the source's SHA-256, Pele's version, the theme and its hash, width, format", async () => {
    const hash = await sha256(flowchart);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(cacheKey(hash, "dark", 0, "png")).toBe(
      `renders/${hash}/pele-${PELE_VERSION}/dark-${peleThemeHash}/w0.png`,
    );
    expect(RENDERS_PREFIX).toBe("renders/");
  });

  test("Pele's error, with its line and column, is cached too", async () => {
    const b = bucket();
    const { rasterizer, pages } = raster();
    const deps = { cache: b.cache, rasterizer };
    const r = await renderDiagram({ source: broken, theme: "light", png: true }, deps);
    expect(r.svg).toBeUndefined();
    expect(r.error?.message).toBeTruthy();
    expect(r.error?.line).toBeGreaterThan(0);
    expect(pages).toHaveLength(0);
    const key = cacheKey(await sha256(broken), "light", 0, "svg");
    expect(b.objects.get(key)?.type).toBe("application/json");
    const again = await renderDiagram({ source: broken, theme: "light" }, deps);
    expect(again).toEqual({ error: r.error });
    expect(b.calls.put).toBe(1);
  });

  test("an error cached in an older shape is drawn again (TEMPRA-184)", async () => {
    const b = bucket();
    const { rasterizer } = raster();
    const key = cacheKey(await sha256(broken), "light", 0, "svg");
    const old = { message: "Parse error on line 3:", line: 3, column: 1 };
    b.objects.set(key, { value: JSON.stringify(old), type: "application/json" });
    const r = await renderDiagram(
      { source: broken, theme: "light" },
      { cache: b.cache, rasterizer },
    );
    expect(r.error?.message).not.toBe(old.message);
    expect(r.error?.message).toStartWith("Expecting ");
    expect(r.error?.line).toBeGreaterThan(0);
    expect(b.calls.put).toBe(1);
    expect(JSON.parse(String(b.objects.get(key)?.value))).toEqual({
      ...r.error,
      format: PELE_MESSAGE_FORMAT,
    });
  });

  test("a PNG at 2x of a page holding the SVG and Inter, cached", async () => {
    const b = bucket();
    const { rasterizer, pages } = raster();
    const deps = { cache: b.cache, rasterizer };
    const r = await renderDiagram({ source: flowchart, theme: "dark", png: true }, deps);
    expect(r.error).toBeUndefined();
    expect(Array.from(r.png?.slice(0, 4) ?? [])).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(pages).toHaveLength(1);
    const page = pages[0] as (typeof pages)[number];
    expect(page.scale).toBe(2);
    expect(page.width).toBeGreaterThan(50);
    expect(page.height).toBeGreaterThan(10);
    expect(page.html).toContain(r.svg as string);
    expect(page.html).toContain("data:font/woff2;base64,");
    expect(page.html).toContain(`background:${peleThemes.dark["--pele-bg"]}`);
    const second = await renderDiagram({ source: flowchart, theme: "dark", png: true }, deps);
    expect(second.png).toEqual(r.png as Uint8Array);
    expect(pages).toHaveLength(1);
  });

  test("a rasterizer that fails or hangs gives the SVG and an error, and nothing is cached for it", async () => {
    for (const fail of [new Error("no browser"), "hang" as const]) {
      const b = bucket();
      const { rasterizer } = raster(fail);
      const r = await renderDiagram(
        { source: flowchart, theme: "light", png: true },
        { cache: b.cache, rasterizer, rasterTimeoutMs: 50 },
      );
      expect(r.svg).toBeTruthy();
      expect(r.png).toBeUndefined();
      expect(r.error?.message).toStartWith("PNG not drawn: ");
      expect([...b.objects.keys()].some((k) => k.endsWith(".png"))).toBe(false);
    }
  });

  test("limits: the source's size, the theme, the width", async () => {
    const b = bucket();
    const deps = { cache: b.cache, rasterizer: raster().rasterizer };
    const long = `flowchart LR\n${"  A --> B\n".repeat(MAX_SOURCE / 10)}`;
    expect((await renderDiagram({ source: long, theme: "light" }, deps)).error?.message).toContain(
      "limit",
    );
    expect(
      (await renderDiagram({ source: flowchart, theme: "sepia" as "light" }, deps)).error,
    ).toBeTruthy();
    expect(
      (await renderDiagram({ source: flowchart, theme: "light", width: 1e9 }, deps)).error,
    ).toBeTruthy();
    expect(b.calls.put).toBe(0);
  });

  test("themed() sets the values ahead of Pele's own declarations on the root alone", () => {
    const out = themed('<svg a="1" style="color:red"><g style="x:y"/></svg>', "light");
    expect(out).toStartWith(`<svg a="1" style="--pele-bg:${peleThemes.light["--pele-bg"]};`);
    expect(out).toContain(';color:red">');
    expect(out).toContain('<g style="x:y"/>');
    expect(themed("<svg><g/></svg>", "dark")).toStartWith('<svg style="--pele-bg:');
  });

  test("Pele is pinned at one version in the render Worker, the app and the lint tests", async () => {
    const read = async (p: string) =>
      JSON.parse(await Bun.file(new URL(p, import.meta.url)).text()) as {
        version?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
    expect((await read("../render/package.json")).dependencies?.pele).toBe(PELE_VERSION);
    expect((await read("../package.json")).devDependencies?.pele).toBe(PELE_VERSION);
    expect((await read("../render/node_modules/pele/package.json")).version).toBe(PELE_VERSION);
    const app = Bun.file(new URL("../../app/package.json", import.meta.url));
    if (await app.exists()) {
      expect(
        (JSON.parse(await app.text()) as { dependencies: Record<string, string> }).dependencies
          .pele,
      ).toBe(PELE_VERSION);
    }
  });
});

describe("the client in tempra (src/render.ts)", () => {
  test("no RENDER binding: render unavailable, never a throw", async () => {
    const r = await serviceRenderer(undefined)(
      { source: flowchart, theme: "light" },
      { account: "a" },
    );
    expect(r.error?.message).toBe(RENDER_UNAVAILABLE);
  });

  test("passes the request through, meters it as render", async () => {
    const seen: unknown[] = [];
    const metered: UsageEvent[] = [];
    const service: RenderService = {
      async render(req) {
        seen.push(req);
        return { svg: "<svg/>", png: new Uint8Array(10) };
      },
    };
    const r = await serviceRenderer(service, (e) => metered.push(e))(
      { source: flowchart, theme: "dark", width: 500, png: true },
      { account: "ann", library: "lib1" },
    );
    expect(r.svg).toBe("<svg/>");
    expect(seen).toEqual([{ source: flowchart, theme: "dark", width: 500, png: true }]);
    expect(metered).toEqual([{ kind: "render", account: "ann", library: "lib1", bytes: 16 }]);
  });

  test("a failing or silent render Worker, or a source over the cap, answers an error", async () => {
    const throwing: RenderService = {
      render: async () => {
        throw new Error("binding broke");
      },
    };
    const silent: RenderService = { render: () => new Promise(() => {}) };
    const ctx = { account: "a" };
    const req = { source: flowchart, theme: "light" as const };
    expect((await serviceRenderer(throwing)(req, ctx)).error?.message).toBe(RENDER_UNAVAILABLE);
    expect((await serviceRenderer(silent, undefined, 30)(req, ctx)).error?.message).toStartWith(
      RENDER_UNAVAILABLE,
    );
    const calls: unknown[] = [];
    const counting: RenderService = {
      render: async (r) => {
        calls.push(r);
        return { svg: "" };
      },
    };
    const big = await serviceRenderer(counting)({ ...req, source: "x".repeat(60_000) }, ctx);
    expect(big.error?.message).toContain("limit");
    expect(calls).toHaveLength(0);
  });

  test("the test double records requests and answers an SVG, and a PNG when asked", async () => {
    const render = fakeRenderer();
    const r = await render({ source: flowchart, theme: "light", png: true }, { account: "a" });
    expect(r.svg).toContain("flowchart LR");
    expect(r.png?.byteLength).toBe(4);
    expect(render.calls).toHaveLength(1);
  });
});
