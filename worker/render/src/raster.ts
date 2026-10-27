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

/** The longest edge a poster frame is taken at, in CSS pixels. */
export const POSTER_MAX_EDGE = 1920;

/** A video's frame at `time` seconds as a PNG, at the video's own size (capped); or why not. */
export interface PosterGrabber {
  frame(
    url: string,
    time: number,
  ): Promise<{ png: Uint8Array; width: number; height: number } | { error: string }>;
}

/**
 * Posters on Browser Rendering (TEMPRA-208): a page holding the video alone, loaded from the
 * short-lived signed URL the main Worker gives (the only request let through), seeked to `time`
 * and screenshotted at the video's own size. A video the browser cannot decode says so.
 */
export function browserPoster(binding: BrowserBinding): PosterGrabber {
  return {
    async frame(url, time) {
      const browser = await browserFor(binding);
      const page = await browser.newPage();
      try {
        await page.setRequestInterception(true);
        page.on("request", (r) => {
          if (r.url() === url || r.url().startsWith("data:")) r.continue();
          else r.abort();
        });
        await page.setViewport({ width: 640, height: 360, deviceScaleFactor: 1 });
        const src = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
        await page.setContent(
          `<!doctype html><html><head><style>html,body{margin:0;background:#000}video{display:block;width:100vw;height:100vh;object-fit:contain}</style></head><body><video muted playsinline preload="auto" src="${src}"></video></body></html>`,
          { waitUntil: "domcontentloaded" },
        );
        // Evaluated by the protocol, not by page script: seek, and answer the frame's size.
        const size = (await page.evaluate(`new Promise((resolve) => {
          const v = document.querySelector("video");
          const done = () => resolve([v.videoWidth, v.videoHeight]);
          v.addEventListener("error", () => resolve(null), { once: true });
          const seek = () => {
            v.addEventListener("seeked", done, { once: true });
            v.currentTime = Math.min(${Number(time)}, Number.isFinite(v.duration) ? Math.max(0, v.duration - 0.05) : ${Number(time)});
          };
          if (v.readyState >= 1) seek(); else v.addEventListener("loadedmetadata", seek, { once: true });
          setTimeout(() => resolve(null), 15000);
        })`)) as [number, number] | null;
        if (!size?.[0] || !size[1]) {
          return { error: "the video could not be read or decoded by the browser" };
        }
        const scale = Math.min(1, POSTER_MAX_EDGE / Math.max(size[0], size[1]));
        const width = Math.round(size[0] * scale);
        const height = Math.round(size[1] * scale);
        await page.setViewport({ width, height, deviceScaleFactor: 1 });
        const shot = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height } });
        return { png: new Uint8Array(shot), width, height };
      } finally {
        await page.close().catch(() => {});
        await browser.disconnect().catch(() => {});
      }
    },
  };
}
