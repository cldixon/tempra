import { defineConfig } from "astro/config";

// A static site: every page is pre-rendered at build time into dist/, which the tempra-site Worker
// serves as static assets (wrangler.jsonc). No adapter, no server rendering.
export default defineConfig({
  site: "https://tempra.dev",
  // One URL per page, with no trailing slash (TEMPRA-126, W-9): pages build to terms.html, which
  // Cloudflare serves at /terms, matching the links the app and its mail use.
  trailingSlash: "never",
  build: {
    format: "file",
    // One external stylesheet rather than inlined styles, so the CSP can stay style-src 'self'.
    inlineStylesheets: "never",
  },
  // No data: URLs (the favicon would be one), so img-src 'self' holds.
  vite: { build: { assetsInlineLimit: 0 } },
});
