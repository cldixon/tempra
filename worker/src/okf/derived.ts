/** Synthesized `index.md` (OKF §8) and `log.md` (OKF §9). Never authored, never stored. */

import { basename } from "./paths";

export const OKF_VERSION = "0.2";

export interface IndexInput {
  /** The directory, "" for the bundle root. */
  dir: string;
  subdirs: { name: string; concepts: number }[];
  concepts: { path: string; title: string | null; description: string | null }[];
  attachments: { path: string }[];
}

/** One directory level: a section for subdirectories, one for concepts, one for other files. */
export function renderIndex(input: IndexInput): string {
  const parts: string[] = [];
  if (input.dir === "") parts.push(`---\nokf_version: "${OKF_VERSION}"\n---\n`);
  const line = (label: string, href: string, desc: string | null) =>
    `* [${escapeLabel(label)}](${encodeHref(href)})${desc ? ` - ${oneLine(desc)}` : ""}`;
  if (input.subdirs.length > 0) {
    parts.push("# Subdirectories\n");
    for (const d of input.subdirs) {
      const n = d.concepts === 1 ? "1 concept" : `${d.concepts} concepts`;
      parts.push(line(d.name, `${d.name}/index.md`, n));
    }
    parts.push("");
  }
  if (input.concepts.length > 0) {
    parts.push("# Concepts\n");
    for (const c of input.concepts) {
      const name = basename(c.path);
      parts.push(line(c.title || name.replace(/\.md$/, ""), name, c.description));
    }
    parts.push("");
  }
  if (input.attachments.length > 0) {
    parts.push("# Files\n");
    for (const a of input.attachments) parts.push(line(basename(a.path), basename(a.path), null));
    parts.push("");
  }
  if (parts.length === (input.dir === "" ? 1 : 0)) parts.push("*This directory is empty.*\n");
  return parts.join("\n");
}

export interface LogRequest {
  ts: string;
  actor: string;
  note: string | null;
  events: {
    op: string;
    path: string;
    created: boolean;
    /** move: where the file came from. */
    fromPath?: string | null;
    /** Where the file is now, or null once it is gone; the entry links there. Defaults to `path`. */
    current?: string | null;
  }[];
}

const LABELS: Record<string, string> = {
  create: "Creation",
  put: "Update",
  delete: "Deletion",
  move: "Move",
  import: "Import",
  revert: "Revert",
  verify: "Verification",
};

const VERBS: Record<string, string> = {
  create: "created",
  put: "updated",
  delete: "deleted",
  move: "moved",
  import: "imported",
  revert: "reverted",
  verify: "verified",
};

/**
 * Requests newest first, grouped by UTC day; one bullet per request. A request of one kind is
 * labelled by it; a mixed one says what happened to each file. Moves name both paths. Each file
 * links to where it is now, so links keep working after a move; a file that is gone is plain text.
 */
export function renderLog(requests: LogRequest[], title = "Library log"): string {
  const out: string[] = [`# ${title}\n`];
  let day = "";
  for (const [i, r] of requests.entries()) {
    const d = r.ts.slice(0, 10);
    if (d !== day) {
      out.push(`## ${d}\n`);
      day = d;
    }
    // One entry per file: its first event in the request says what happened to it.
    const files = new Map<string, LogRequest["events"][number] & { kind: string }>();
    for (const e of r.events) {
      if (files.has(e.path)) continue;
      files.set(e.path, { ...e, kind: e.op === "put" && e.created ? "create" : e.op });
    }
    const entries = [...files.values()];
    const kinds = new Set(entries.map((e) => e.kind));
    const single = kinds.size === 1 ? [...kinds][0] : undefined;
    const label = single ? (LABELS[single] ?? "Update") : "Changes";
    const shown = entries.slice(0, 10).map((e) => {
      const current = e.current === undefined ? e.path : e.current;
      const name = current
        ? `[${escapeLabel(e.path)}](/${encodeHref(current)})`
        : `\`${e.path.replace(/`/g, "")}\``;
      const what = e.kind === "move" && e.fromPath ? `${e.fromPath} → ${name}` : name;
      return single ? what : `${VERBS[e.kind] ?? e.kind} ${what}`;
    });
    if (entries.length > 10) shown.push(`and ${entries.length - 10} more`);
    const note = r.note ? ` ${oneLine(r.note)}` : "";
    out.push(`* **${label}** by \`${r.actor}\`:${note} ${shown.join(", ")}`);
    const next = requests[i + 1];
    if (!next || next.ts.slice(0, 10) !== day) out.push("");
  }
  if (requests.length === 0) out.push("*No changes yet.*\n");
  return out.join("\n");
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function escapeLabel(s: string): string {
  return s.replace(/([[\]\\])/g, "\\$1");
}

function encodeHref(s: string): string {
  return s.replace(/[ ()<>]/g, (c) => encodeURIComponent(c));
}
