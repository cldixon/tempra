import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { TokenInfo } from "../auth";
import {
  type BlobStore,
  figuresWithDimensions,
  type LibraryClient,
  mediaFor,
  putBlob,
  withDimensions,
} from "../client";
import { type FetchFn, fetchBlob, selfHosts } from "../fetch-source";
import {
  IMAGE_BYTES_PER_CALL,
  IMAGES_PER_CALL,
  type Images,
  imagesService,
  RASTER_MEDIA,
  readBytes,
  toBase64,
} from "../images";
import { imageInfo } from "../media";
import { diagramTypeOf } from "../okf/diagrams";
import { type FigureFact, figureLine, sizeText } from "../okf/figures";
import { normalizePath, underPrefix } from "../okf/paths";
import type { LintWarning } from "../okf/types";
import {
  MAX_RENDER_SOURCE,
  RENDER_UNAVAILABLE,
  RENDER_WIDTH,
  type RenderError,
  type RenderRequest,
  type RenderResult,
} from "../render";
import type { CommentAction, CommentResult } from "../store/comments";
import { OkfError } from "../store/errors";
import {
  checkDescription,
  type LibraryHealth,
  type RequestContext,
  type WriteOp,
  type WriteResult,
} from "../store/store";
import { requireOwner } from "../tenancy";
import { checkBytes, checkDeclared, decodeBase64, prepareUpload } from "../uploads";

export interface McpContext {
  /** The ledger actor, access and tool tier: the same in every library the caller reaches. */
  actor: string;
  scope: "read" | "write";
  tiers: string;
  /** The libraries the caller reaches now, each as the token it acts with there. */
  libraries: TokenInfo[];
  /** The person and agent behind the actor, for the ledger (TEMPRA-75). */
  by?: RequestContext["by"];
  open(token: TokenInfo): LibraryClient;
  /**
   * Posts a comment action and notifies whom it addresses (notify.ts: mentions, the inbox);
   * without it, the library records the comment and nobody is told.
   */
  comment?(token: TokenInfo, req: RequestContext, action: CommentAction): Promise<CommentResult>;
  /**
   * Names agents by id for whom they act ("Claude for @ann", TEMPRA-77); unknown ids are left
   * out. Without it, transcripts show the raw actor.
   */
  agentNames?(ids: string[]): Promise<Map<string, string>>;
  /**
   * Creates a library owned by the connection's person and returns the token the connection acts
   * with there (tenancy.ts createLibraryForGrant: it refuses connections without "Create
   * libraries"). Absent for bearer tokens, which reach one library and never create one.
   */
  createLibrary?(input: {
    slug: string;
    title?: string;
    description?: string;
  }): Promise<{ token: TokenInfo; title: string | null; description: string | null }>;
  /** A library's title and description as its creator gave them, for `start`. */
  about?(libraryId: string): Promise<{ title: string | null; description: string | null } | null>;
  blobs: BlobStore;
  /** Attachment images scaled for the model (images.ts); without it, small originals only. */
  images?: Images;
  /**
   * Meters what a call costs beyond a request: an image sent (`read_image`), a file fetched from
   * a URL (`fetch`, TEMPRA-157).
   */
  meter?(e: { kind: "read_image" | "fetch"; library: string; bytes: number }): void;
  /** Outbound fetch for `attach` with `source_url` (fetch-source.ts); tests pass a double. */
  fetch?: FetchFn;
  /**
   * Draws a Mermaid source on the render Worker (render.ts, TEMPRA-165), counted against the
   * caller's account; without it, `render` and `read`'s diagrams say the service is unavailable.
   */
  render?(req: RenderRequest, library?: string): Promise<RenderResult>;
  /** One render against the account's per-minute cap (RENDERS_PER_MINUTE); false when over it. */
  allowRender?(): Promise<boolean>;
  /** The Worker's origin, for download URLs. */
  origin: string;
}

/** Name the MCP server reports; provisional until the product is named (spec: Open questions). */
export const SERVER_NAME = "tempra";
/** Resource URI scheme; provisional for the same reason. */
export const URI_SCHEME = "okf";

const BEYOND = "Beyond files: ";

/** Compressed workflow guidance, sent as the server's instructions (most clients never load a skill). */
export const INSTRUCTIONS = `This server holds OKF (Open Knowledge Format) libraries: each a tree of markdown concepts with YAML frontmatter, plus attachments. Every change is attributed to your actor and recorded in the library's ledger.

How to work:
1. Call \`start\` first. It opens your library, or lists the libraries you can reach when there are several; then pass \`library\` (owner/slug) on every call. When the person asks for a new library, \`create_library\` makes one they own and opens it (only on a connection they allowed to). Then \`browse\` a directory before reading, follow links, and \`read\` what you need. Check frontmatter (type, status, trust tier, stale) before relying on a body. \`read\` lists a concept's figures; ask for their images with \`images: true\` (or \`figures: [n]\`) when you review a page, change a figure or its caption, or answer a comment on one.
2. Write conformant concepts: a non-empty \`type\` naming what kind of thing it is (Metric, Protocol, Decision; never a generic word like concept, page or note, and reuse the types \`start\` lists), a \`title\` and one-line \`description\`, absolute links like [x](/dir/x.md), footnotes [^id] keyed to \`sources[].id\`, diagrams as Mermaid in a \`mermaid\` fence (drawn in the app; an unknown type, an empty body or an unclosed bracket or quote comes back as \`diagram_invalid\` lint, and \`diagram_unrendered\` lint means Pele could not draw the fence; fix either), one idea per concept. Preview a non-trivial diagram with \`render\` before writing it, and \`read\` with \`diagrams: true\` to see a page's diagrams drawn.
   Figures: a plain image is \`![alt](/path "caption")\`; for a width, a placement or a group, wrap one to four images in \`:::figure[group caption]{width=480|60% layout=column|wide|full frame}\` and a closing \`:::\` line (markup that does not parse comes back as \`figure_invalid\` lint).
3. Prefer \`edit\` for small changes, \`write\` for new concepts or rewrites, \`batch\` for related changes so they land as one request. Pass \`if_match\` (the hash from your last read); on a conflict, re-read and reapply. Bodies are stored in a canonical form (\`-\` bullets, \`*\` emphasis, padded tables): what you write reads back normalized, so \`edit\` the text as \`read\` shows it. To add a file (an image, a PDF): an image on the public web, \`attach\` with \`source_url\` (the server fetches it and records where from; still cite the original in \`sources\`, and never hotlink it); a file you made, with a shell, \`prepare_upload\` and run the curl line it returns; without one, \`attach\` small files (under about 200 KB) as base64 with their \`sha256\`.
4. Put a one-line \`note\` on every write. Read the \`lint\` in every write result and fix what it reports; the result's notes say what else to know (ignored fields, the stored form, open comments). A concept with no frontmatter, invalid YAML or no \`type\` is refused. Figures come back as lint, never refused: \`image_no_alt\` (say what the image shows in its alt text), \`image_external\` (hotlinked; bring it in with \`attach\` and \`source_url\`, cite the original in \`sources\`), \`image_large\` (over 2 MB or 4000 px; attach a smaller one), \`image_not_image\` (\`![…](x)\` on a file that is not an image, video, audio or PDF). Keep concepts under 100 KB; split big ones into linked concepts.
5. Never write index.md or log.md (the server synthesizes them). Never set \`generated\` (the server stamps it) or \`verified\` (not yours to claim). Set \`status\` and \`stale_after\` honestly. Timestamps are full ISO 8601 datetimes with an offset (\`stale_after: 2026-12-31T00:00:00Z\`); a plain date is flagged.
6. Use \`work\` to find what needs doing: open comments, stale concepts, broken links, lint, and structure (a directory's index.md made poor by its concepts: missing, long or title-repeating descriptions, duplicate titles, concepts nothing links to, a directory with one concept, none, or too many); \`work\` with kind stale_soon lists what goes stale within 14 days. Only a new \`stale_after\` resets a concept's clock; other edits leave it stale.
7. Comments are how people ask you for changes. Before editing a concept, read its open threads with \`comments\`; make the change a comment asks for, then answer it with \`comment\` (reply, and resolve what you fixed). Ask with a reply when unsure; never resolve a thread you did not address. A concept with open threads cannot be deleted until they are resolved.`;

const text = (t: string): CallToolResult => ({ content: [{ type: "text", text: t }] });
const line = (t: string) => ({ type: "text" as const, text: t });

/** SVG text `read` returns as is (models read it well enough until TEMPRA-165 rasterizes it). */
const SVG_TEXT_BYTES = 100 * 1024;
/** Files an `okf://` resource carries as bytes (TEMPRA-155); above it, the download link. */
const RESOURCE_BYTES = 2 * 1024 * 1024;

export { RENDER_WIDTH };
/**
 * Renders per account a minute (tempra-dev: app/media, Limits): the `render` rate limit, counted
 * on WRITE_LIMITER under its own key (`render:<account>`), whose limit is the same 60.
 */
export const RENDERS_PER_MINUTE = 60;

/** Pele's error as one line, with its place and the source line it names. */
export function renderErrorText(e: RenderError, source?: string): string {
  const at = e.line > 0 ? ` (line ${e.line}${e.column > 0 ? `, column ${e.column}` : ""})` : "";
  const src = e.line > 0 ? source?.split("\n")[e.line - 1] : undefined;
  return `${e.message}${at}${src !== undefined ? `\n  ${e.line} | ${src}` : ""}`;
}

