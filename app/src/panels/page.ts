/**
 * The page panel (tempra-dev: app/page-panel): an MCP App a host draws in the chat beside a `show`
 * call. The person reads the page there as the app draws it (the same reader, the design package's
 * prose), sees its comment threads, comments on a passage or the page as themselves, marks it as
 * checked, or asks the agent about a passage in the chat. Everything it draws comes in the tool's
 * result (`structuredContent.page`, worker/src/mcp/page.ts); what it does goes back through the
 * host as `page_act` calls under the panel's grant. This module is its pure part: what the result
 * holds, how people and links are named and followed, and what it says to the chat.
 */
import type { Doc, LinkTarget } from "@tempra/editor";
import type { ActedBy } from "../agents";
import { actorAgentName, inChat } from "../agents";
import type { Thread } from "../comments/data";
import type { ImageRef, ImageSource } from "../images";
import { mediaKind } from "../images";
import type { BodyOptions } from "../reader/prepare";
import { anchorId } from "../ui";
import { baseName, dirOf, enc } from "../urls";

/** What `show` (and `page_act`) put in `structuredContent.page`. */
export interface PagePayload {
  v: 1;
  origin: string;
  library: { owner: string; slug: string };
  url: string;
  review: string;
  viewer: { id: string | null; handle: string | null; comment: boolean; check: boolean };
  grant: string | null;
  ask: string | null;
  focus: string | null;
  concept: {
    path: string;
    seq: number;
    hash: string;
    title: string;
    description: string | null;
    status: string | null;
    type: string | null;
    stale: boolean;
    doc: Doc;
    images: Record<string, ImageRef & { src: string | null }>;
  };
  head: number;
  sources: { id: string; title: string | null; resource: string | null }[];
  broken: string[];
  byline: { actor: string; agent: string | null; at: string } | null;
  checked: { actor: string; at: string; since: number; seq: number } | null;
  before: { seq: number; doc: Doc; label: string } | null;
  threads: Thread[];
  names: Record<string, string>;
}

/** What `since` a refresh asks for, to keep the changes on screen. */
export type Since = number | "previous" | "checked";

/** The page in a tool result, when it holds one this panel can draw. */
export function pageFrom(result: { structuredContent?: unknown } | null | undefined) {
  const p = (result?.structuredContent as { page?: Partial<PagePayload> } | undefined)?.page;
  if (p?.v !== 1 || !p.concept || typeof p.concept.path !== "string" || !p.concept.doc) {
    return null;
  }
  return p as PagePayload;
}

/**
 * Who acted, as the app names people (tempra-dev app/workspace, Naming): the reader is "You", a
 * person by handle, an agent for whom it acts ("Claude for @ann"), else by its app.
 */
export function nameOf(page: PagePayload, actor: string, by?: ActedBy | null): string {
  const human = actor.startsWith("human:") ? actor.slice("human:".length) : null;
  if (human !== null) return human === page.viewer.handle ? "You" : `@${human}`;
  const agent = (by?.agent ? page.names[by.agent] : undefined) ?? actorAgentName(actor);
  if (by?.surface !== "chat") return agent;
  return by.person === page.viewer.id ? "You" : inChat(agent);
}

/** The page's app URL for a library path (a concept, an attachment or a folder). */
export function appUrl(page: PagePayload, path: string, anchor: string | null = null): string {
  const { owner, slug } = page.library;
  const base = `${page.origin}/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/`;
  return `${base}${enc(path)}${anchor ?? ""}`;
}

