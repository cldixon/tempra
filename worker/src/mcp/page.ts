/**
 * The page panel (tempra-dev: app/page-panel): what MCP `show` hands the panel a host draws in the
 * chat, so the person reads a page there as the app shows it, sees its comments, and comments on
 * it or checks it in place. The panel cannot use the app's session (a host's iframe gets no
 * cookie), so everything it draws comes in the tool result: the stored tree, the page's sources,
 * its threads, who wrote it, and a short-lived signed URL per image. What it may do is carried by
 * a grant the library signs (`signPanel`), checked again by `page_act`.
 */
import type { Doc } from "@tempra/editor/doc";
import type { TokenInfo } from "../auth";
import type { LibraryClient } from "../client";
import { OkfError } from "../store/errors";
import type { ImageRef } from "../store/store";

/** How long the panel's image links and grant last: as an upload link does. */
export const PANEL_TTL_SECONDS = 3600;
/** Images signed for one page; past it the panel shows the rest as broken, with a link. */
const SIGNED_IMAGES = 60;

/** Ops that make a version of a concept (app/src/concept/data.ts CONTENT_OPS, less delete). */
const VERSION_OPS = new Set(["put", "import", "revert", "attach"]);

/** A comment thread as `comments` answers it, with its actions. */
export type PanelThread = Awaited<ReturnType<LibraryClient["comments"]>>["threads"][number];

/** What the panel is given (structuredContent.page); app/src/panels/page.ts reads it. */
export interface PagePayload {
  v: 1;
  /** The deployment: the app's links start here. */
  origin: string;
  library: { owner: string; slug: string };
  /** The page in the app, and in its review mode (the changes since the person checked it). */
  url: string;
  review: string;
  /**
   * Who is reading: their users id and handle (what they wrote reads "You"), whether the panel
   * may comment for them, and whether they may check the page (in the app: `review`).
   */
  viewer: { id: string | null; handle: string | null; comment: boolean; check: boolean };
  /** Lets the panel act as the viewer on this page (`page_act`); null when it may not. */
  grant: string | null;
  /** What the agent asks of the person, in its words, and that agent's id (`names` names it). */
  ask: string | null;
  asker: string | null;
  /** A passage the agent points at, to show first. */
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
    /** Its images by library path: what the reader needs, and a signed URL to load each. */
    images: Record<string, ImageRef & { src: string | null }>;
  };
  head: number;
  sources: { id: string; title: string | null; resource: string | null }[];
  /** Links in the body whose target is not in the library. */
  broken: string[];
  /** Who made the version shown, and when. */
  byline: { actor: string; agent: string | null; at: string } | null;
  /** The latest check by a person, and how many versions came after it. */
  checked: { actor: string; at: string; since: number; seq: number } | null;
  /** An earlier version to draw the changes against, when the agent asked for them. */
  before: { seq: number; doc: Doc; label: string } | null;
  threads: PanelThread[];
  /** Agents by id, named for whom they act ("Claude for @ann"). */
  names: Record<string, string>;
}

/** What `show` takes beyond the path. */
export interface ShowOptions {
  ask?: string;
  focus?: string;
  /** Draw the changes since: a seq, the version before this one, or the person's last check. */
  since?: number | "previous" | "checked";
  /** The agent showing it (its id), named beside its ask. */
  asker?: string | null;
}

