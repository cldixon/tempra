import { bindings, defineConfig, exports } from "cf/config";
import { COMPATIBILITY, deploymentFor } from "../cloudflare.config.ts";

/**
 * The diagram render Worker (TEMPRA-165; tempra-dev app/diagrams): Pele to SVG, and SVG to PNG
 * through Browser Rendering, cached in the deployment's blobs bucket under renders/. Reached only
 * through the `RENDER` service binding of the deployment's own Worker: no domain, no workers.dev.
 *
 * Run cf from this directory (`bunx cf deploy --mode …` in worker/render/); scripts/deploy.ts
 * deploys it before the main Worker, which binds to it. The mode picks the deployment as
 * ../cloudflare.config.ts does: tempra-render, tempra-render-staging, tempra-render-pr-N.
 */
export default defineConfig(({ mode }) => {
  const d = deploymentFor(mode);
  return {
    worker: {
      name: d.render,
      entrypoint: "src/index.ts",
      ...COMPATIBILITY,
      domains: [],
      workersDev: false,
      exports: {
        // The RPC entrypoint the main Worker's RENDER binding names.
        Renderer: exports.worker(),
      },
      env: {
        // The deployment's bucket; renders live under renders/, which the blob sweep never lists
        // or deletes (it works on blobs/ only).
        BLOBS: bindings.r2({ name: d.r2 }),
        // Browser Rendering, for PNGs.
        BROWSER: bindings.browser(),
      },
    },
  };
});
