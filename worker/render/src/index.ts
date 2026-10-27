/**
 * tempra-render (TEMPRA-165): one RPC, `render`, on the Renderer entrypoint, which the deployment's
 * Worker reaches through its RENDER service binding (worker/src/render.ts). No public routes.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import { browserPoster, browserRasterizer } from "./raster";
import { type RenderRequest, type RenderResult, renderDiagram } from "./render";

/** What `poster` answers: a frame as a PNG, or why there is none (TEMPRA-208). */
export type PosterResult = { png: Uint8Array; width: number; height: number } | { error: string };

export class Renderer extends WorkerEntrypoint<Env> {
  /** A video's frame at `time` seconds, from a short-lived signed URL the main Worker made. */
  async poster(req: { url: string; time: number }): Promise<PosterResult> {
    if (typeof req?.url !== "string" || !/^https:\/\//.test(req.url)) {
      return { error: "the video's address must be https" };
    }
    const time = Number.isFinite(req.time) && req.time >= 0 ? req.time : 0;
    try {
      return await browserPoster(this.env.BROWSER).frame(req.url, time);
    } catch (e) {
      return {
        error: `the frame could not be taken: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  async render(req: RenderRequest): Promise<RenderResult> {
    return renderDiagram(req, {
      cache: this.env.BLOBS,
      rasterizer: browserRasterizer(this.env.BROWSER),
    });
  }
}

export default {
  fetch: () => new Response("Not found", { status: 404 }),
} satisfies ExportedHandler<Env>;
