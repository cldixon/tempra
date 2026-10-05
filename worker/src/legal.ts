import type { Hono } from "hono";

/**
 * /terms and /privacy live on the landing page, tempra.dev (TEMPRA-14): static text, linkable
 * and crawlable. The app's old URLs redirect there, so links in old emails still work.
 */
export const LEGAL = "https://tempra.dev";

export function registerLegalRoutes<E extends object>(app: Hono<E>) {
  app.get("/privacy", (c) => c.redirect(`${LEGAL}/privacy`, 301));
  app.get("/terms", (c) => c.redirect(`${LEGAL}/terms`, 301));
}
