import { defineConfig } from "astro/config";

// A static site: every page is pre-rendered at build time into dist/, which the tempra-site Worker
// serves as static assets (wrangler.jsonc). No adapter, no server rendering.
export default defineConfig({
  site: "https://tempra.dev",
  // One external stylesheet rather than inlined styles, so the CSP can stay style-src 'self'.
  build: { inlineStylesheets: "never" },
});
