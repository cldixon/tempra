/**
 * The render Worker's logic (TEMPRA-165; tempra-dev app/diagrams), free of Worker APIs so it runs
 * under bun: Pele draws a Mermaid source to SVG with the options the reader uses
 * (app/src/reader/pele.ts), themed with the reader's greys resolved for light or dark
 * (@tempra/design/pele); a rasterizer (Browser Rendering in production, a double in tests) turns
 * it into a PNG at 2x. Every answer, errors included, is cached by the source's SHA-256, Pele's
 * version, the theme, the width and the format, so a fence that did not change never renders twice.
 */
import { interLatinWoff2, peleThemeHash, peleThemes } from "@tempra/design/pele";
import { PeleError, render as peleRender } from "pele";

/** Pele, pinned exactly (worker/package.json and app/package.json; a test holds them together). */
export const PELE_VERSION = "1.6.0";

/** Where renders live in the deployment's blobs bucket; the blob sweep works on blobs/ only. */
export const RENDERS_PREFIX = "renders/";

/** The largest source drawn, in characters (a concept is under 100 KB). */
export const MAX_SOURCE = 50_000;
/** The widest drawing asked for, in CSS pixels. */
export const MAX_WIDTH = 4_000;
/** Pele's output cap, in characters of SVG. */
export const MAX_SVG = 2_000_000;
/** The most a PNG may take to draw before the call gives up. */
export const RASTER_TIMEOUT_MS = 20_000;

export type Theme = "light" | "dark";

export interface RenderRequest {
  source: string;
  /** CSS pixels the diagram may take (Pele's maxWidth); absent or 0, its natural width. */
  width?: number;
  theme: Theme;
  /** Also a PNG at 2x. */
  png?: boolean;
}

export interface RenderError {
  message: string;
  /** 1-based inside the source; 0 when Pele names no place. */
  line: number;
  column: number;
}

export interface RenderResult {
  svg?: string;
  png?: Uint8Array;
  error?: RenderError;
}

/** SVG to PNG: the SVG on a page of `background`, at `scale` device pixels per CSS pixel. */
export interface Rasterizer {
  png(html: string, size: { width: number; height: number; scale: number }): Promise<Uint8Array>;
}

/** The subset of an R2 bucket the cache needs. */
export interface RenderCache {
  get(
    key: string,
  ): Promise<{ text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(
    key: string,
    value: string | Uint8Array,
    opts?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
}

export interface RenderDeps {
  cache: RenderCache;
  rasterizer: Rasterizer;
  /** RASTER_TIMEOUT_MS unless set (tests). */
  rasterTimeoutMs?: number;
}

/** The SVG's id prefix, from the source's hash: the same source always draws the same bytes. */
export const idPrefixFor = (sourceHash: string) => `d${sourceHash.slice(0, 8)}`;

/** The font family the reader draws diagrams in (`--tempra-font-text`, via `--pele-font`). */
export const FONT = peleThemes.light["--pele-font"] ?? "sans-serif";

/** The options the reader gives Pele (app/src/reader/pele.ts `diagram()`). */
export function peleOptions(width: number, idPrefix: string) {
  return {
    idPrefix,
    maxWidth: width > 0 ? width : undefined,
    fontFamily: FONT || undefined,
    links: false,
    images: false,
    limit: MAX_SOURCE,
    outputLimit: MAX_SVG,
  };
}

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/**
 * The cache key: renders/<sha256(source)>/pele-<version>/<theme>-<theme hash>/w<width>.<format>.
 * The theme hash moves when the design's greys or font do (TEMPRA-1), so nothing stale is served.
 */
export function cacheKey(
  sourceHash: string,
  theme: Theme,
  width: number,
  format: "svg" | "png",
): string {
  return `${RENDERS_PREFIX}${sourceHash}/pele-${PELE_VERSION}/${theme}-${peleThemeHash}/w${width}.${format}`;
}

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * Pele's SVG with the theme's `--pele-*` values set on its root, ahead of Pele's own declarations
 * (which read them through var()), so the SVG stands alone: what the reader's CSS gives a figure.
 */
export function themed(svg: string, theme: Theme): string {
  const vars = Object.entries(peleThemes[theme])
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  const open = /^<svg\b[^>]*>/.exec(svg);
  if (!open) throw new Error("Pele's output does not start with <svg>.");
  const tag = open[0];
  const withVars = / style="/.test(tag)
    ? tag.replace(/ style="/, ` style="${attr(vars)};`)
    : tag.replace(/^<svg\b/, `<svg style="${attr(vars)}"`);
  return withVars + svg.slice(tag.length);
}

/** The page the rasterizer screenshots: the SVG alone on the theme's background, in Inter. */
export function pageFor(svg: string, theme: Theme): string {
  const bg = peleThemes[theme]["--pele-bg"] ?? "#ffffff";
  return `<!doctype html><html><head><meta charset="utf-8"><style>@font-face{font-family:"Inter";font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${interLatinWoff2}) format("woff2")}html,body{margin:0;padding:0;background:${bg}}svg{display:block}</style></head><body>${svg}</body></html>`;
}

function errorOf(e: unknown): RenderError {
  if (e instanceof PeleError) {
    return { message: e.message.split("\n", 1)[0] ?? e.message, line: e.line, column: e.column };
  }
  return { message: e instanceof Error ? e.message : String(e), line: 0, column: 0 };
}

/** Size from the SVG's width and height attributes. */
function sizeOf(svg: string): { width: number; height: number } {
  const tag = /^<svg\b[^>]*>/.exec(svg)?.[0] ?? "";
  const n = (name: string) => Number(new RegExp(` ${name}="([0-9.]+)"`).exec(tag)?.[1] ?? 0);
  return { width: Math.max(1, Math.ceil(n("width"))), height: Math.max(1, Math.ceil(n("height"))) };
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000} s`)), ms);
    }),
  ]).finally(() => timer !== undefined && clearTimeout(timer));
}

