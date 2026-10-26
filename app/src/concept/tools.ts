import { ApiError } from "../api";
import { enc, type Urls } from "../urls";

/*
 * A concept's tools in the top bar (take 4, TEMPRA-114; tempra-dev: app/reader, Layout): ⋯, with
 * Copy page at its head (TEMPRA-145; on a phone since TEMPRA-118), then History, Properties, View
 * Markdown, Copy link and Download .md. Comments n is the page's own (it carries the open count).
 */

/** The file as stored, frontmatter and body: what an agent reads (`GET …/files/{path}`). */
export async function storedFile(urls: Urls, path: string): Promise<string> {
  const res = await fetch(urls.api(`files/${enc(path)}`, { at: urls.at }), {
    credentials: "same-origin",
    headers: { Accept: "text/markdown" },
  });
  if (!res.ok) throw new ApiError(res.status, "error", res.statusText);
  return res.text();
}

/**
 * Writes text to the clipboard from a click. Where the browser takes a promise (a
 * ClipboardItem), the text is fetched inside the click's permission; else it is fetched first.
 */
export async function copyText(text: () => Promise<string>): Promise<void> {
  const C = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (C && navigator.clipboard?.write) {
    try {
      const blob = text().then((t) => new Blob([t], { type: "text/plain" }));
      await navigator.clipboard.write([new C({ "text/plain": blob })]);
      return;
    } catch {
      // Fall through to writeText.
    }
  }
  await navigator.clipboard.writeText(await text());
}
