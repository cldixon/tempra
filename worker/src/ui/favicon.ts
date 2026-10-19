/**
 * The tab's icon: a T in the system sans (the app's face, TEMPRA-108), in the text colour of the
 * scheme (the mark proper comes with the design's colour round, TEMPRA-1). One SVG, served at
 * /favicon.svg.
 */
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<style>text{fill:#1a1a1b;font:600 28px -apple-system,BlinkMacSystemFont,system-ui,"Segoe UI",Helvetica,sans-serif}@media(prefers-color-scheme:dark){text{fill:#ececea}}</style>
<text x="16" y="26" text-anchor="middle">T</text></svg>
`;

export function faviconResponse(): Response {
  return new Response(FAVICON_SVG, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
