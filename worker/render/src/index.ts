/**
 * tempra-render (TEMPRA-165): one RPC, `render`, on the Renderer entrypoint, which the deployment's
 * Worker reaches through its RENDER service binding (worker/src/render.ts). No public routes.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import { browserRasterizer } from "./raster";
import { type RenderRequest, type RenderResult, renderDiagram } from "./render";

export class Renderer extends WorkerEntrypoint<Env> {
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