/** Checks a request; null when it may be drawn. */
export function refusal(req: RenderRequest): RenderError | null {
  if (typeof req?.source !== "string") return { message: "No source.", line: 0, column: 0 };
  if (req.source.length > MAX_SOURCE)
    return {
      message: `The diagram is longer than the limit of ${MAX_SOURCE} characters.`,
      line: 0,
      column: 0,
    };
  if (req.theme !== "light" && req.theme !== "dark")
    return { message: 'theme must be "light" or "dark".', line: 0, column: 0 };
  const w = req.width ?? 0;
  if (!Number.isFinite(w) || w < 0 || w > MAX_WIDTH)
    return { message: `width must be 0 to ${MAX_WIDTH}.`, line: 0, column: 0 };
  return null;
}

/** One render: the cached answer, or Pele (and the rasterizer), cached on the way out. */
export async function renderDiagram(req: RenderRequest, deps: RenderDeps): Promise<RenderResult> {
  const refused = refusal(req);
  if (refused) return { error: refused };
  const width = Math.floor(req.width ?? 0);
  const hash = await sha256(req.source);
  const svgKey = cacheKey(hash, req.theme, width, "svg");

  // The SVG, or the error Pele gave this source (cached as JSON under the same key).
  let svg: string | undefined;
  const hit = await deps.cache.get(svgKey).catch(() => null);
  if (hit) {
    const text = await hit.text();
    if (text.startsWith("<svg")) svg = text;
    else return { error: JSON.parse(text) as RenderError };
  } else {
    try {
      svg = themed(peleRender(req.source, peleOptions(width, idPrefixFor(hash))).svg, req.theme);
    } catch (e) {
      const error = errorOf(e);
      await deps.cache
        .put(svgKey, JSON.stringify(error), { httpMetadata: { contentType: "application/json" } })
        .catch(() => {});
      return { error };
    }
    await deps.cache
      .put(svgKey, svg, { httpMetadata: { contentType: "image/svg+xml" } })
      .catch(() => {});
  }
  if (!req.png) return { svg };

  const pngKey = cacheKey(hash, req.theme, width, "png");
  const pngHit = await deps.cache.get(pngKey).catch(() => null);
  if (pngHit) return { svg, png: new Uint8Array(await pngHit.arrayBuffer()) };
  try {
    const png = await withTimeout(
      deps.rasterizer.png(pageFor(svg, req.theme), { ...sizeOf(svg), scale: 2 }),
      deps.rasterTimeoutMs ?? RASTER_TIMEOUT_MS,
      "Drawing the PNG",
    );
    await deps.cache
      .put(pngKey, png, { httpMetadata: { contentType: "image/png" } })
      .catch(() => {});
    return { svg, png };
  } catch (e) {
    // Not cached: a rasterizer failure is the service's, not the source's.
    return { svg, error: { message: `PNG not drawn: ${errorOf(e).message}`, line: 0, column: 0 } };
  }
}