/** A concept path a link in the body names, when it is one in this library. */
export function conceptOf(page: PagePayload, href: string): string | null {
  const { owner, slug } = page.library;
  const base = `${page.origin}/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/`;
  if (!href.startsWith(base)) return null;
  const path = decodeURIComponent(href.slice(base.length).split(/[?#]/)[0] ?? "");
  return path.endsWith(".md") && baseName(path) !== "index.md" ? path : null;
}

/**
 * How the reader draws this page's links, images and footnote markers in the panel: library
 * links at their app URLs (the panel opens a concept in place, anything else in the browser),
 * images from their signed links, markers numbered by the sources' order then the body's.
 */
export function bodyOptions(page: PagePayload): {
  options: BodyOptions;
  numbers: Map<string, number>;
} {
  const ids = page.sources.map((s) => s.id);
  const numbers = new Map<string, number>(ids.map((id, i) => [id, i + 1]));
  const sourceIds = new Set(ids);
  const broken = new Set(page.broken);
  const options: BodyOptions = {
    path: page.concept.path,
    href: (t: LinkTarget | null, _raw: string, kind: "link" | "image") => {
      if (!t) return null;
      if (t.kind !== "internal") return t.href;
      if (t.dir || t.path === "" || baseName(t.path) === "index.md") {
        return appUrl(page, t.dir || t.path === "" ? t.path : dirOf(t.path));
      }
      if (kind === "image") return page.concept.images[t.path]?.src ?? null;
      return appUrl(page, t.path, t.anchor);
    },
    image: (path) => {
      const ref = page.concept.images[path];
      if (!ref?.src) return null;
      const out: ImageSource = { src: ref.src, kind: mediaKind(ref.media) };
      if (ref.width && ref.height) {
        out.width = ref.width;
        out.height = ref.height;
      }
      if (ref.size !== undefined) out.size = ref.size;
      out.page = appUrl(page, path);
      if (out.kind === "pdf") out.download = ref.src;
      return out;
    },
    exists: (path) => !broken.has(path),
    // A chart's data file needs the library; the panel shows such a chart as its source.
    fileText: async () => null,
    footnote: (label, defined) => {
      if (!sourceIds.has(label) && !defined) return null;
      if (!numbers.has(label)) numbers.set(label, numbers.size + 1);
      const prefix = sourceIds.has(label) ? "src" : "fn";
      return { href: `#${anchorId(prefix, label)}`, mark: String(numbers.get(label)) };
    },
  };
  return { options, numbers };
}

/** The message "Ask in chat" adds to the conversation: the passage, where it is, the question. */
export function askText(page: PagePayload, quote: string, question: string): string {
  const q = quote.replace(/\s+/g, " ").trim();
  return [
    `About this passage in "${page.concept.title}" (${page.library.owner}/${page.library.slug}, ${page.concept.path}):`,
    "",
    `> ${q.length > 600 ? `${q.slice(0, 600)}…` : q}`,
    "",
    question.trim(),
  ].join("\n");
}

/**
 * What the agent is told after the person acts in the panel (`ui/update-model-context`): the
 * page, what they did and said, so its next turn knows without the person repeating it.
 */
export function actedText(
  page: PagePayload,
  act: { action: string; quote?: string | null; body?: string | null; thread?: string | null },
): string {
  const where = `"${page.concept.title}" (${page.library.owner}/${page.library.slug}, ${page.concept.path})`;
  const said = act.body?.trim() ? `: ${act.body.trim()}` : "";
  const on = act.quote ? ` on the passage "${act.quote.replace(/\s+/g, " ").trim()}"` : "";
  switch (act.action) {
    case "open":
      return `In the page panel the person commented on ${where}${on}${said}. It is a comment thread in the library; read it with \`comments\` and answer with \`comment\` when they ask you to.`;
    case "reply":
      return `In the page panel the person replied to thread ${act.thread} on ${where}${said}.`;
    case "resolve":
      return `In the page panel the person resolved thread ${act.thread} on ${where}${said}.`;
    case "reopen":
      return `In the page panel the person reopened thread ${act.thread} on ${where}${said}.`;
    default:
      return `In the page panel the person acted on ${where}.`;
  }
}

/** The message "Ask the agent to address it" sends after a comment: the thread to work on. */
export function addressText(page: PagePayload, thread: Thread): string {
  const quote = thread.anchor ? ` on "${thread.anchor.quote.replace(/\s+/g, " ").trim()}"` : "";
  const first = thread.comments[0]?.body.trim() ?? "";
  return `Please address my comment${quote} in "${page.concept.title}" (${page.concept.path}, thread ${thread.id}): ${first}`;
}

/** What the panel's actions send (`page_act`'s arguments). */
export interface ActArgs {
  grant: string;
  library: string;
  action: "open" | "reply" | "resolve" | "reopen";
  thread?: string;
  quote?: string;
  from?: number;
  body?: string;
  since?: Since;
}

/**
 * What the panel needs from its host (page-main.ts, over ext-apps' `App`), so it can be tested
 * without one. `subscribe` hands it each page a tool result brings and the host's display mode,
 * and returns how to stop.
 */
export interface PageHost {
  subscribe(on: {
    page(p: PagePayload | null): void;
    mode(m: "inline" | "fullscreen" | "pip"): void;
  }): () => void;
  /** Whether the host passes the panel's tool calls to Tempra (comments, checks, links in place). */
  canCall(): boolean;
  /** Acts as the person (`page_act`); the page as it now stands, or throws with what went wrong. */
  act(args: ActArgs): Promise<PagePayload>;
  /** Another page of the library (`show`), for a link followed in place. */
  open(path: string, library: string): Promise<PagePayload>;
  /** Whether the host takes messages from the panel. */
  canAsk(): boolean;
  /** Adds a message to the conversation as the person; false when the host refused it. */
  ask(text: string): Promise<boolean>;
  /** Tells the agent, for its next turn, what the person did here. */
  tell(text: string): Promise<void>;
  /** Opens a link in the person's browser; false when the host cannot. */
  openLink(url: string): Promise<boolean>;
  canFullscreen(): boolean;
  fullscreen(): Promise<boolean>;
}
