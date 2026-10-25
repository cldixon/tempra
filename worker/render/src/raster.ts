/**
 * The PNG rasterizer on Browser Rendering (TEMPRA-165): a page holding the themed SVG, screenshotted
 * at 2x. A browser session is reused across calls while it lives (keep_alive): an idle session is
 * joined with connect(), a new one is launched only when none is free, and the Worker disconnects
 * rather than closing, so the next render finds it. The page fetches nothing: every request but the
 * page's own data: URLs is aborted.
 */
import puppeteer from "@cloudflare/puppeteer";
import type { Rasterizer } from "./render";

/** How long an idle session stays open for the next render (Browser Rendering's maximum is 10 min). */
const KEEP_ALIVE_MS = 600_000;

type BrowserBinding = Parameters<typeof puppeteer.launch>[0];

async function browserFor(binding: BrowserBinding) {
  const sessions = await puppeteer.sessions(binding).catch(() => []);
  for (const s of sessions) {
    if (s.connectionId) continue; // another Worker is using it
    try {
      return await puppeteer.connect(binding, s.sessionId);
    } catch {
      // Taken or closed between the listing and the connect: try the next.
    }
  }
  return puppeteer.launch(binding, { keep_alive: KEEP_ALIVE_MS });
}

export function browserRasterizer(binding: BrowserBinding): Rasterizer {
  return {
    async png(html, { width, height, scale }) {
      const browser = await browserFor(binding);
      const page = await browser.newPage();
      try {
        // Pele escapes the diagram's text and filters styles, links and images (all off), so the
        // page holds no script; and it may fetch nothing.
        await page.setRequestInterception(true);
        page.on("request", (r) => {
          if (r.url().startsWith("data:")) r.continue();
          else r.abort();
        });
        await page.setViewport({ width, height, deviceScaleFactor: scale });
        await page.setContent(html, { waitUntil: "load" });
        // The embedded font, before the shot (evaluated by the protocol, not by page script).
        await page.evaluate("document.fonts.ready.then(() => true)");
        const shot = await page.screenshot({
          type: "png",
          clip: { x: 0, y: 0, width, height },
        });
        return new Uint8Array(shot);
      } finally {
        await page.close().catch(() => {});
        // Leave the session open for the next render; keep_alive closes it when idle.
        await browser.disconnect().catch(() => {});
      }
    },
  };
}
