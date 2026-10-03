/**
 * Whether a state-changing request came from this site's own pages (CSRF defence alongside
 * SameSite=Lax cookies). Browsers send Origin on form posts, but some send `Origin: null` (for
 * example under a no-referrer policy); then Sec-Fetch-Site, which browsers set and pages cannot,
 * decides.
 */
export function fromThisSite(req: Request): boolean {
  const origin = req.headers.get("Origin");
  if (origin && origin !== "null") return origin === new URL(req.url).origin;
  return req.headers.get("Sec-Fetch-Site") === "same-origin";
}
