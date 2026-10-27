/**
 * Diagrams drawn by the render Worker (TEMPRA-165; render/): this Worker never imports Pele, it
 * asks tempra-render over the RENDER service binding. `renderDiagram` in Deps is how the follow-ups
 * reach it (TEMPRA-166 the render tool and read's diagrams, TEMPRA-167 lint after a write,
 * TEMPRA-168 exports). Without the binding (local `cf dev`, the gate, tests that pass none) every
 * call answers RENDER_UNAVAILABLE; a call that fails or takes too long answers an error too, never
 * a throw.
 */
import { sanitizeSvg } from "@tempra/editor/doc";
import type { RenderLang, RenderRequest, RenderResult } from "../render/src/render";
import { MAX_CHART_SOURCE } from "../render/src/version";
import type { UsageEvent } from "./usage";

export type { RenderError, RenderLang, RenderRequest, RenderResult } from "../render/src/render";

/**
 * What the render Worker is sent for a request: an SVG fence is sanitized here, in this Worker
 * (TEMPRA-206), so the render Worker only themes and rasterizes; a fence that does not parse is
 * answered with where, as Pele's errors are.
 */
export function forRenderer(
  req: RenderRequest,
): { ok: true; req: RenderRequest } | { ok: false; result: RenderResult } {
  if (req.lang !== "svg") return { ok: true, req };
  const r = sanitizeSvg(req.source);
  if (!r.ok) {
    return {
      ok: false,
      result: {
        error: { message: `The SVG does not parse: ${r.message}.`, line: r.line, column: r.column },
      },
    };
  }
  return { ok: true, req: { ...req, source: r.svg } };
}

/** The fence languages the server draws (TEMPRA-166, TEMPRA-206, TEMPRA-207). */
export const RENDER_LANGS = ["mermaid", "svg", "vega-lite"] as const;

export function isRenderLang(lang: string): lang is RenderLang {
  return (RENDER_LANGS as readonly string[]).includes(lang);
}

/** Who refuses a source of a language, as an agent is told: "Pele could not draw it". */
export function drawerOf(lang: string): string {
  return lang === "mermaid" ? "Pele" : lang === "vega-lite" ? "Vega" : "Tempra";
}

/** The message of a render that could not reach the render Worker. */
export const RENDER_UNAVAILABLE = "render unavailable";

/** How long a caller waits for the render Worker (it gives a PNG 20 s). */
export const RENDER_TIMEOUT_MS = 30_000;

/** The largest source sent, in characters; the render Worker refuses above it too. */
export const MAX_RENDER_SOURCE = 50_000;

/**
 * The width a diagram is drawn at for a model (TEMPRA-166) and in exports (TEMPRA-168): the
 * reader's column (`--tempra-measure`), so the PNG at 2x is within MODEL_EDGE and the layout is
 * what people see.
 */
export const RENDER_WIDTH = 680;

/** The Renderer entrypoint's RPC, as the RENDER binding exposes it. */
export interface RenderService {
  render(req: RenderRequest): Promise<RenderResult>;
  /** A video's frame at `time` seconds from a signed URL, as a PNG (TEMPRA-208). */
  poster?(req: { url: string; time: number }): Promise<PosterResult>;
}

/** A poster frame, or why there is none. */
export type PosterResult = { png: Uint8Array; width: number; height: number } | { error: string };

export type PosterFrame = (
  req: { url: string; time: number },
  ctx: RenderContext,
) => Promise<PosterResult>;

/** How long a caller waits for a poster frame (loading the video and seeking in a browser). */
export const POSTER_TIMEOUT_MS = 45_000;

/**
 * The poster client over the RENDER binding (TEMPRA-208), metered as `render`; without the
 * binding (local dev) it says so, and it never throws.
 */
export function servicePoster(
  service: RenderService | undefined,
  meter?: (e: UsageEvent) => void,
  timeoutMs = POSTER_TIMEOUT_MS,
): PosterFrame {
  return async (req, ctx) => {
    if (!service?.poster) return { error: RENDER_UNAVAILABLE };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const r = await Promise.race([
        service.poster(req),
        new Promise<PosterResult>((resolve) => {
          timer = setTimeout(
            () => resolve({ error: `${RENDER_UNAVAILABLE}: no frame in ${timeoutMs / 1000} s` }),
            timeoutMs,
          );
        }),
      ]);
      if ("png" in r) {
        meter?.({
          kind: "render",
          account: ctx.account,
          library: ctx.library,
          bytes: r.png.byteLength,
        });
      }
      return r;
    } catch (e) {
      console.error(JSON.stringify({ poster_failed: String(e) }));
      return { error: RENDER_UNAVAILABLE };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}

/** Who a render counts against, for metering. */
export interface RenderContext {
  account: string;
  library?: string;
}

export type RenderDiagram = (req: RenderRequest, ctx: RenderContext) => Promise<RenderResult>;

const failed = (message: string): RenderResult => ({ error: { message, line: 0, column: 0 } });

/**
 * The client over a RENDER binding, or one that answers "render unavailable" when there is none.
 * Each call is metered as `render` (bytes: the SVG's length plus the PNG's).
 */
export function serviceRenderer(
  service: RenderService | undefined,
  meter?: (e: UsageEvent) => void,
  timeoutMs = RENDER_TIMEOUT_MS,
): RenderDiagram {
  return async (req, ctx) => {
    if (!service) return failed(RENDER_UNAVAILABLE);
    // A chart arrives with its data inline (chart-data.ts), so it may be larger.
    if (req.source.length > (req.lang === "vega-lite" ? MAX_CHART_SOURCE : MAX_RENDER_SOURCE)) {
      return failed(`The diagram is longer than the limit of ${MAX_RENDER_SOURCE} characters.`);
    }
    const sent = forRenderer(req);
    if (!sent.ok) return sent.result;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        service.render({
          source: sent.req.source,
          ...(req.lang && req.lang !== "mermaid" ? { lang: req.lang } : {}),
          width: req.width,
          theme: req.theme,
          png: req.png === true,
        }),
        new Promise<RenderResult>((resolve) => {
          timer = setTimeout(
            () => resolve(failed(`${RENDER_UNAVAILABLE}: no answer in ${timeoutMs / 1000} s`)),
            timeoutMs,
          );
        }),
      ]);
      meter?.({
        kind: "render",
        account: ctx.account,
        library: ctx.library,
        bytes: (result.svg?.length ?? 0) + (result.png?.byteLength ?? 0),
      });
      return result;
    } catch (e) {
      console.error(JSON.stringify({ render_failed: String(e) }));
      return failed(RENDER_UNAVAILABLE);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}

/**
 * A test double: answers what `draw` returns (by default an SVG naming the source's first line, or
 * a PNG of four bytes when asked), recording each request.
 */
export function fakeRenderer(
  draw?: (req: RenderRequest) => RenderResult | Promise<RenderResult>,
): RenderDiagram & { calls: RenderRequest[] } {
  const calls: RenderRequest[] = [];
  const fn = async (req: RenderRequest) => {
    calls.push(req);
    if (draw) return draw(req);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" data-theme="${req.theme}"><title>${(
      req.source.split("\n", 1)[0] ?? ""
    ).replace(/[<&"]/g, "")}</title></svg>`;
    return req.png ? { svg, png: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) } : { svg };
  };
  return Object.assign(fn, { calls });
}
