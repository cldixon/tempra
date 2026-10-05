import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { TokenInfo } from "../auth";
import { type BlobStore, type LibraryClient, mediaFor, putBlob } from "../client";
import { normalizePath, underPrefix } from "../okf/paths";
import type { LintWarning } from "../okf/types";
import { OkfError } from "../store/errors";
import type { RequestContext, WriteOp, WriteResult } from "../store/store";

export interface McpContext {
  /** The ledger actor, access and tool tier: the same in every library the caller reaches. */
  actor: string;
  scope: "read" | "write";
  tiers: string;
  /** The libraries the caller reaches now, each as the token it acts with there. */
  libraries: TokenInfo[];
  open(token: TokenInfo): LibraryClient;
  blobs: BlobStore;
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
1. Call \`start\` first. It opens your library, or lists the libraries you can reach when there are several; then pass \`library\` (owner/slug) on every call. Then \`browse\` a directory before reading, follow links, and \`read\` what you need. Check frontmatter (type, status, trust tier, stale) before relying on a body.
2. Write conformant concepts: a non-empty \`type\` naming what kind of thing it is (Metric, Protocol, Decision; never a generic word like concept, page or note, and reuse the types \`start\` lists), a \`title\` and one-line \`description\`, absolute links like [x](/dir/x.md), footnotes [^id] keyed to \`sources[].id\`, one idea per concept.
3. Prefer \`edit\` for small changes, \`write\` for new concepts or rewrites, \`batch\` for related changes so they land as one request. Pass \`if_match\` (the hash from your last read); on a conflict, re-read and reapply.
4. Put a one-line \`note\` on every write. Read the \`lint\` in every write result and fix what it reports. Keep concepts under 100 KB; split big ones into linked concepts.
5. Never write index.md or log.md (the server synthesizes them). Never set \`generated\` (the server stamps it) or \`verified\` (not yours to claim). Set \`status\` and \`stale_after\` honestly. Timestamps are full ISO 8601 datetimes with an offset (\`stale_after: 2026-12-31T00:00:00Z\`); a plain date is flagged.
6. Use \`work\` to find what needs doing: open comments, stale concepts, broken links, lint.
7. Comments are how people ask you for changes. Before editing a concept, read its open threads with \`comments\`; make the change a comment asks for, then answer it with \`comment\` (reply, and resolve what you fixed). Ask with a reply when unsure; never resolve a thread you did not address.`;

const text = (t: string): CallToolResult => ({ content: [{ type: "text", text: t }] });

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
  return { isError: true, content: [{ type: "text", text: lines.join("\n") }] };
}

function lintText(lint: LintWarning[]): string {
  if (lint.length === 0) return "Lint: none.";
  return ["Lint (fix these):", ...lint.map((l) => `- ${l.code}: ${l.message}`)].join("\n");
}

