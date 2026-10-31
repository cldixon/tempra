/**
 * The tempra-site Worker: serves the static build (dist/) through the ASSETS binding, redirects
 * www.tempra.dev to the apex, and adds security headers. Nothing else runs here.
 */
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const HEADERS: Record<string, string> = {
  // No scripts, no third parties: the site is HTML, one stylesheet and its fonts.
  "Content-Security-Policy":
    "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname === "www.tempra.dev") {
      url.hostname = "tempra.dev";
      return Response.redirect(url.toString(), 301);
    }
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    for (const [name, value] of Object.entries(HEADERS)) response.headers.set(name, value);
    // The favicon (an SVG from the design package) themes itself with an inline <style>; an SVG
    // is drawn under its own response's CSP, so it gets one that allows that and nothing else.
    if (response.headers.get("Content-Type")?.startsWith("image/svg+xml")) {
      response.headers.set("Content-Security-Policy", SVG_CSP);
    }
    return response;
  },
};