/** What one drawing of a diagram for a model came to. */
type Drawn =
  | { kind: "image"; bytes: Uint8Array; media: string; width: number; height: number }
  /** The PNG could not be drawn or sent: the SVG instead, with why. */
  | { kind: "svg"; svg: string; why: string }
  /** Pele refused the source. */
  | { kind: "refused"; error: RenderError }
  /** Nothing drawn: the service is unavailable or the account is over its cap. */
  | { kind: "unavailable"; why: string };

/**
 * The library's health summary for `start` (TEMPRA-66): the daily check's counts by kind, and
 * the newest changes nobody has verified since. Kinds with nothing open are left out.
 */
export function healthLines(h: LibraryHealth): string[] {
  const names: [keyof LibraryHealth["counts"], string][] = [
    ["stale", "stale"],
    ["stale_soon", "stale soon"],
    ["broken_link", "broken links"],
    ["lint", "lint"],
    ["structure", "structure"],
    ["comment", "open comments"],
  ];
  const counts = names
    .filter(([k]) => h.counts[k] > 0)
    .map(([k, label]) => `${label} ${h.counts[k]}`)
    .join(" · ");
  const newest = h.unverified.newest
    .slice(0, 3)
    .map((c) => `${c.path} (${c.actor}, ${c.ts})`)
    .join(", ");
  return [
    `Health (checked ${h.at}): ${counts || "nothing open"}`,
    ...(h.unverified.total > 0
      ? [
          `Unverified: ${h.unverified.total} concept${h.unverified.total === 1 ? "" : "s"} changed since anyone last verified them; newest ${newest}`,
        ]
      : []),
  ];
}

function errorResult(e: unknown): CallToolResult {
  if (!(e instanceof OkfError)) throw e;
  const lines = [`Error ${e.status} ${e.code}: ${e.message}`];
  if (e.extra.current_hash !== undefined) {
    lines.push(`current_hash: ${e.extra.current_hash ?? "(none: the path does not exist)"}`);
  }
  if (typeof e.extra.current === "string") {
    lines.push("", "Current document:", "", e.extra.current);
  }
  if (e.status === 412)
    lines.push("", "Re-read the file, reapply your change, and pass the new hash as if_match.");
  if (e.code === "exists")
    lines.push(
      "",
      "To replace it, pass current_hash as if_match; to keep both, pick another path.",
    );
  return { isError: true, content: [{ type: "text", text: lines.join("\n") }] };
}

function lintText(lint: LintWarning[]): string {
  if (lint.length === 0) return "Lint: none.";
  return ["Lint (fix these):", ...lint.map((l) => `- ${l.code}: ${l.message}`)].join("\n");
}

function writeText(verb: string, res: WriteResult): string {
  const lines = res.results.map((r) => {
    const what = r.from ? `${r.from} → ${r.path}` : r.path;
    if (r.hash === null) return `${verb} ${what} (${r.op}, seq ${r.seq}).`;
    return `${verb} ${what} (${r.op}, seq ${r.seq}): hash ${r.hash}`;
  });
  const seqs = res.results.map((r) => r.seq);
  const range =
    res.results.length > 1
      ? ` (${res.results.length} files, seq ${Math.min(...seqs)}–${Math.max(...seqs)})`
      : "";
  const lint = res.results.flatMap((r) =>
    r.lint.map((l) => ({ ...l, message: `${r.path}: ${l.message}` })),
  );
  const notices = res.results.flatMap((r) =>
    (r.notices ?? []).map((l) => `- ${l.code}: ${r.path}: ${l.message}`),
  );
  const diffs = res.results.flatMap((r) =>
    r.normalized
      ? ["", `Stored form of ${r.path} (diff from what you sent):`, "", r.normalized.trimEnd()]
      : [],
  );
  return [
    ...lines,
    `Request ${res.request_id}${range}.`,
    lintText(lint),
    ...(notices.length > 0 ? ["Notes:", ...notices] : []),
    ...diffs,
  ].join("\n");
}

const json = (v: unknown) => JSON.stringify(v, null, 2);

const EditSchema = z.object({
  old: z.string().describe("Text to find; must occur exactly once in the rendered document."),
  new: z.string().describe("Replacement text."),
});

const BatchOpSchema = z.object({
  op: z.enum(["write", "edit", "move", "delete"]),
  path: z.string(),
  content: z.string().optional().describe("write: the full OKF markdown."),
  edits: z.array(EditSchema).optional().describe("edit: find-and-replace pairs."),
  to: z.string().optional().describe("move: the destination path."),
  if_match: z.string().optional().describe("write (replace), edit, delete: the current hash."),
});

const LIBRARY_ARG =
  "The library, as owner/slug from `start` (a bare slug works when it is unique). Needed only when you can reach more than one.";

const libraryList = (libs: TokenInfo[]) =>
  libs.map((t) => `${t.library.owner}/${t.library.slug}`).join(", ");