interface HistoryRow {
  seq: number;
  ts: string;
  actor: string;
  op: string;
  meta: Record<string, unknown> | null;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The agent id in an event's `by`, when it has one. */
function agentOf(meta: HistoryRow["meta"]): string | null {
  const by = meta?.by as { agent?: unknown } | undefined;
  return typeof by?.agent === "string" ? by.agent : null;
}

/**
 * The page panel's payload for one concept at head. Throws `not_concept` for anything else; the
 * caller has checked the token may read the library.
 */
export async function pagePayload(
  lib: LibraryClient,
  token: TokenInfo,
  origin: string,
  path: string,
  opts: ShowOptions,
  /** The person the connection acts for (users id), whom the panel's grant is for. */
  person: string | null,
  names?: (ids: string[]) => Promise<Map<string, string>>,
): Promise<PagePayload> {
  const page = await lib.page(path);
  const file = page.file;
  if (file.kind !== "concept" || !("sources" in page)) {
    throw new OkfError(
      400,
      "not_concept",
      "`show` draws a page (a concept). For an attachment, `read` it, or link to it.",
    );
  }
  const fm = file.frontmatter;
  const events = (page.history as { events: HistoryRow[] }).events;
  const versions = events.filter((e) => VERSION_OPS.has(e.op) && e.seq <= file.seq);
  const current = versions.at(-1) ?? null;
  const check = [...events]
    .reverse()
    .find((e) => e.op === "verify" && e.actor.startsWith("human:") && e.seq <= file.seq);

  // Images: one signed link each, so the panel loads them from this deployment with no cookie.
  const images: PagePayload["concept"]["images"] = {};
  let signed = 0;
  for (const [p, ref] of Object.entries(file.images ?? {})) {
    let src: string | null = null;
    if (signed < SIGNED_IMAGES) {
      signed++;
      const t = await lib.signDownload(
        { k: "file", path: p, hash: ref.hash, media: ref.media ?? null },
        PANEL_TTL_SECONDS,
      );
      src = `${origin}/dl/${encodeURIComponent(token.library.do_id)}/${t}`;
    }
    images[p] = { ...ref, src };
  }

  // The version to draw the changes against.
  let before: PagePayload["before"] = null;
  const base =
    opts.since === "previous"
      ? (versions.at(-2)?.seq ?? null)
      : opts.since === "checked"
        ? (check?.seq ?? null)
        : typeof opts.since === "number" && opts.since < file.seq
          ? opts.since
          : null;
  if (base !== null) {
    const old = await lib.read(file.path, { at: base }).catch(() => null);
    if (old?.kind === "concept") {
      const n = versions.filter((v) => v.seq <= base).length;
      before = {
        seq: base,
        doc: old.doc,
        label:
          opts.since === "checked" ? "since you checked it" : n > 0 ? `since v${n}` : "since then",
      };
    }
  }

  const threads = (await lib.comments({ path: file.path, status: "all", limit: 100 })).threads;
  const ids = new Set<string>();
  const byAgent = (m: unknown) => {
    const a = (m as { agent?: unknown } | undefined)?.agent;
    if (typeof a === "string") ids.add(a);
  };
  for (const t of threads) for (const a of t.actions) byAgent(a.by);
  for (const c of threads.flatMap((t) => t.comments)) byAgent(c.by);
  const agent = current ? agentOf(current.meta) : null;
  if (agent) ids.add(agent);
  if (opts.asker) ids.add(opts.asker);
  const named = ids.size > 0 && names ? await names([...ids]).catch(() => new Map()) : new Map();

  const writable = token.scope === "write";
  const canAct = person !== null;
  const sources = (page.sources as { sources: Record<string, unknown>[] }).sources.flatMap((s) =>
    typeof s.id === "string"
      ? [{ id: s.id, title: str(s.title), resource: str(s.resource) ?? str(s.url) }]
      : [],
  );
  const { owner, slug } = token.library;
  const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
  const url = `${origin}/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/${enc(file.path)}`;
  return {
    v: 1,
    origin,
    library: { owner, slug },
    url,
    review: `${url}?review=1`,
    viewer: { id: person, handle: token.person ?? null, comment: canAct, check: writable },
    grant: canAct
      ? await lib.signPanel({ k: "panel", path: file.path, person }, PANEL_TTL_SECONDS)
      : null,
    ask: str(opts.ask),
    asker: opts.asker ?? null,
    focus: str(opts.focus),
    concept: {
      path: file.path,
      seq: file.seq,
      hash: file.hash,
      title: str(fm.title) ?? file.path.split("/").pop() ?? file.path,
      description: str(fm.description),
      status: str(fm.status),
      type: str(fm.type),
      stale: file.stale,
      doc: file.doc,
      images,
    },
    head: page.head,
    sources,
    broken: (page.links as { broken: { path: string }[] }).broken.map((b) => b.path),
    byline: current ? { actor: current.actor, agent, at: current.ts } : null,
    checked: check
      ? {
          actor: check.actor,
          at: check.ts,
          seq: check.seq,
          since: versions.filter((v) => v.seq > check.seq).length,
        }
      : null,
    before,
    threads,
    names: Object.fromEntries(named),
  };
}

/** The line the model reads about what the person was shown (the panel's data stays out of it). */
export function shownText(p: PagePayload, panel: boolean): string {
  const open = p.threads.filter((t) => t.status === "open").length;
  return [
    `Showing "${p.concept.title}" (${p.concept.path}, seq ${p.concept.seq}) to the person${panel ? " in a page panel in the chat" : ""}, with ${open} open comment thread${open === 1 ? "" : "s"}${p.before ? ` and the changes ${p.before.label}` : ""}.`,
    `In the panel they can read it, comment on it (their words, recorded as typed by them in the chat), or select a passage and ask you about it in the chat${p.viewer.check ? "; to mark it as checked they open it in Tempra" : ""}. When they comment, you are told in the chat's context; read new threads with \`comments\` and answer them with \`comment\`.`,
    `If the panel does not show, give them the link: ${p.url}`,
  ].join("\n");
}
