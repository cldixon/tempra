import type { APIRoute } from "astro";
import { PAGES } from "../site";

/** The sitemap: the site's pages at their canonical URLs, written at build time. */
export const GET: APIRoute = ({ site }) => {
  const urls = PAGES.map((path) => `  <url><loc>${new URL(path, site)}</loc></url>`).join("\n");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`,
    { headers: { "Content-Type": "application/xml" } },
  );
};