function writeText(verb: string, res: WriteResult): string {
  const lines = res.results.map((r) => {
    if (r.hash === null) return `${verb} ${r.path} (${r.op}, seq ${r.seq}).`;
    return `${verb} ${r.path} (${r.op}, seq ${r.seq}): hash ${r.hash}`;
  });
  const lint = res.results.flatMap((r) =>
    r.lint.map((l) => ({ ...l, message: `${r.path}: ${l.message}` })),
  );
  return [...lines, `Request ${res.request_id}.`, lintText(lint)].join("\n");
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
        `This connection reaches no libraries yet. Create one at ${ctx.origin}/ or reconnect and choose one.`,
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
  });

  const checkWrite = (token: TokenInfo, ...paths: string[]) => {
    if (token.scope !== "write") throw new OkfError(403, "read_only", "This token is read-only.");
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

  const readOnly = { readOnlyHint: true, openWorldHint: false };
  const writes = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

  // ------------------------------------------------------------------ tier 1: file-equivalent

  const you = () =>
    `You are ${ctx.actor} (${ctx.scope}${ctx.libraries[0]?.prefix ? `, under ${ctx.libraries[0].prefix}/` : ""}). Tools: ${tier2 ? "file tools and beyond-files tools" : "file tools only"}.`;

  server.registerTool(
    "start",
    {
      title: "Start here",
      description:
        "Call this first in every session. Opens a library: its root index.md (what is here, one level down), counts by concept type, the number of open work items, and how to work in it. When you can reach several libraries and pass no `library`, lists them instead.",
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
      const [summary, root] = await Promise.all([lib.summary(), lib.read("index.md")]);
      const types = Object.entries(summary.types)
        .sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `${t} ${n}`)
        .join(", ");
      const empty = summary.concepts + summary.attachments === 0;
      const others = ctx.libraries.filter((t) => t !== token);
      const lines = [
        `# Library ${token.library.owner}/${token.library.slug} (seq ${summary.seq})`,
        "",
        `Concepts: ${summary.concepts} · attachments: ${summary.attachments} · open work items: ${summary.open_work} (${summary.open_comments} of them comment threads)`,
        `Types: ${types || "none yet"}`,
        you(),
        ...(others.length > 0
          ? [
              `Other libraries you can reach: ${libraryList(others)}. Pass \`library\` on every call.`,
            ]
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
      ];
      if (tier2) {
        lines.push(
          "- `work` lists open comments, stale concepts, broken links and lint to fix; `log` shows what others changed recently.",
          "- Comments are requests from people: read a concept's open threads (`comments`) before editing it, then reply and resolve with `comment`.",
        );
      }
      return text(lines.join("\n"));
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

  const readSchema = {
    path: z
      .string()
      .describe("Concept or file path, e.g. `tables/orders.md` (the .md is optional)."),
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
      description:
        "Read a concept as OKF markdown (frontmatter and body), with its hash, sequence, trust tier, staleness, lint and inbound link count above it. Pass the hash as `if_match` when you edit, replace or delete. Check trust tier and `stale` before relying on the content. Also reads index.md and log.md; for an attachment returns its size and a short-lived download URL.",
      inputSchema: readSchema,
      annotations: readOnly,
    },
    guarded(async (args: { path: string; at?: number; library?: string }) => {
      const picked = pick(args.library);
      const view = await picked.lib.read(args.path, { at: args.at });
      if (view.kind === "derived") return text(view.markdown);
      if (view.kind === "attachment") {
        const url = await downloadUrl(picked, {
          k: "file",
          path: view.path,
          hash: view.hash,
          media: view.media,
        });
        return text(
          [
            `path: ${view.path}`,
            `hash: ${view.hash}`,
            `seq: ${view.seq}`,
            `size: ${view.size} bytes · media: ${view.media ?? "unknown"}`,
            `download (15 minutes): ${url}`,
          ].join("\n"),
        );
      }
      const status =
        typeof view.frontmatter.status === "string" ? view.frontmatter.status : "stable";
      return text(
        [
          `path: ${view.path}`,
          `hash: ${view.hash}`,
          `seq: ${view.seq}${args.at !== undefined ? ` (as of ${args.at})` : ""}`,
          `trust: ${view.trust_tier} · stale: ${view.stale ? "yes" : "no"} · status: ${status} · inbound links: ${view.inbound_links}`,
          ...(tier2 && view.open_comments > 0
            ? [
                `Open comments: ${view.open_comments}. Read them with \`comments\` (path ${view.path}) before you edit.`,
              ]
            : []),
          lintText(view.lint),
          "",
          view.markdown,
        ].join("\n"),
      );
    }),
  );

  server.registerTool(
    "write",
    {
      title: "Create or replace a concept",
      description:
        "Write a whole concept as OKF markdown: a YAML frontmatter block with a non-empty `type` that names what kind of thing this is, e.g. `Metric`, `BigQuery Table`, `Decision`, not a generic `concept` or `note` (plus `title`, one-line `description`, optional `tags`, `resource`, `sources`, `status`, `stale_after`), then a markdown body. `stale_after` and other timestamps are full ISO 8601 datetimes with an offset, e.g. 2026-12-31T00:00:00Z (a plain date is flagged). Prefer absolute links like [orders](/tables/orders.md); cite sources with footnotes: [^id] in the text, matching a `sources[].id`, plus a `[^id]: …` definition line at the end of the body. Without `if_match` it creates and fails if the path exists; to replace, pass the hash from your last read. The server stamps `generated` from your token; `verified` is not yours to set. Prefer `edit` for small changes. Read the lint in the result and fix it.",
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
        "Find-and-replace on the rendered document, frontmatter included, like an Edit tool. Each `old` must match exactly once; include enough surrounding text to make it unique. Edits apply in order. `if_match` is optional because the quoted text guards the edit. Preferred for small changes. On a mismatch the error includes the current document.",
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
        "Move or rename a file, or a whole directory when `from` is a directory prefix (one request, one ledger event per file). Links keep working: they are stored by identity, not path, and render with the new path. Fails if a destination is taken.",
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
      return text(writeText("Moved to", res));
    }),
  );

  server.registerTool(
    "delete",
    {
      title: "Delete a file",
      description:
        "Delete a concept or attachment. Requires `if_match` with its current hash. History is kept: the ledger records the delete and it can be reverted. Links pointing here become broken and show up in the work queue.",
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
        "Apply writes, edits, moves and deletes as one all-or-nothing request, like a commit: related changes land together in the ledger and one failure applies none. Each op has its own path and, where needed, if_match.",
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
        "Store a small non-markdown file (an image, a script, a PDF; up to 10 MB) at a path, e.g. `references/attesters/check.py`. Send the bytes base64-encoded. Replacing needs `if_match`. Reading it back with `read` returns a short-lived download URL.",
      inputSchema: {
        path: z.string(),
        content_base64: z.string(),
        media: z.string().optional().describe("MIME type; guessed from the extension if omitted."),
        if_match: z.string().optional(),
        note: z.string().optional().describe("One line for the ledger."),
        ...libArg,
      },
      annotations: writes,
    },
    guarded(async ({ path, content_base64, media, if_match, note, library }) => {
      const { token, lib } = pick(library);
      checkWrite(token, path);
      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(atob(content_base64), (c) => c.charCodeAt(0));
      } catch {
        throw new OkfError(400, "bad_base64", "content_base64 is not valid base64.");
      }
      const blob = await putBlob(ctx.blobs, bytes, media ?? mediaFor(path));
      const res = await lib.apply(request(note), [{ op: "attach", path, blob, if_match }]);
      return text(writeText("Stored", res));
    }),
  );

  // ------------------------------------------------------------------ tier 2: beyond files

  if (tier2) {
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
            `${c.path} · ${c.type || "(no type)"} · ${c.status} · ${c.trust_tier}${c.stale ? " · STALE" : ""} — ${c.title ?? ""}${c.description ? `: ${c.description}` : ""}`,
        );
        lines.unshift(
          `${r.total} matching concept${r.total === 1 ? "" : "s"}${r.next_offset !== null ? ` (next offset ${r.next_offset})` : ""}:`,
        );
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
        description: `${BEYOND}recent requests newest first: who (actor), when, their note, and the files each touched. Use it to see what other agents and humans did before you start.`,
        inputSchema: {
          prefix: z.string().optional(),
          since: z.number().int().optional().describe("Only requests after this sequence number."),
          limit: z.number().int().optional(),
          ...libArg,
        },
        annotations: readOnly,
      },
      guarded(async ({ prefix, since, limit, library }) => {
        const r = await pick(library).lib.requests({ prefix, since, limit });
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
        if (r.next)
          out.push(`(older: pass before=${r.next} via the REST API, or narrow with prefix)`);
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
        description: `${BEYOND}undo safely, forward-only: revert one path to its state at \`to_seq\`, or a whole request by \`request_id\` (from log). Adds new ledger events; nothing is erased.`,
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
        description: `${BEYOND}what needs doing in this library: open comment threads (requests from people), stale concepts (past stale_after), broken links, and lint, ranked by how many concepts link in. Each item has a suggested action; fix it through the normal write tools, and answer comments with \`comment\`.`,
        inputSchema: {
          kind: z.enum(["comment", "stale", "broken_link", "lint"]).optional(),
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
        const out = r.threads.map((t) => {
          const head = `## Thread ${t.id} · ${t.path} · ${t.status}${t.outdated ? " · outdated (the quote is no longer in the body)" : ""}`;
          const quote = t.anchor ? [`> ${t.anchor.quote.replace(/\n/g, "\n> ")}`] : [];
          const said = t.comments.map(
            (c) => `- ${c.actor} at ${c.ts}:\n  ${c.body.replace(/\n/g, "\n  ")}`,
          );
          const resolved = t.resolved_by ? [`Resolved by ${t.resolved_by}.`] : [];
          return [head, ...quote, ...said, ...resolved].join("\n");
        });
        if (r.next) out.push(`More: pass before=${r.next}.`);
        return text(out.join("\n\n"));
      }),
    );

    server.registerTool(
      "comment",
      {
        title: "Comment, reply or resolve",
        description: `${BEYOND}answer a comment thread or start one. \`reply\` adds to a thread; \`resolve\` closes it (with an optional closing reply, e.g. what you changed); \`reopen\` opens it again; \`open\` starts a thread on a concept, optionally on a \`quote\` copied exactly from its body (it must occur once; quote more of the sentence if it repeats). Resolve only what you actually addressed. Comments never change the concept; edit it with the write tools.`,
        inputSchema: {
          action: z.enum(["reply", "resolve", "reopen", "open"]),
          thread: z.string().optional().describe("reply, resolve, reopen: the thread id."),
          path: z.string().optional().describe("open: the concept to comment on."),
          quote: z
            .string()
            .optional()
            .describe("open: text copied exactly from the body to anchor the comment on."),
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
          checkWrite(token, path);
          const r = await lib.comment(request(), {
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
        checkWrite(token, t.path);
        const r = await lib.comment(request(), { kind: action, thread, body: body ?? "" });
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
        description: `${BEYOND}a short-lived download URL (15 minutes) for the whole library as a conformant OKF bundle (tar), with index.md and log.md materialized. \`at\` exports an earlier sequence.`,
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
        "Concepts in your libraries as OKF markdown, addressable by owner, library and path.",
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
        return {
          contents: [
            { uri: uri.href, mimeType: "text/plain", text: `Attachment; download: ${url}` },
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