export function buildServer(ctx: McpContext): McpServer {
  const tier2 = ctx.tiers !== "files";
  const libArg = { library: z.string().optional().describe(LIBRARY_ARG) };
  const server = new McpServer(
    { name: SERVER_NAME, version: "0.2.0" },
    { instructions: INSTRUCTIONS, capabilities: { tools: {}, resources: {} } },
  );

  /** The library a call names, or the only one there is. */
  const pick = (name?: string): { token: TokenInfo; lib: LibraryClient } => {
    const libs = ctx.libraries;
    if (libs.length === 0) {
      throw new OkfError(
        404,
        "no_library",
        `This connection reaches no libraries yet. Create one with \`create_library\` if the person asks for one (and allowed it at consent), or at ${ctx.origin}/, or reconnect and choose one.`,
      );
    }
    const want = (name ?? "")
      .trim()
      .replace(/^\/+|\/+$/g, "")
      .toLowerCase();
    if (want === "" && libs.length > 1) {
      throw new OkfError(
        400,
        "library_required",
        `You can reach ${libs.length} libraries; pass library, one of: ${libraryList(libs)}.`,
      );
    }
    const bySlug = libs.filter((t) => t.library.slug === want);
    const found =
      want === ""
        ? libs[0]
        : want.includes("/")
          ? libs.find((t) => `${t.library.owner}/${t.library.slug}` === want)
          : bySlug.length === 1
            ? bySlug[0]
            : undefined;
    if (!found) {
      throw new OkfError(
        404,
        "no_library",
        `There is no library ${name} here; you can reach: ${libraryList(libs)}.`,
      );
    }
    return { token: found, lib: ctx.open(found) };
  };

  const request = (note?: string): RequestContext => ({
    actor: ctx.actor,
    request_id: crypto.randomUUID(),
    note: note ?? null,
    by: ctx.by ?? null,
  });

  /** A comment action, told to the people it addresses where the Worker wires that. */
  const post = (token: TokenInfo, lib: LibraryClient, action: CommentAction) =>
    ctx.comment ? ctx.comment(token, request(), action) : lib.comment(request(), action);

  const checkWrite = (token: TokenInfo, ...paths: string[]) => {
    if (token.scope !== "write") {
      throw new OkfError(
        403,
        "read_only",
        "You have read access here: you can read and comment, not change content.",
      );
    }
    checkPrefix(token, paths);
  };

  /** Comments are their own permission (tempra-dev: v2/sharing): read access may comment. */
  const checkComment = (token: TokenInfo, path: string) => checkPrefix(token, [path]);

  const checkPrefix = (token: TokenInfo, paths: string[]) => {
    if (token.prefix === null) return;
    for (const p of paths) {
      if (!underPrefix(normalizePath(p) ?? "", token.prefix)) {
        throw new OkfError(
          403,
          "outside_prefix",
          `This token may only write under ${token.prefix}/.`,
        );
      }
    }
  };

  const guarded =
    <A>(fn: (args: A) => Promise<CallToolResult>) =>
    async (args: A): Promise<CallToolResult> => {
      try {
        return await fn(args);
      } catch (e) {
        return errorResult(e);
      }
    };

  const downloadUrl = async (
    { token, lib }: ReturnType<typeof pick>,
    payload: Parameters<LibraryClient["signDownload"]>[0],
  ) =>
    `${ctx.origin}/dl/${encodeURIComponent(token.library.do_id)}/${await lib.signDownload(payload)}`;

  const images = ctx.images ?? imagesService({ blobs: ctx.blobs });

  /** What `read` adds for an image attachment (TEMPRA-153): the image itself, or why not. */
  const shown = async (
    token: TokenInfo,
    blob: { hash: string; size: number; media: string | null },
  ): Promise<CallToolResult["content"]> => {
    if (blob.media === "image/svg+xml") {
      if (blob.size > SVG_TEXT_BYTES) {
        return [
          line(`SVG too large to show here (over ${SVG_TEXT_BYTES / 1024} KB); download it.`),
        ];
      }
      const obj = await ctx.blobs.get(blob.hash);
      if (!obj) return [];
      return [line(`SVG source:\n${new TextDecoder().decode(await readBytes(obj.body))}`)];
    }
    if (!blob.media || !RASTER_MEDIA.has(blob.media)) return [];
    const img = await images.forModel(blob);
    if ("missing" in img) return [];
    if ("tooLarge" in img) {
      return [line("Image too large to show here; download it from the URL above.")];
    }
    ctx.meter?.({ kind: "read_image", library: token.library.id, bytes: img.bytes.byteLength });
    return [{ type: "image", data: toBase64(img.bytes), mimeType: img.media }];
  };

  /**
   * A diagram drawn for a model (TEMPRA-166): the render Worker's PNG (its cache makes a fence
   * that did not change cost one R2 read), sized like an image for a model; the SVG when the PNG
   * cannot be drawn (Browser Rendering not enabled, a timeout) or sent; Pele's error; or why
   * nothing was drawn. Each call counts once against the account's render cap.
   */
  const draw = async (
    source: string,
    theme: "light" | "dark",
    library?: string,
  ): Promise<Drawn> => {
    const unavailable = (message = RENDER_UNAVAILABLE): Drawn => ({
      kind: "unavailable",
      why: `the render service is unavailable${message.slice(RENDER_UNAVAILABLE.length)}`,
    });
    if (!ctx.render) return unavailable();
    if (source.length > MAX_RENDER_SOURCE) {
      return {
        kind: "refused",
        error: {
          message: `The diagram is longer than the limit of ${MAX_RENDER_SOURCE} characters.`,
          line: 0,
          column: 0,
        },
      };
    }
    if (ctx.allowRender && !(await ctx.allowRender())) {
      return {
        kind: "unavailable",
        why: `over the limit of ${RENDERS_PER_MINUTE} renders a minute for this account; try again in a minute`,
      };
    }
    const r = await ctx.render({ source, theme, width: RENDER_WIDTH, png: true }, library);
    if (r.png) {
      const img = await images.fitForModel(r.png, "image/png");
      if ("bytes" in img) {
        const info = imageInfo(img.bytes);
        return {
          kind: "image",
          bytes: img.bytes,
          media: img.media,
          width: info?.ok ? info.width : 0,
          height: info?.ok ? info.height : 0,
        };
      }
      if (r.svg) return { kind: "svg", svg: r.svg, why: "the PNG is too large to send" };
    }
    if (r.svg) {
      return {
        kind: "svg",
        svg: r.svg,
        why: r.error ? r.error.message : "the render service drew no PNG",
      };
    }
    const error = r.error ?? { message: "Nothing was drawn.", line: 0, column: 0 };
    if (error.message.startsWith(RENDER_UNAVAILABLE)) return unavailable(error.message);
    return { kind: "refused", error };
  };

  const readOnly = { readOnlyHint: true, openWorldHint: false };
  const writes = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

  // ------------------------------------------------------------------ tier 1: file-equivalent

  const you = () =>
    `You are ${ctx.actor} (${ctx.scope}${ctx.libraries[0]?.prefix ? `, under ${ctx.libraries[0].prefix}/` : ""}). Tools: ${tier2 ? "file tools and beyond-files tools" : "file tools only"}.`;

  /** What `start` shows for one library, and `create_library` for the one it made. */
  const opening = async (token: TokenInfo, lib: LibraryClient): Promise<string> => {
    const [summary, root, about] = await Promise.all([
      lib.summary(),
      lib.read("index.md"),
      ctx.about ? ctx.about(token.library.id).catch(() => null) : null,
    ]);
    const types = Object.entries(summary.types)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${t} ${n}`)
      .join(", ");
    const empty = summary.concepts + summary.attachments === 0;
    const others = ctx.libraries.filter((t) => t !== token);
    const lines = [
      `# Library ${token.library.owner}/${token.library.slug} (seq ${summary.seq})`,
      "",
      ...(about?.title ? [`Title: ${about.title}`] : []),
      ...(about?.description ? [`Description: ${about.description}`] : []),
      `Concepts: ${summary.concepts} · attachments: ${summary.attachments} · open work items: ${summary.open_work} (${summary.open_comments} of them comment threads)${summary.stale_soon > 0 ? ` · stale soon: ${summary.stale_soon} (\`work\` kind stale_soon)` : ""}`,
      ...healthLines(summary.health),
      `Types: ${types || "none yet"}`,
      you(),
      ...(others.length > 0
        ? [`Other libraries you can reach: ${libraryList(others)}. Pass \`library\` on every call.`]
        : []),
      "",
      "## Root index.md",
      "",
      empty
        ? "(The library is empty. Start by writing a concept; `write` describes the format.)"
        : root.kind === "derived"
          ? root.markdown.trimEnd()
          : "",
      "",
      "## How to work here",
      "",
      "- `browse` a directory before reading; follow links; check frontmatter (type, status, trust, stale) before relying on a body.",
      "- `edit` for small changes, `write` for new concepts or rewrites, `batch` for related changes. Pass `if_match` from your last read; on a 412, re-read and reapply.",
      "- A one-line `note` on every write. Fix the `lint` each write returns. Never write index.md or log.md, and never set generated or verified.",
      "- A concept needs frontmatter with a `type`, or the write is refused. A concept with open comment threads cannot be deleted until they are resolved.",
    ];
    if (tier2) {
      lines.push(
        "- `work` lists open comments, stale concepts, broken links and lint to fix; `log` shows what others changed recently.",
        "- Comments are requests from people: read a concept's open threads (`comments`) before editing it, then reply and resolve with `comment`.",
      );
    }
    return lines.join("\n");
  };

  server.registerTool(
    "start",
    {
      title: "Start here",
      description:
        "Call this first in every session. Opens a library: its root index.md (what is here, one level down), counts by concept type, the number of open work items, the daily health check (open work by kind, the newest unverified changes), and how to work in it. When you can reach several libraries and pass no `library`, lists them instead.",
      inputSchema: libArg,
      annotations: readOnly,
    },
    guarded(async ({ library }) => {
      if (!library && ctx.libraries.length !== 1) {
        if (ctx.libraries.length === 0) pick();
        return text(
          [
            `# Your libraries (${ctx.libraries.length})`,
            "",
            you(),
            "",
            ...ctx.libraries.map((t) => `- ${t.library.owner}/${t.library.slug}`),
            "",
            "Call `start` with `library` to open one, and pass the same `library` on every other call.",
          ].join("\n"),
        );
      }
      const { token, lib } = pick(library);
      return text(await opening(token, lib));
    }),
  );

  server.registerTool(
    "create_library",
    {
      title: "Create a library",
      description:
        "Creates a new library owned by the person you act for, exactly as if they made it in the app, and opens it as `start` does; then pass its owner/slug as `library` on every call. Only when the person asks for a new library. Needs a read-and-write connection the person allowed to create libraries at consent; it counts against their library limit. You cannot invite members, share, transfer or delete it: the person does that in the app.",
      inputSchema: {
        slug: z
          .string()
          .describe(
            "The library's name in its URL: lowercase letters, digits and hyphens, up to 63 characters, e.g. `recipes`. Its owner is always the person you act for.",
          ),
        title: z
          .string()
          .optional()
          .describe("Optional: what the library is called, one line (up to 120 characters)."),
        description: z
          .string()
          .optional()
          .describe("Optional: what the library is for, one line (up to 300 characters)."),
      },
      annotations: writes,
    },
    guarded(async ({ slug, title, description }) => {
      if (!ctx.createLibrary) {
        throw new OkfError(
          403,
          "create_not_allowed",
          `This token reaches one library and cannot create libraries. The person can create one at ${ctx.origin}/, or connect an app over OAuth and allow Create libraries.`,
        );
      }
      const made = await ctx.createLibrary({ slug, title, description });
      // Later calls in this request reach it too; later requests resolve it from the grant.
      ctx.libraries = [...ctx.libraries, made.token];
      const { token, lib } = pick(`${made.token.library.owner}/${made.token.library.slug}`);
      return text(
        [
          `Created library ${token.library.owner}/${token.library.slug}, owned by @${token.library.owner}. Pass library: "${token.library.owner}/${token.library.slug}" on every call.`,
          "",
          await opening(token, lib),
        ].join("\n"),
      );
    }),
  );

  server.registerTool(
    "browse",
    {
      title: "Browse a directory",
      description:
        "One directory level, like `ls` plus `cat index.md`: subdirectories with concept counts, and concepts with their titles and descriptions. The index is synthesized by the server from the concepts' frontmatter. Omit `dir` for the root.",
      inputSchema: {
        dir: z.string().optional().describe("Directory path, e.g. `tables`. Omit for the root."),
        ...libArg,
      },
      annotations: readOnly,
    },
    guarded(async ({ dir, library }) => {
      const { lib } = pick(library);
      const d = normalizePath(dir ?? "") ?? "";
      const view = await lib.read(d ? `${d}/index.md` : "index.md");
      return text(view.kind === "derived" ? view.markdown : "");
    }),
  );

  /**
   * The figures `read` of a concept sends as images: internal raster images (TEMPRA-154) and
   * drawn diagrams (TEMPRA-166), each after a line naming it, within IMAGES_PER_CALL and
   * IMAGE_BYTES_PER_CALL together; then what was left out and why. `want` is every image, every
   * diagram, or figures by number (either kind). External images are never fetched.
   */
  const figureImages = async (
    token: TokenInfo,
    figures: FigureFact[],
    want: { images: boolean; diagrams: boolean } | number[],
  ): Promise<CallToolResult["content"]> => {
    const left = new Map<number, string>();
    const asked: FigureFact[] = [];
    if (!Array.isArray(want)) {
      asked.push(...figures.filter((f) => (f.kind === "diagram" ? want.diagrams : want.images)));
    } else {
      for (const n of [...new Set(want)].sort((a, b) => a - b)) {
        const f = figures[n - 1];
        if (f) asked.push(f);
        else left.set(n, `no such figure (this page has ${figures.length})`);
      }
    }
    const candidates: FigureFact[] = [];
    for (const f of asked) {
      if (f.kind === "diagram") {
        if (f.lang !== "mermaid") left.set(f.n, `not a Mermaid diagram (${f.lang})`);
        else candidates.push(f);
      } else if (f.status === "external") {
        left.set(f.n, "external images are not fetched (TEMPRA-163)");
      } else if (f.status === "missing" || !f.blob) {
        left.set(f.n, `missing: no attachment at ${f.path !== null ? `/${f.path}` : f.url}`);
      } else if (f.blob.media === "image/svg+xml") {
        left.set(f.n, `SVG is not sent as an image yet; \`read\` /${f.path} for its source`);
      } else if (!f.blob.media || !RASTER_MEDIA.has(f.blob.media)) {
        left.set(f.n, `not an image (${f.blob.media ?? "unknown type"})`);
      } else candidates.push(f);
    }
    for (const f of candidates.slice(IMAGES_PER_CALL)) {
      left.set(f.n, `over the cap of ${IMAGES_PER_CALL} images a call; ask with figures: [${f.n}]`);
    }
    type Got =
      | { f: FigureFact & { kind: "image" }; img: Awaited<ReturnType<Images["forModel"]>> }
      | { f: FigureFact & { kind: "diagram" }; drawn: Drawn };
    const fetched = await Promise.all(
      candidates
        .slice(0, IMAGES_PER_CALL)
        .map(
          async (f): Promise<Got> =>
            f.kind === "diagram"
              ? { f, drawn: await draw(f.source, "light", token.library.id) }
              : { f, img: await images.forModel(f.blob as NonNullable<typeof f.blob>) },
        ),
    );
    const out: CallToolResult["content"] = [];
    let bytes = 0;
    const overBytes = (n: number) =>
      `over the cap of ${sizeText(IMAGE_BYTES_PER_CALL)} of images a call; ask with figures: [${n}]`;
    for (const got of fetched) {
      if ("drawn" in got) {
        const { f, drawn } = got;
        const name = `Figure ${f.n}: ${f.title || `diagram (${f.type ?? f.lang})`}`;
        if (drawn.kind === "refused") {
          left.set(f.n, `Pele could not draw it: ${renderErrorText(drawn.error, f.source)}`);
        } else if (drawn.kind === "unavailable") {
          left.set(f.n, `not drawn: ${drawn.why}`);
        } else if (drawn.kind === "svg") {
          const svgBytes = new TextEncoder().encode(drawn.svg).byteLength;
          if (svgBytes > SVG_TEXT_BYTES) {
            left.set(
              f.n,
              `not drawn as a PNG (${drawn.why}), and its SVG is over ${sizeText(SVG_TEXT_BYTES)}`,
            );
          } else if (bytes + svgBytes > IMAGE_BYTES_PER_CALL) left.set(f.n, overBytes(f.n));
          else {
            bytes += svgBytes;
            out.push(line(`${name} (as SVG: ${drawn.why})\n${drawn.svg}`));
          }
        } else if (bytes + drawn.bytes.byteLength > IMAGE_BYTES_PER_CALL) {
          left.set(f.n, overBytes(f.n));
        } else {
          bytes += drawn.bytes.byteLength;
          ctx.meter?.({
            kind: "read_image",
            library: token.library.id,
            bytes: drawn.bytes.byteLength,
          });
          out.push(line(name));
          out.push({ type: "image", data: toBase64(drawn.bytes), mimeType: drawn.media });
        }
        continue;
      }
      const { f, img } = got;
      if ("missing" in img) {
        left.set(f.n, `its bytes are missing (/${f.path})`);
        continue;
      }
      if ("tooLarge" in img) {
        left.set(
          f.n,
          `too large to send (${sizeText(img.size)}); \`read\` /${f.path} for a download URL`,
        );
        continue;
      }
      if (bytes + img.bytes.byteLength > IMAGE_BYTES_PER_CALL) {
        left.set(f.n, overBytes(f.n));
        continue;
      }
      bytes += img.bytes.byteLength;
      ctx.meter?.({ kind: "read_image", library: token.library.id, bytes: img.bytes.byteLength });
      out.push(line(`Figure ${f.n}: ${f.title || f.alt || `/${f.path}`}`));
      out.push({ type: "image", data: toBase64(img.bytes), mimeType: img.media });
    }
    if (left.size > 0) {
      const lines = [...left].sort(([a], [b]) => a - b).map(([n, why]) => `Figure ${n}: ${why}`);
      out.push(line(["Not shown:", ...lines].join("\n")));
    }
    return out;
  };

  const readSchema = {
    path: z
      .string()
      .describe("Concept or file path, e.g. `tables/orders.md` (the .md is optional)."),
    image: z
      .boolean()
      .optional()
      .describe("For an image attachment: false returns only its facts, without the image itself."),
    images: z
      .boolean()
      .optional()
      .describe(
        `For a concept: true adds its figures' images after the markdown (at most ${IMAGES_PER_CALL}).`,
      ),
    diagrams: z
      .boolean()
      .optional()
      .describe(
        "For a concept: true adds its Mermaid diagrams drawn as images, as people see them, after the markdown (sharing the cap with `images`).",
      ),
    figures: z
      .array(z.number().int().min(1))
      .optional()
      .describe(
        "For a concept: only these figures (images or diagrams), by number as the Figures list gives them.",
      ),
    ...(tier2
      ? {
          at: z
            .number()
            .int()
            .optional()
            .describe(
              `${BEYOND}read the file as it was at this ledger sequence number (time travel).`,
            ),
        }
      : {}),
    ...libArg,
  };
  server.registerTool(
    "read",
    {
      title: "Read a file",
      description: `Read a concept as OKF markdown (frontmatter and body), with its hash, sequence, trust tier, staleness, lint, inbound link count and its figures above it (one line each, numbered as the app numbers them: path or URL, alt, caption, dimensions, size, and ok, missing or external; diagrams by type). Pass the hash as \`if_match\` when you edit, replace or delete. Check trust tier and \`stale\` before relying on the content. Ask for the figures' images with \`images: true\`, for the Mermaid diagrams drawn as people see them with \`diagrams: true\`, or for some figures of either kind with \`figures: [n]\`, when you review the page, change a figure or its caption, or answer a comment on one; they come after the markdown, each after a line naming it, at most ${IMAGES_PER_CALL} and ${IMAGE_BYTES_PER_CALL / 1048576} MB a call in all, what was left out listed with the reason (for a diagram that does not draw, Pele's error); external images are not fetched. Also reads index.md and log.md (the latest 200 requests; \`log\` pages back further); for an attachment returns its size and a short-lived download URL, and for an image (PNG, JPEG, GIF, WebP) the image itself, scaled to at most 1568 px (SVG as its text).`,
      inputSchema: readSchema,
      annotations: readOnly,
    },
    guarded(
      async (args: {
        path: string;
        image?: boolean;
        images?: boolean;
        diagrams?: boolean;
        figures?: number[];
        at?: number;
        library?: string;
      }) => {
        const picked = pick(args.library);
        const view = await withDimensions(
          picked.lib,
          ctx.blobs,
          await picked.lib.read(args.path, { at: args.at, figures: true }),
        );
        if (view.kind === "derived") return text(view.markdown);
        if (view.kind === "attachment") {
          const url = await downloadUrl(picked, {
            k: "file",
            path: view.path,
            hash: view.hash,
            media: view.media,
          });
          const facts = text(
            [
              `path: ${view.path}`,
              `hash: ${view.hash}`,
              `seq: ${view.seq}`,
              `size: ${view.size} bytes · media: ${view.media ?? "unknown"}`,
              ...(view.width && view.height ? [`dimensions: ${view.width}×${view.height} px`] : []),
              ...(view.source
                ? [
                    `source: ${view.source.url}, fetched ${view.source.fetched_at}${view.source.final_url ? ` (from ${view.source.final_url} after redirects)` : ""}; cite it in \`sources\` where you use it`,
                  ]
                : []),
              ...(view.description ? [`description: ${view.description}`] : []),
              `download (15 minutes): ${url}`,
            ].join("\n"),
          );
          if (args.image !== false) facts.content.push(...(await shown(picked.token, view)));
          return facts;
        }
        const status =
          typeof view.frontmatter.status === "string"
            ? view.frontmatter.status
            : "not set (reads as stable)";
        const figures = await figuresWithDimensions(picked.lib, ctx.blobs, view.figures ?? []);
        const result = text(
          [
            `path: ${view.path}`,
            `hash: ${view.hash}`,
            `seq: ${view.seq}${args.at !== undefined ? ` (as of ${args.at})` : ""}`,
            `trust: ${view.trust_tier} · stale: ${view.stale ? "yes" : view.stale_soon ? "soon" : "no"} · status: ${status} · inbound links: ${view.inbound_links}`,
            ...(tier2 && view.open_comments > 0
              ? [
                  `Open comments: ${view.open_comments}. Read them with \`comments\` (path ${view.path}) before you edit.`,
                ]
              : []),
            lintText(view.lint),
            ...(figures.length > 0 ? ["Figures:", ...figures.map(figureLine)] : []),
            "",
            view.markdown,
          ].join("\n"),
        );
        const want =
          args.figures ??
          (args.images || args.diagrams
            ? { images: !!args.images, diagrams: !!args.diagrams }
            : null);
        if (want) result.content.push(...(await figureImages(picked.token, figures, want)));
        return result;
      },
    ),
  );

  server.registerTool(
    "write",
    {
      title: "Create or replace a concept",
      description:
        "Write a whole concept as OKF markdown: a YAML frontmatter block with a non-empty `type` that names what kind of thing this is, e.g. `Metric`, `BigQuery Table`, `Decision`, not a generic `concept` or `note` (plus `title`, one-line `description`, optional `tags`, `resource`, `sources`, `status`, `stale_after`), then a markdown body. `stale_after` and other timestamps are full ISO 8601 datetimes with an offset, e.g. 2026-12-31T00:00:00Z (a plain date is flagged). Prefer absolute links like [orders](/tables/orders.md); cite sources with footnotes: [^id] in the text, matching a `sources[].id`, plus a `[^id]: …` definition line at the end of the body. Diagrams are Mermaid in a ```mermaid fence, drawn in the app; a fence with an unknown type, nothing after its header, or a bracket or quote left open is saved, shown as its source, and reported as `diagram_invalid` lint with the line and column inside the fence; `diagram_unrendered` lint (in the result when the renderer answers quickly, else in `work` and the next `read`) means Pele could not draw the fence, with its message, line and column: fix the fence. A file with no frontmatter, frontmatter that is not valid YAML, or no `type` is refused (400) and nothing is written. Without `if_match` it creates and fails if the path exists; to replace, pass the hash from your last read. The server stamps `generated` from your token; `verified` is not yours to set. The concept is stored in a canonical form (`-` bullets, `*` emphasis; `sources` entries one key per line, `tags: [a, b]` on one line); when that differs from what you sent, the result shows the diff, so `edit` the stored text. Prefer `edit` for small changes. Read the lint and notes in the result and fix the lint.",
      inputSchema: {
        path: z.string().describe("Where to write, e.g. `metrics/revenue.md`."),
        content: z.string().describe("The full OKF markdown document."),
        if_match: z
          .string()
          .optional()
          .describe("The current hash, to replace an existing concept."),
        note: z.string().optional().describe("One line for the ledger: why you made this change."),
        ...libArg,
      },
      annotations: writes,
    },
    guarded(async ({ path, content, if_match, note, library }) => {
      const { token, lib } = pick(library);
      checkWrite(token, path);
      const res = await lib.apply(request(note), [{ op: "write", path, content, if_match }]);
      return text(writeText("Wrote", res));
    }),
  );

  server.registerTool(
    "edit",
    {
      title: "Edit a concept",
      description:
        "Find-and-replace on the rendered document, frontmatter included, like an Edit tool. Each `old` must match exactly once; include enough surrounding text to make it unique; match the text as `read` shows it (stored in canonical form, which may differ from what was written). Edits apply in order. `if_match` is optional because the quoted text guards the edit. Preferred for small changes. On a mismatch the error includes the current document. The result names the concept's open comment threads and any whose quote the edit removed.",
      inputSchema: {
        path: z.string(),
        edits: z.array(EditSchema).min(1),
        if_match: z.string().optional(),
        note: z.string().optional().describe("One line for the ledger."),
        ...libArg,
      },
      annotations: writes,
    },
    guarded(async ({ path, edits, if_match, note, library }) => {
      const { token, lib } = pick(library);
      checkWrite(token, path);
      const res = await lib.apply(request(note), [{ op: "edit", path, edits, if_match }]);
      return text(writeText("Edited", res));
    }),
  );

  server.registerTool(
    "grep",
    {
      title: "Search text",
      description:
        "Find lines matching a literal string (or a JavaScript regular expression with `regex: true`) across rendered concepts, frontmatter included, like `grep -n`. Returns path:line: text.",
      inputSchema: {
        pattern: z.string(),
        regex: z.boolean().optional(),
        prefix: z.string().optional().describe("Only search under this directory."),
        limit: z.number().int().optional().describe("Maximum matches (default 100)."),
        ...libArg,
      },
      annotations: readOnly,
    },
    guarded(async ({ pattern, regex, prefix, limit, library }) => {
      const { lib } = pick(library);
      const r = await lib.grep(pattern, { regex, prefix, limit });
      const lines = r.matches.map((m) => `${m.path}:${m.line}: ${m.text}`);
      if (lines.length === 0) lines.push("No matches.");
      if (r.truncated)
        lines.push(`(truncated at ${lines.length} matches; narrow with prefix or raise limit)`);
      return text(lines.join("\n"));
    }),
  );

  server.registerTool(
    "move",
    {
      title: "Move or rename",
      description:
        "Move or rename a file, or a whole directory when `from` is a directory prefix (one request, one ledger event per file; the result lists each file moved). Links keep working: they are stored by identity, not path, and render with the new path. Fails if a destination is taken.",
      inputSchema: {
        from: z.string(),
        to: z.string(),
        note: z.string().optional().describe("One line for the ledger."),
        ...libArg,
      },
      annotations: writes,
    },
    guarded(async ({ from, to, note, library }) => {
      const { token, lib } = pick(library);
      checkWrite(token, from, to);
      const res = await lib.apply(request(note), [{ op: "move", path: from, to }]);
      return text(writeText("Moved", res));
    }),
  );

  server.registerTool(
    "delete",
    {
      title: "Delete a file",
      description:
        "Delete a concept or attachment. Requires `if_match` with its current hash. A concept with open comment threads is not deleted (409 `open_comments`): resolve them first. History is kept: the ledger records the delete and it can be reverted. Links pointing here become broken and show up in the work queue.",
      inputSchema: {
        path: z.string(),
        if_match: z.string(),
        note: z.string().optional().describe("One line for the ledger."),
        ...libArg,
      },
      annotations: { ...writes, destructiveHint: true },
    },
    guarded(async ({ path, if_match, note, library }) => {
      const { token, lib } = pick(library);
      checkWrite(token, path);
      const res = await lib.apply(request(note), [{ op: "delete", path, if_match }]);
      return text(writeText("Deleted", res));
    }),
  );

  server.registerTool(
    "batch",
    {
      title: "Several changes as one",
      description:
        "Apply writes, edits, moves and deletes as one all-or-nothing request, like a commit: related changes land together in the ledger and one failure applies none (the error says which op, as `Op n of m`). Each op has its own path and, where needed, if_match.",
      inputSchema: {
        ops: z.array(BatchOpSchema).min(1),
        note: z.string().optional().describe("One line for the ledger, for the whole request."),
        ...libArg,
      },
      annotations: writes,
    },
    guarded(async ({ ops, note, library }) => {
      const { token, lib } = pick(library);
      const wire: WriteOp[] = ops.map((o) => {
        switch (o.op) {
          case "write":
            if (o.content === undefined)
              throw new OkfError(400, "bad_op", `write ${o.path}: needs content.`);
            return { op: "write", path: o.path, content: o.content, if_match: o.if_match };
          case "edit":
            if (!o.edits) throw new OkfError(400, "bad_op", `edit ${o.path}: needs edits.`);
            return { op: "edit", path: o.path, edits: o.edits, if_match: o.if_match };
          case "move":
            if (!o.to) throw new OkfError(400, "bad_op", `move ${o.path}: needs to.`);
            return { op: "move", path: o.path, to: o.to };
          default:
            return { op: "delete", path: o.path, if_match: o.if_match };
        }
      });
      checkWrite(token, ...ops.flatMap((o) => (o.to ? [o.path, o.to] : [o.path])));
      const res = await lib.apply(request(note), wire);
      return text(writeText("Applied", res));
    }),
  );

  server.registerTool(
    "attach",
    {
      title: "Add an attachment",
      description:
        "Store a non-markdown file (an image, a script, a PDF) at a path, e.g. `figures/latency.png`, from exactly one of `source_url` or `content_base64`. An image on the public web goes in with `source_url`: the server fetches it (https only, no credentials in the URL, at most 3 redirects, 10 s, up to 10 MB; images, video, audio and PDF only, judged by the bytes), so nothing passes through you, and records the URL and fetch time as the file's source; a refused fetch is `fetch_refused` naming the rule. That source is not a citation: cite the original in the concept's `sources` too. Never hotlink a web image in a concept; bring it in this way. `content_base64` is for small files you made (under about 200 KB): every character is typed out, and a long run gets cut short or garbled. If you can run a shell, use `prepare_upload` instead and PUT the real file; it takes up to 10 MB. Pass `sha256` (hex; `sha256sum file`, or `hashlib.sha256(data).hexdigest()`) or at least `size` in bytes, so bytes that arrive damaged are refused (`checksum_mismatch`, with what arrived) instead of stored. Images (PNG, JPEG, GIF, WebP, AVIF, SVG) are checked on write: a broken or truncated one is refused with `bad_image`, and an image's type is taken from its bytes, not from `media` or the extension. `description` says in a line what the file shows (up to 500 characters). Replacing needs `if_match`. Reading it back with `read` returns its facts (source and description included) and a short-lived download URL.",
      inputSchema: {
        path: z.string(),
        source_url: z
          .string()
          .optional()
          .describe(
            "A public https URL the server fetches the file from; instead of content_base64.",
          ),
        content_base64: z
          .string()
          .optional()
          .describe("The file's bytes as base64, for small files; instead of source_url."),
        description: z
          .string()
          .optional()
          .describe("What the file shows, in a line (at most 500 characters)."),
        media: z.string().optional().describe("MIME type; guessed from the extension if omitted."),
        sha256: z
          .string()
          .optional()
          .describe("The file's SHA-256 as hex; the decoded bytes must match."),
        size: z.number().int().optional().describe("The file's length in bytes; checked likewise."),
        if_match: z.string().optional(),
        note: z.string().optional().describe("One line for the ledger."),
        ...libArg,
      },
      annotations: writes,
    },
    guarded(
      async ({
        path,
        source_url,
        content_base64,
        description,
        media,
        sha256,
        size,
        if_match,
        note,
        library,
      }) => {
        const { token, lib } = pick(library);
        checkWrite(token, path);
        if ((source_url === undefined) === (content_base64 === undefined)) {
          throw new OkfError(
            400,
            "bad_attach",
            "Pass exactly one of `source_url` (a public https URL the server fetches) or `content_base64` (a small file's bytes).",
          );
        }
        const declared = checkDeclared({ size, sha256 });
        const desc = checkDescription(description);
        const clean = normalizePath(path) ?? path;
        if (source_url !== undefined) {
          if (!clean || clean.endsWith(".md")) {
            throw new OkfError(
              400,
              "bad_attachment",
              "Markdown files are concepts, not attachments.",
            );
          }
          const got = await fetchBlob(
            {
              fetch: ctx.fetch ?? ((u, i) => fetch(u, i)),
              blobs: ctx.blobs,
              selfHosts: selfHosts(ctx.origin),
            },
            source_url,
            clean,
          );
          ctx.meter?.({ kind: "fetch", library: token.library.id, bytes: got.bytes.byteLength });
          checkBytes(got.bytes, declared);
          const res = await lib.apply(request(note), [
            {
              op: "attach",
              path,
              blob: got.blob,
              if_match,
              source: got.source,
              ...(desc !== undefined ? { description: desc } : {}),
            },
          ]);
          return text(
            [
              writeText("Stored", res),
              `Fetched ${got.bytes.byteLength} bytes from ${got.source.final_url ?? got.source.url} as ${got.blob.media ?? "unknown"}. Cite the original in the concept's \`sources\` too.`,
            ].join("\n"),
          );
        }
        const bytes = decodeBase64(content_base64 as string);
        checkBytes(bytes, declared);
        const blob = await putBlob(ctx.blobs, bytes, media ?? mediaFor(path), path);
        const res = await lib.apply(request(note), [
          {
            op: "attach",
            path,
            blob,
            if_match,
            ...(desc !== undefined ? { description: desc } : {}),
          },
        ]);
        return text(writeText("Stored", res));
      },
    ),
  );

  server.registerTool(
    "prepare_upload",
    {
      title: "Upload a file from your shell",
      description:
        "The way to add a real file (a screenshot, a chart, a PDF; up to 10 MB) when you can run a shell: returns a URL, good for one PUT within 15 minutes, and a ready `curl -T <file> '<url>'` line. Run it; the server stores the bytes and attaches them at `path` as you, with your `note`, and curl prints the write result as JSON (path, hash, seq, lint). Pass `sha256` (`sha256sum file`) or `size` so damaged bytes are refused. The URL needs no token, so keep it to yourself. It only works where your shell can reach this server; from a sandbox that cannot, use `attach` with base64 for a small file.",
      inputSchema: {
        path: z.string().describe("Where the file goes, e.g. `figures/latency.png`."),
        media: z.string().optional().describe("MIME type; guessed from the extension if omitted."),
        size: z.number().int().optional().describe("The file's length in bytes."),
        sha256: z.string().optional().describe("The file's SHA-256 as hex."),
        if_match: z.string().optional().describe("Replacing a file: its current hash."),
        description: z
          .string()
          .optional()
          .describe("What the file shows, in a line (at most 500 characters)."),
        note: z.string().optional().describe("One line for the ledger."),
        ...libArg,
      },
      annotations: writes,
    },
    guarded(async ({ path, media, size, sha256, if_match, description, note, library }) => {
      const picked = pick(library);
      checkWrite(picked.token, path);
      const clean = normalizePath(path);
      if (!clean || clean.endsWith(".md")) {
        throw new OkfError(
          400,
          "bad_path",
          "prepare_upload is for attachments: a file path that is not markdown (use `write` for concepts).",
        );
      }
      const req = request(note);
      const desc = checkDescription(description);
      const up = await prepareUpload(picked.lib, ctx.origin, {
        path: clean,
        media: media ?? mediaFor(clean),
        ...checkDeclared({ size, sha256 }),
        if_match,
        ...(desc !== undefined ? { description: desc } : {}),
        note: req.note ?? null,
        actor: req.actor,
        by: req.by,
        token: picked.token,
      });
      return text(
        [
          `Upload URL for ${clean} (one PUT, until ${up.expires}):`,
          up.url,
          "",
          "Run, from the directory holding the file (rename it to the file's real name if it differs):",
          up.curl,
          "",
          "curl prints the write result as JSON; read its lint. An error comes back as JSON with a code (checksum_mismatch, media_mismatch, upload_used); prepare again and resend.",
        ].join("\n"),
      );
    }),
  );

  // ------------------------------------------------------------------ tier 2: beyond files

  if (tier2) {
    server.registerTool(
      "render",
      {
        title: "Draw a diagram",
        description: `${BEYOND}draw a Mermaid diagram as the app draws it (Pele, the reader's column and greys) and see it, to check its layout and labels before you write it or while you review it: pass \`source\` (a mermaid fence's body), or \`path\` and \`figure\` (its number in \`read\`'s Figures list). Returns a line with the diagram type and size, then the drawing as a PNG image; if Pele cannot draw it, its error with line and column, and the line it names; if the PNG cannot be made, the SVG as text. Writes nothing and records nothing in the ledger. At most ${RENDERS_PER_MINUTE} renders a minute per account.`,
        inputSchema: {
          source: z
            .string()
            .optional()
            .describe("The diagram's Mermaid source: what goes inside a ```mermaid fence."),
          path: z
            .string()
            .optional()
            .describe("A concept holding the diagram, with `figure`, instead of `source`."),
          figure: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe("The diagram's figure number in that concept, as `read` lists it."),
          theme: z
            .enum(["light", "dark"])
            .optional()
            .describe("The app's light (default) or dark theme."),
          ...libArg,
        },
        annotations: readOnly,
      },
      guarded(
        async (args: {
          source?: string;
          path?: string;
          figure?: number;
          theme?: "light" | "dark";
          library?: string;
        }) => {
          let source: string;
          let what: string;
          let library: string | undefined;
          if (args.source !== undefined) {
            if (args.path !== undefined || args.figure !== undefined) {
              throw new OkfError(
                400,
                "bad_request",
                "Pass `source`, or `path` and `figure`, not both.",
              );
            }
            // A whole fence pasted in is drawn as its body.
            source =
              /^\s*(`{3,}|~{3,})\s*mermaid\b[^\n]*\n([\s\S]*?)\n?\s*\1\s*$/i.exec(
                args.source,
              )?.[2] ?? args.source;
            what = "Diagram";
            library =
              args.library || ctx.libraries.length === 1
                ? pick(args.library).token.library.id
                : undefined;
          } else {
            if (args.path === undefined || args.figure === undefined) {
              throw new OkfError(
                400,
                "bad_request",
                "Pass `source` (the diagram's Mermaid), or `path` and `figure`.",
              );
            }
            const picked = pick(args.library);
            library = picked.token.library.id;
            const view = await picked.lib.read(args.path, { figures: true });
            if (view.kind !== "concept") {
              throw new OkfError(400, "not_a_concept", `${args.path} is not a concept.`);
            }
            const figures = view.figures ?? [];
            const f = figures[args.figure - 1];
            if (!f) {
              throw new OkfError(
                404,
                "no_figure",
                `${view.path} has no figure ${args.figure} (it has ${figures.length}).`,
              );
            }
            if (f.kind !== "diagram") {
              throw new OkfError(
                400,
                "not_a_diagram",
                `Figure ${f.n} of ${view.path} is an image, not a diagram; \`read\` it with figures: [${f.n}].`,
              );
            }
            source = f.source;
            what = `Figure ${f.n} of /${view.path}${f.title ? ` (${JSON.stringify(f.title)})` : ""}`;
          }
          if (source.trim() === "") {
            throw new OkfError(400, "bad_request", "The diagram's source is empty.");
          }
          const theme = args.theme ?? "light";
          const type = diagramTypeOf(source);
          const head = `${what} · mermaid${type ? `, ${type}` : ""} · ${theme}`;
          const drawn = await draw(source, theme, library);
          if (drawn.kind === "unavailable") {
            return { ...text(`${head}\nNot drawn: ${drawn.why}.`), isError: true };
          }
          if (drawn.kind === "refused") {
            return text(
              `${head}\nPele could not draw it: ${renderErrorText(drawn.error, source)}\nFix the source and render it again; the app shows a diagram that does not draw as its source.`,
            );
          }
          if (drawn.kind === "svg") {
            const size = new TextEncoder().encode(drawn.svg).byteLength;
            return text(
              size > SVG_TEXT_BYTES
                ? `${head}\nDrawn, but the PNG could not be made (${drawn.why}) and the SVG is ${sizeText(size)}, over ${sizeText(SVG_TEXT_BYTES)}; it draws, so the source is valid.`
                : `${head}\nDrawn, but the PNG could not be made (${drawn.why}); the SVG follows as text (${sizeText(size)}).\n${drawn.svg}`,
            );
          }
          ctx.meter?.({
            kind: "read_image",
            library: library ?? "",
            bytes: drawn.bytes.byteLength,
          });
          return {
            content: [
              line(`${head} · ${drawn.width > 0 ? `${drawn.width}×${drawn.height} px` : "drawn"}`),
              { type: "image", data: toBase64(drawn.bytes), mimeType: drawn.media },
            ],
          };
        },
      ),
    );

    server.registerTool(
      "search",
      {
        title: "Ranked search",
        description: `${BEYOND}ranked full-text search over titles, bodies and tags, with snippets. Use it to find concepts by meaning words when you do not know the path; use grep for exact strings.`,
        inputSchema: {
          q: z.string().describe("Words to search for; a trailing * matches a prefix."),
          prefix: z.string().optional(),
          limit: z.number().int().optional(),
          ...libArg,
        },
        annotations: readOnly,
      },
      guarded(async ({ q, prefix, limit, library }) => {
        const { lib } = pick(library);
        const r = await lib.search(q, { prefix, limit });
        if (r.results.length === 0) return text("No results.");
        return text(
          r.results
            .map((x) => `${x.path} — ${x.title}\n  ${x.snippet.replace(/\s+/g, " ").trim()}`)
            .join("\n"),
        );
      }),
    );

    server.registerTool(
      "query",
      {
        title: "Filter by frontmatter",
        description: `${BEYOND}list concepts by frontmatter: type, tag, status, trust tier, staleness, directory. Faster and exact where grep over YAML is not.`,
        inputSchema: {
          type: z.string().optional(),
          tag: z.string().optional(),
          status: z.enum(["draft", "stable", "deprecated"]).optional(),
          trust: z.enum(["unverified", "machine-confirmed", "human-reviewed"]).optional(),
          stale: z.boolean().optional(),
          prefix: z.string().optional(),
          limit: z.number().int().optional(),
          offset: z.number().int().optional(),
          ...libArg,
        },
        annotations: readOnly,
      },
      guarded(async ({ library, ...args }) => {
        const r = await pick(library).lib.concepts(args);
        const lines = r.items.map(
          (c) =>
            `${c.path} · ${c.type || "(no type)"} · ${c.status}${c.status_set === false ? " (not set)" : ""} · ${c.trust_tier}${c.stale ? " · STALE" : ""} — ${c.title ?? ""}${c.description ? `: ${c.description}` : ""}`,
        );
        lines.unshift(
          `${r.total} matching concept${r.total === 1 ? "" : "s"}${r.next_offset !== null ? ` (next offset ${r.next_offset})` : ""}:`,
        );
        if (r.types) {
          lines.push(
            r.types.length > 0
              ? `No concept has type ${JSON.stringify(args.type)}. ${r.types_near ? "Closest types" : "Types here"}: ${r.types.join(", ")}.`
              : "The library has no concepts yet.",
          );
        }
        return text(lines.join("\n"));
      }),
    );

    server.registerTool(
      "links",
      {
        title: "Links and backlinks",
        description: `${BEYOND}a concept's outbound links (with current target paths), inbound links (backlinks), and broken links. \`kind\` is \`body\` for a markdown link or \`source\` for a \`sources[].resource\` inside the library.`,
        inputSchema: { path: z.string(), ...libArg },
        annotations: readOnly,
      },
      guarded(async ({ path, library }) => text(json(await pick(library).lib.links(path)))),
    );

    server.registerTool(
      "sources",
      {
        title: "Sources and citations",
        description: `${BEYOND}a concept's sources with how often the body cites each (\`cited\`: every [^id] reference), footnotes with no matching source, and for sources inside the library their current path, trust tier and staleness (\`broken: true\` when the path does not exist).`,
        inputSchema: { path: z.string(), ...libArg },
        annotations: readOnly,
      },
      guarded(async ({ path, library }) => text(json(await pick(library).lib.sources(path)))),
    );

    server.registerTool(
      "log",
      {
        title: "What changed",
        description: `${BEYOND}recent requests newest first: who (actor), when, their note, and the files each touched. Use it to see what other agents and humans did before you start, and to page back past what log.md shows (its latest 200 requests).`,
        inputSchema: {
          prefix: z.string().optional(),
          since: z.number().int().optional().describe("Only requests after this sequence number."),
          before: z
            .number()
            .int()
            .optional()
            .describe("Only requests before this sequence number: the cursor for older pages."),
          limit: z.number().int().optional(),
          ...libArg,
        },
        annotations: readOnly,
      },
      guarded(async ({ prefix, since, before, limit, library }) => {
        const r = await pick(library).lib.requests({ prefix, since, before, limit });
        if (r.requests.length === 0) return text("No changes.");
        const out = r.requests.map((q) => {
          const seqs = q.events.map((e) => e.seq);
          const head = `seq ${Math.min(...seqs)}–${Math.max(...seqs)} · ${q.ts} · ${q.actor}${q.note ? ` · ${q.note}` : ""} · request ${q.request_id}`;
          const evs = q.events
            .slice(0, 20)
            .map(
              (e) => `  ${e.op} ${e.path}${e.meta?.from_path ? ` (from ${e.meta.from_path})` : ""}`,
            );
          if (q.events.length > 20) evs.push(`  … and ${q.events.length - 20} more`);
          return [head, ...evs].join("\n");
        });
        if (r.next) out.push(`(older: pass before=${r.next}, or narrow with prefix)`);
        return text(out.join("\n"));
      }),
    );

    server.registerTool(
      "history",
      {
        title: "A file's history",
        description: `${BEYOND}every ledger event for a concept across moves: sequence, time, actor, op and hash. Read an old version with read(path, at).`,
        inputSchema: { path: z.string(), ...libArg },
        annotations: readOnly,
      },
      guarded(async ({ path, library }) => {
        const h = await pick(library).lib.history(path);
        const lines = h.events.map(
          (e) =>
            `seq ${e.seq} · ${e.ts} · ${e.actor} · ${e.op} ${e.path}${e.hash ? ` · ${e.hash.slice(0, 12)}` : ""}${e.meta?.note ? ` · ${e.meta.note}` : ""}`,
        );
        return text([`History of ${h.path}:`, ...lines].join("\n"));
      }),
    );

    server.registerTool(
      "diff",
      {
        title: "Compare versions",
        description: `${BEYOND}unified diff of a concept between two sequence numbers. Omit both to see its latest change; omit \`to\` for head.`,
        inputSchema: {
          path: z.string(),
          from: z.number().int().optional(),
          to: z.number().int().optional(),
          ...libArg,
        },
        annotations: readOnly,
      },
      guarded(async ({ path, from, to, library }) => {
        const d = await pick(library).lib.diff(path, { from, to });
        return text(d.diff || `No difference in ${d.path} between seq ${d.from} and ${d.to}.`);
      }),
    );

    server.registerTool(
      "revert",
      {
        title: "Undo",
        description: `${BEYOND}undo safely, forward-only: revert one path to its state at \`to_seq\`, or a whole request by \`request_id\` (from log). Adds new ledger events; nothing is erased. Only for the library's owner and their agents (403 \`owner_only\` in a library shared with you).`,
        inputSchema: {
          path: z.string().optional(),
          to_seq: z.number().int().optional(),
          request_id: z.string().optional(),
          note: z.string().optional().describe("One line for the ledger: why."),
          ...libArg,
        },
        annotations: { ...writes, destructiveHint: true },
      },
      guarded(async ({ path, to_seq, request_id, note, library }) => {
        const { token, lib } = pick(library);
        // The owner's recovery tool (TEMPRA-124), as REST's revert: the owner's agents alone.
        requireOwner(token.role, "revert changes");
        if (request_id) {
          if (token.prefix !== null) {
            throw new OkfError(
              403,
              "outside_prefix",
              "Prefix-scoped tokens revert one path at a time.",
            );
          }
          checkWrite(token);
          return text(writeText("Reverted", await lib.revert(request(note), { request_id })));
        }
        if (!path || to_seq === undefined) {
          throw new OkfError(400, "bad_revert", "Pass path and to_seq, or request_id.");
        }
        checkWrite(token, path);
        return text(writeText("Reverted", await lib.revert(request(note), { path, to_seq })));
      }),
    );

    server.registerTool(
      "work",
      {
        title: "Maintenance queue",
        description: `${BEYOND}what needs doing in this library: open comment threads (requests from people), stale concepts (past stale_after), broken links, lint, and structure (what makes a directory's index.md poor: descriptions missing, too long or repeating the title, duplicate titles, concepts nothing links to, directories with one concept, none or too many; reported on the concept or on the directory's index.md, and never fixed for you), ranked by how many concepts link in. Each item has a suggested action; fix it through the normal write tools, and answer comments with \`comment\`. \`kind: "stale_soon"\` looks ahead instead: concepts within 14 days of stale_after, to refresh before they go stale; only moving stale_after resets the clock.`,
        inputSchema: {
          kind: z
            .enum(["comment", "stale", "stale_soon", "broken_link", "lint", "structure"])
            .optional(),
          limit: z.number().int().optional(),
          ...libArg,
        },
        annotations: readOnly,
      },
      guarded(async ({ kind, limit, library }) => {
        const w = await pick(library).lib.work({ kind, limit });
        if (w.items.length === 0) return text("Nothing to do.");
        const lines = w.items.map(
          (i) =>
            `[${i.kind}] ${i.path} (since ${i.since}, ${i.inbound_links} inbound)${i.thread ? ` · thread ${i.thread}` : ""}\n  ${i.detail}\n  → ${i.suggested_action}`,
        );
        return text([`${w.total} open item${w.total === 1 ? "" : "s"}:`, ...lines].join("\n"));
      }),
    );

    server.registerTool(
      "comments",
      {
        title: "Read comment threads",
        description: `${BEYOND}comment threads: requests and questions people (and agents) left on concepts, each with the quoted text it is about, every reply, and its thread id. Pass \`path\` for one concept's threads (read them before editing it), or omit it for the library's. \`status\` is open (default), resolved or all. An outdated thread's quote is no longer in the body.`,
        inputSchema: {
          path: z.string().optional().describe("A concept, e.g. `metrics/margin.md`."),
          status: z.enum(["open", "resolved", "all"]).optional(),
          limit: z.number().int().optional().describe("Threads per page (default 50)."),
          before: z.number().int().optional().describe("The `next` cursor from the previous page."),
          ...libArg,
        },
        annotations: readOnly,
      },
      guarded(async ({ path, status, limit, before, library }) => {
        const r = await pick(library).lib.comments({ path, status, limit, before });
        if (r.threads.length === 0) {
          return text(`No ${status === "all" ? "" : `${status ?? "open"} `}comment threads.`);
        }
        // Agents named for whom they act, as the app names them; the actor where unknown.
        const ids = r.threads.flatMap((t) => t.actions.flatMap((a) => a.by?.agent ?? []));
        const names =
          ctx.agentNames && ids.length > 0
            ? await ctx.agentNames(ids).catch(() => new Map<string, string>())
            : new Map<string, string>();
        const out = r.threads.map((t) => {
          const head = `## Thread ${t.id} · ${t.path} · ${t.status}${t.outdated ? " · outdated (the quote is no longer in the body)" : ""}`;
          const quote = t.anchor ? [`> ${t.anchor.quote.replace(/\n/g, "\n> ")}`] : [];
          // Every action in order: who said what, and when it was resolved and reopened.
          const bodies = new Map(t.comments.map((c) => [c.id, c.body]));
          const mentions = new Map(t.comments.map((c) => [c.id, c.mentions]));
          const said = t.actions.map((a) => {
            const body = a.comment ? bodies.get(a.comment) : undefined;
            const verb =
              a.kind === "resolve" ? " resolved it" : a.kind === "reopen" ? " reopened it" : "";
            const text = body ? `\n  ${body.replace(/\n/g, "\n  ")}` : "";
            const named = a.comment ? mentions.get(a.comment) : undefined;
            const to = named ? ` (mentioned ${named.join(", ")})` : "";
            const who = (a.by?.agent && names.get(a.by.agent)) ?? a.actor;
            return `- ${who}${verb} at ${a.ts}${to}${text ? ":" : "."}${text}`;
          });
          return [head, ...quote, ...said].join("\n");
        });
        if (r.next) out.push(`More: pass before=${r.next}.`);
        return text(out.join("\n\n"));
      }),
    );

    server.registerTool(
      "comment",
      {
        title: "Comment, reply or resolve",
        description: `${BEYOND}answer a comment thread or start one. \`reply\` adds to a thread; \`resolve\` closes it (with an optional closing reply, e.g. what you changed); \`reopen\` opens it again; \`open\` starts a thread on a concept, optionally on a \`quote\` copied from its body as \`read\` shows it (matched by the text it reads as, markup aside; it must occur once; quote more of the sentence if it repeats). Resolve only what you actually addressed. Write \`@handle\` in a body to address someone who can reach the library: it reaches their inbox. Comments never change the concept; edit it with the write tools.`,
        inputSchema: {
          action: z.enum(["reply", "resolve", "reopen", "open"]),
          thread: z.string().optional().describe("reply, resolve, reopen: the thread id."),
          path: z.string().optional().describe("open: the concept to comment on."),
          quote: z
            .string()
            .optional()
            .describe(
              "open: text copied from the body, as `read` shows it, to anchor the comment on.",
            ),
          body: z
            .string()
            .optional()
            .describe("The comment (needed for reply and open; optional for resolve and reopen)."),
          ...libArg,
        },
        annotations: writes,
      },
      guarded(async ({ action, thread, path, quote, body, library }) => {
        const { token, lib } = pick(library);
        if (action === "open") {
          if (!path) throw new OkfError(400, "bad_request", "`open` needs the concept's `path`.");
          checkComment(token, path);
          const r = await post(token, lib, {
            kind: "open",
            path,
            body: body ?? "",
            anchor: quote ? { quote } : null,
          });
          return text(`Opened thread ${r.thread.id} on ${r.thread.path} (seq ${r.seq}).`);
        }
        if (!thread)
          throw new OkfError(400, "bad_request", `\`${action}\` needs the \`thread\` id.`);
        const t = await lib.thread(thread);
        checkComment(token, t.path);
        const r = await post(token, lib, { kind: action, thread, body: body ?? "" });
        const verb = { reply: "Replied to", resolve: "Resolved", reopen: "Reopened" }[action];
        return text(
          `${verb} thread ${thread} on ${r.thread.path} (seq ${r.seq}); it is ${r.thread.status}.`,
        );
      }),
    );

    server.registerTool(
      "export",
      {
        title: "Export the bundle",
        description: `${BEYOND}a short-lived download URL (15 minutes) for the whole library as a conformant OKF bundle (tar), with index.md and log.md materialized and each Mermaid diagram drawn beside its concept as \`<concept>.diagrams/<n>.svg\` (n its figure number; derived, so import ignores them). \`at\` exports an earlier sequence.`,
        inputSchema: { at: z.number().int().optional(), ...libArg },
        annotations: readOnly,
      },
      guarded(async ({ at, library }) => {
        const picked = pick(library);
        const seq = at ?? (await picked.lib.headSeq());
        return text(
          `Bundle at seq ${seq} (valid 15 minutes): ${await downloadUrl(picked, { k: "export", at: seq })}`,
        );
      }),
    );

    if (ctx.actor.startsWith("process:")) {
      server.registerTool(
        "verify",
        {
          title: "Record a verification",
          description: `${BEYOND}record that this process re-checked the concept against its sources and resource: adds { by: ${ctx.actor}, at: now } to \`verified\`. The content is unchanged. Only call it after an actual check.`,
          inputSchema: { path: z.string(), ...libArg },
          annotations: writes,
        },
        guarded(async ({ path, library }) => {
          const { token, lib } = pick(library);
          checkWrite(token, path);
          return text(writeText("Verified", await lib.verify(request(), path)));
        }),
      );
    }
  }

  // ------------------------------------------------------------------ resources

  server.registerResource(
    "concept",
    new ResourceTemplate(`${URI_SCHEME}://{owner}/{library}/{+path}`, {
      list: async () => {
        const resources = [];
        for (const token of ctx.libraries) {
          if (resources.length >= 1000) break;
          const tree = await ctx.open(token).tree();
          for (const e of tree.entries) {
            if (e.kind === "dir") continue;
            if (resources.length >= 1000) break;
            resources.push({
              uri: `${URI_SCHEME}://${token.library.owner}/${token.library.slug}/${e.path}`,
              name: e.path,
              title: "title" in e && e.title ? e.title : undefined,
              description: "description" in e && e.description ? e.description : undefined,
              mimeType:
                e.kind === "concept" ? "text/markdown" : ("media" in e && e.media) || undefined,
            });
          }
        }
        return { resources };
      },
    }),
    {
      title: "Library files",
      description:
        "Concepts in your libraries as OKF markdown, and attachments as their bytes (images scaled for the model), addressable by owner, library and path.",
      mimeType: "text/markdown",
    },
    async (uri, vars) => {
      const one = (v: string | string[] | undefined) =>
        Array.isArray(v) ? v.join("/") : (v ?? "");
      const picked = pick(`${one(vars.owner)}/${one(vars.library)}`);
      const view = await picked.lib.read(decodeURIComponent(one(vars.path)));
      if (view.kind === "attachment") {
        const url = await downloadUrl(picked, {
          k: "file",
          path: view.path,
          hash: view.hash,
          media: view.media,
        });
        const link = {
          contents: [
            { uri: uri.href, mimeType: "text/plain", text: `Attachment; download: ${url}` },
          ],
        };
        // The bytes themselves (TEMPRA-155): images scaled for the model, other files up to a cap.
        if (view.media && RASTER_MEDIA.has(view.media)) {
          const img = await images.forModel(view);
          if (!("bytes" in img)) return link;
          ctx.meter?.({
            kind: "read_image",
            library: picked.token.library.id,
            bytes: img.bytes.byteLength,
          });
          return { contents: [{ uri: uri.href, mimeType: img.media, blob: toBase64(img.bytes) }] };
        }
        if (view.size > RESOURCE_BYTES) return link;
        const obj = await ctx.blobs.get(view.hash);
        if (!obj) return link;
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: view.media ?? "application/octet-stream",
              blob: toBase64(await readBytes(obj.body)),
            },
          ],
        };
      }
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: view.markdown }] };
    },
  );

  return server;
}

/** Serves one MCP request statelessly: a fresh server and transport per HTTP request. */
export async function handleMcp(req: Request, ctx: McpContext): Promise<Response> {
  const server = buildServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}
