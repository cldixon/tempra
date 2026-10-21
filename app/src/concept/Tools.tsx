import { useEffect, useState } from "react";
import { ApiError } from "../api";
import { Icon, Menu } from "../chrome";
import { baseName, enc, type Urls } from "../urls";
import { useFrame } from "../Workspace";
import type { PanelName } from "./Panel";

/*
 * A concept's tools in the top bar (take 4, TEMPRA-114; tempra-dev: app/reader, Layout): Copy
 * page and ⋯ (History, Properties, View Markdown, Copy link, Download .md; on a phone Copy page
 * moves to the head of ⋯, TEMPRA-118). Comments n is the page's own (it carries the open count).
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
async function copyText(text: () => Promise<string>): Promise<void> {
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

/** "Copied" for a moment after a copy, or what went wrong. */
function useCopied() {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);
  const run = (text: () => Promise<string>) =>
    copyText(text).then(
      () => setState("copied"),
      () => setState("failed"),
    );
  return { state, run };
}

/** Copy page: the stored file to the clipboard, in one click. */
export function CopyPage({ urls, path }: { urls: Urls; path: string }) {
  const { state, run } = useCopied();
  return (
    <button
      type="button"
      className="tool-pill copy-page"
      title="Copy the page as markdown"
      onClick={() => run(() => storedFile(urls, path))}
    >
      <Icon name="copy" />
      <span aria-live="polite">
        {state === "copied" ? "Copied" : state === "failed" ? "Could not copy" : "Copy page"}
      </span>
    </button>
  );
}

/** ⋯: the panels that are not Comments, the Markdown view, then the page's link and its file. */
export function PageMenu(props: {
  urls: Urls;
  path: string;
  panel: PanelName | null;
  markdown: boolean;
  onPanel(name: PanelName): void;
  onMarkdown(on: boolean): void;
}) {
  const { urls, path } = props;
  const link = useCopied();
  const page = useCopied();
  // On a phone Copy page has no room in the top bar: it heads ⋯ (and stays open to say so).
  const { narrow } = useFrame();
  return (
    <Menu
      name="More"
      title="More"
      buttonClass="icon-button"
      align="end"
      label={<Icon name="more" />}
    >
      {narrow && (
        <>
          <button
            type="button"
            className="menu-item"
            data-stay
            onClick={() => page.run(() => storedFile(urls, path))}
          >
            <Icon name="copy" />{" "}
            <span aria-live="polite">
              {page.state === "copied"
                ? "Copied"
                : page.state === "failed"
                  ? "Could not copy"
                  : "Copy page"}
            </span>
          </button>
          <hr />
        </>
      )}
      <button
        type="button"
        className="menu-item"
        aria-pressed={props.panel === "history"}
        onClick={() => props.onPanel("history")}
      >
        <Icon name="history" /> History
      </button>
      <button
        type="button"
        className="menu-item"
        aria-pressed={props.panel === "properties"}
        onClick={() => props.onPanel("properties")}
      >
        <Icon name="properties" /> Properties
      </button>
      <button
        type="button"
        className="menu-item"
        aria-pressed={props.markdown}
        onClick={() => props.onMarkdown(!props.markdown)}
      >
        <Icon name="markdown" /> {props.markdown ? "Back to page" : "View Markdown"}
      </button>
      <hr />
      <button
        type="button"
        className="menu-item"
        onClick={() =>
          link.run(async () => new URL(urls.pinned(urls.at).file(path), location.href).href)
        }
      >
        <Icon name="link" /> Copy link
      </button>
      <a className="menu-item" href={urls.raw(path)} download={baseName(path)}>
        <Icon name="download" /> Download <span className="menu-hint">.md</span>
      </a>
    </Menu>
  );
}
