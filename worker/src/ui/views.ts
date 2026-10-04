import type { JsonObject } from "../okf/types";
import { chip, esc, when } from "./layout";

/** URLs of the UI pages for one library, optionally pinned to a sequence (spec: Built-in UI). */
export class Urls {
  readonly base: string;
  constructor(
    readonly owner: string,
    readonly slug: string,
    readonly at?: number,
  ) {
    this.base = `/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/`;
  }
  private q(extra?: string) {
    const parts = [this.at === undefined ? "" : `at=${this.at}`, extra ?? ""].filter(Boolean);
    return parts.length ? `?${parts.join("&")}` : "";
  }
  pinned(at: number | undefined) {
    return new Urls(this.owner, this.slug, at);
  }
  /** A library page: /{owner}/{slug}/-/{page} (v2 spec: URLs). */
  private page(rest: string) {
    return `${this.base}-/${rest}`;
  }
  /** Directories and files sit at their own path, unless it starts with the pages' `-/`. */
  private own(path: string) {
    return path === "-" || path.startsWith("-/") ? null : `${this.base}${enc(path)}`;
  }
  tree(dir: string) {
    if (dir === "") return `${this.base}${this.q()}`;
    return `${this.own(dir) ?? this.page(`tree/${enc(dir)}`)}/${this.q()}`;
  }
  file(path: string, anchor: string | null = null) {
    return `${this.own(path) ?? this.page(`files/${enc(path)}`)}${this.q()}${anchor ?? ""}`;
  }
  raw(path: string) {
    return `${this.base}-/raw/${enc(path)}${this.q()}`;
  }
  download(path: string) {
    return `${this.base}-/download/${enc(path)}${this.q()}`;
  }
  /** A diff of a concept between two sequences; either end may be left to the server. */
  diff(path: string, from?: number, to?: number) {
    return `${this.base}-/diff/${enc(path)}${query({ from, to })}`;
  }
  ledger(filters: LedgerFilters = {}) {
    return `${this.base}-/ledger${query({ ...filters })}`;
  }
  revert(requestId: string) {
    return `${this.base}-/revert/${encodeURIComponent(requestId)}`;
  }
  restore(path: string, to: number) {
    return `${this.base}-/restore/${enc(path)}${query({ to })}`;
  }
  verify(path: string) {
    return `${this.base}-/verify/${enc(path)}`;
  }
  work(kind?: string) {
    return `${this.base}-/work${query({ kind })}`;
  }
  transfer() {
    return `${this.base}-/transfer`;
  }
  exportTar(at?: number) {
    return `${this.base}-/export${query({ at })}`;
  }
  importTar() {
    return `${this.base}-/import`;
  }
  maintain() {
    return `${this.base}-/maintain`;
  }
  recovery() {
    return `${this.base}-/recovery`;
  }
  connect() {
    return `${this.base}-/connect`;
  }
  remove() {
    return `${this.base}-/delete`;
  }
  nightly(date: string, file: string) {
    return `${this.base}-/exports/${encodeURIComponent(date)}/${encodeURIComponent(file)}`;
  }
}

export interface LedgerFilters {
  prefix?: string;
  actor?: string;
  from?: string;
  to?: string;
  before?: number;
}

function query(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** The library's section tabs: its files and its ledger. */
export type LibTab = "files" | "ledger" | "work" | "transfer" | "recovery" | "connect" | "delete";

export function libNav(urls: Urls, active: LibTab): string {
  const tab = (name: string, href: string, key: LibTab) =>
    key === active ? `<strong>${name}</strong>` : `<a href="${esc(href)}">${name}</a>`;
  const tabs = [
    tab("Files", urls.pinned(undefined).tree(""), "files"),
    tab("Ledger", urls.ledger(), "ledger"),
    tab("Work queue", urls.work(), "work"),
    tab("Import &amp; export", urls.transfer(), "transfer"),
    tab("Recovery", urls.recovery(), "recovery"),
    tab("Connect", urls.connect(), "connect"),
    tab("Delete", urls.remove(), "delete"),
  ];
  return `<nav class="libnav"><span class="muted">${esc(urls.slug)}:</span> ${tabs.join(" · ")}</nav>`;
}

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

function baseName(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Breadcrumbs from the library root to `path` (a directory, or a file when `file` is set). */
export function crumbs(urls: Urls, path: string, file: boolean): string {
  const parts = path === "" ? [] : path.split("/");
  const out = [`<a href="${esc(urls.tree(""))}">${esc(urls.slug)}</a>`];
  parts.forEach((seg, i) => {
    const p = parts.slice(0, i + 1).join("/");
    const last = i === parts.length - 1;
    if (last && file) out.push(esc(seg));
    else out.push(`<a href="${esc(urls.tree(p))}">${esc(seg)}</a>`);
  });
  return `<div class="crumbs">${out.join(" / ")}</div>`;
}

/** Ops that change a file's content (or remove it), and so have a diff. */
const CONTENT_OPS = new Set(["put", "import", "revert", "delete", "attach"]);

// ---------------------------------------------------------------- diffs

/** A unified diff as HTML, one line per row, colored by kind. */
export function diffHtml(diff: string): string {
  if (diff.trim() === "") return `<p class="muted">No differences.</p>`;
  const lines = diff.replace(/\n$/, "").split("\n");
  const rows = lines.map((line) => {
    let cls = "ctx";
    if (line.startsWith("+++") || line.startsWith("---")) cls = "meta";
    else if (line.startsWith("@@")) cls = "hunk";
    else if (line.startsWith("+")) cls = "add";
    else if (line.startsWith("-")) cls = "del";
    else if (line.startsWith("\\")) cls = "meta";
    return `<span class="${cls}">${esc(line) || " "}</span>`;
  });
  return `<pre class="diff">${rows.join("\n")}</pre>`;
}

// ---------------------------------------------------------------- ledger

export interface LedgerEvent {
  seq: number;
  op: string;
  path: string;
  meta: JsonObject | null;
}

export interface LedgerRequest {
  request_id: string;
  ts: string;
  actor: string;
  note: string | null;
  events: LedgerEvent[];
}

function eventLine(urls: Urls, e: LedgerEvent): string {
  const from =
    typeof e.meta?.from_path === "string"
      ? ` <span class="muted">from ${esc(e.meta.from_path)}</span>`
      : "";
  // A deleted file is shown as it was just before.
  const view = urls.pinned(e.op === "delete" ? e.seq - 1 : e.seq).file(e.path);
  const diff = CONTENT_OPS.has(e.op)
    ? ` · <a class="small" href="${esc(urls.diff(e.path, undefined, e.seq))}">diff</a>`
    : "";
  return `<li><span class="op op-${esc(e.op)}">${esc(e.op)}</span> <a href="${esc(view)}">${esc(e.path)}</a>${from}${diff}</li>`;
}

// ---------------------------------------------------------------- revert and restore

export function revertPage(opts: {
  urls: Urls;
  request: LedgerRequest;
  diffs: { path: string; diff: string }[];
  actor: string;
}): string {
  const { urls, request: r } = opts;
  const diffs = opts.diffs.map((d) => `<h2>${esc(d.path)}</h2>${diffHtml(d.diff)}`).join("");
  return `<h1>Revert this request?</h1>
<p>${esc(when(r.ts))} by <strong>${esc(r.actor)}</strong>${r.note ? `: ${esc(r.note)}` : ""}</p>
<ul class="events">${r.events.map((e) => eventLine(urls, e)).join("")}</ul>
<div class="panel-box">
<p>Undoes every change in this request, as a new request by ${esc(opts.actor)}.</p>
<form method="post" action="${esc(urls.revert(r.request_id))}">
<label>Note <input type="text" name="note" value="Revert: ${esc(r.note ?? r.request_id)}"></label>
<p><button class="primary" type="submit">Revert</button> <a href="${esc(urls.ledger())}">Cancel</a></p></form></div>
<p class="small muted">What this request changed:</p>
${diffs}`;
}

export function restorePage(opts: {
  urls: Urls;
  path: string;
  to: number;
  diff: string;
  actor: string;
}): string {
  const { urls, path, to } = opts;
  return `${crumbs(urls, path, true)}
<h1>Restore ${esc(baseName(path))} as of seq ${to}?</h1>
<div class="panel-box">
<p>Writes back the version from seq ${to}, as a revert by ${esc(opts.actor)}.</p>
<form method="post" action="${esc(urls.restore(path, to))}">
<label>Note <input type="text" name="note" value="Restore ${esc(path)} to seq ${to}"></label>
<p><button class="primary" type="submit">Restore</button> <a href="${esc(urls.pinned(to).file(path))}">Cancel</a></p></form></div>
<p class="small muted">Current version → version at seq ${to}:</p>
${diffHtml(opts.diff)}`;
}

// ---------------------------------------------------------------- work queue

export interface WorkItem {
  kind: string;
  path: string;
  since: string;
  detail: string;
  suggested_action: string;
  inbound_links: number;
}

export function workPage(opts: {
  urls: Urls;
  items: WorkItem[];
  total: number;
  kind?: string;
}): string {
  const { urls } = opts;
  const kinds: [string | undefined, string][] = [
    [undefined, "All"],
    ["stale", "Stale"],
    ["broken_link", "Broken links"],
    ["lint", "Lint"],
  ];
  const filter = kinds
    .map(([k, label]) =>
      k === opts.kind ? `<strong>${label}</strong>` : `<a href="${esc(urls.work(k))}">${label}</a>`,
    )
    .join(" · ");
  const tone = (k: string) => (k === "lint" ? "warn" : "bad");
  const rows = opts.items
    .map(
      (i) => `<tr><td>${chip(i.kind.replace("_", " "), tone(i.kind))}</td>
<td class="name"><a href="${esc(urls.file(i.path))}">${esc(i.path)}</a><div class="small muted">${esc(i.detail)}</div>
<div class="small">→ ${esc(i.suggested_action)}</div></td>
<td class="muted small">${i.inbound_links} inbound</td><td class="muted small">${esc(when(i.since))}</td></tr>`,
    )
    .join("");
  return `<h1>Work queue</h1>
<p class="small">${filter}</p>
${
  rows
    ? `<div class="table-wrap"><table class="list"><tbody>${rows}</tbody></table></div>${opts.total > opts.items.length ? `<p class="small muted">${opts.total - opts.items.length} more not shown.</p>` : ""}`
    : `<p>${chip("nothing to do", "ok")}</p>`
}`;
}

// ---------------------------------------------------------------- import and export

export interface NightlyExport {
  /** The folder under exports/<library id>/: YYYY-MM-DD, or YYYY-MM-DD-pre-restore-HHMMSSmmm-xxxx. */
  date: string;
  seq: number | null;
  files: number | null;
}

/** "2026-09-30", or "2026-09-30 18:02:11 UTC, before a restore" for a pre-restore export. */
function exportLabel(folder: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})-pre-restore-(\d{2})(\d{2})(\d{2})\d{3}(-[0-9a-f]{4})?$/.exec(
    folder,
  );
  return m ? `${m[1]} ${m[2]}:${m[3]}:${m[4]} UTC, before a restore` : folder;
}

export function transferPage(opts: {
  urls: Urls;
  head: number;
  result?: string;
  error?: string;
  nightly?: NightlyExport[];
}): string {
  const { urls } = opts;
  const nightly = opts.nightly ?? [];
  const nightlyRows = nightly
    .map(
      (
        n,
      ) => `<tr><td><strong>${esc(exportLabel(n.date))}</strong></td><td class="muted small">${n.seq !== null ? `seq ${n.seq}` : ""}${n.files !== null ? ` · ${n.files} files` : ""}</td>
<td><a href="${esc(urls.nightly(n.date, "bundle.tar"))}">bundle.tar</a> · <a href="${esc(urls.nightly(n.date, "ledger.jsonl"))}">ledger.jsonl</a></td></tr>`,
    )
    .join("");
  const nightlyBox = `<div class="panel-box"><h2>Nightly exports</h2>
${nightlyRows ? `<div class="table-wrap"><table class="list"><tbody>${nightlyRows}</tbody></table></div>` : `<p>None yet.</p>`}
<form method="post" action="${esc(urls.maintain())}"><button type="submit">Export now</button></form></div>`;
  return `<h1>Import &amp; export</h1>
${opts.result ? `<div class="notice ok">${opts.result}</div>` : ""}
${opts.error ? `<div class="notice">${esc(opts.error)}</div>` : ""}
<div class="panel-box"><h2>Export</h2>
<form class="inline" method="get" action="${esc(urls.exportTar())}">
<label class="small" for="at">As of sequence</label>
<input id="at" name="at" type="number" min="0" max="${opts.head}" placeholder="${opts.head} (now)">
<button class="primary" type="submit">Download .tar</button></form></div>
<div class="panel-box"><h2>Import</h2>
<p>A .tar or .tar.gz, as one revertible request.</p>
<form method="post" action="${esc(urls.importTar())}" enctype="multipart/form-data">
<p><input type="file" name="bundle" accept=".tar,.tgz,.gz,application/x-tar,application/gzip" required></p>
<p><label class="small">Leading directories to drop <input type="number" name="strip" min="0" max="10" value="0"></label></p>
<p><input type="text" name="note" placeholder="Note (optional)"></p>
<button class="primary" type="submit">Import</button></form></div>
${nightlyBox}`;
}

// ---------------------------------------------------------------- recovery

/** A restore as the recovery page lists it (spec: Backups and recovery). */
export interface RestoreRow {
  id: string;
  kind: "restore" | "undo";
  to: string;
  requested_at: string;
  actor: string;
  seq_before: number;
  /** The pre-restore export's folder name under exports/<library id>/. */
  export: string;
  undoes?: string;
}

export function recoveryPage(opts: {
  urls: Urls;
  head: number;
  recent: LedgerRequest[];
  restores: RestoreRow[];
  /** The value to put back in the time field after an error. */
  to?: string;
  result?: string;
  error?: string;
}): string {
  const { urls } = opts;
  const confirm = (id: string) =>
    `<label class="small">Type <code>${esc(urls.slug)}</code> to confirm <input type="text" name="confirm" id="${id}" autocomplete="off" required></label>`;
  const recent = opts.recent
    .map(
      (r) =>
        `<li><span class="muted">${esc(when(r.ts))}</span> ${esc(r.actor)}${r.note ? ` · ${esc(r.note)}` : ""} <span class="muted">(${r.events.length} change${r.events.length === 1 ? "" : "s"})</span></li>`,
    )
    .join("");
  const rows = opts.restores
    .map((r) => {
      const what =
        r.kind === "undo"
          ? `Undid the restore made ${esc(when(r.undoes ? restoreTime(r.undoes) : r.to))} UTC`
          : `Restored to ${esc(when(r.to))} UTC`;
      return `<tr><td><strong>${what}</strong><div class="small muted">${esc(when(r.requested_at))} UTC by ${esc(r.actor)} · ledger was at seq ${r.seq_before}</div></td>
<td class="small"><a href="${esc(urls.nightly(r.export, "bundle.tar"))}">bundle.tar</a> · <a href="${esc(urls.nightly(r.export, "ledger.jsonl"))}">ledger.jsonl</a></td>
<td><form class="inline" method="post" action="${esc(urls.recovery())}"><input type="hidden" name="undo" value="${esc(r.id)}">${confirm(`undo-${esc(r.id)}`)}<button type="submit">Undo</button></form></td></tr>`;
    })
    .join("");
  return `<h1>Recovery</h1>
${opts.result ? `<div class="notice ok">${opts.result}</div>` : ""}
${opts.error ? `<div class="notice">${esc(opts.error)}</div>` : ""}
<div class="panel-box"><h2>Restore this library to a point in time</h2>
<p>Rewinds the whole library, ledger included, to a time 2 minutes to 30 days ago. The current state is exported first, and the restore can be undone. To undo one change, revert it in the <a href="${esc(urls.ledger())}">ledger</a>.</p>
<form method="post" action="${esc(urls.recovery())}">
<p><label class="small">Time (UTC) <input type="datetime-local" name="to" step="1" required value="${esc(opts.to ?? "")}"></label></p>
<p>${confirm("confirm")}</p>
<button class="primary" type="submit">Restore</button></form>
${recent ? `<h2>Recent requests</h2><ul class="small">${recent}</ul>` : ""}</div>
<div class="panel-box"><h2>Past restores</h2>
${rows ? `<div class="table-wrap"><table class="list"><tbody>${rows}</tbody></table></div>` : `<p>None.</p>`}</div>`;
}

/** A restore id (20260930T180211042Z) as an ISO time, to the second. */
function restoreTime(id: string): string {
  return id.replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\d{3}Z(-[0-9a-f]{4})?$/,
    "$1-$2-$3T$4:$5:$6Z",
  );
}

// ---------------------------------------------------------------- tokens

export interface TokenListRow {
  id: string;
  library: string;
  actor: string;
  scope: string;
  prefix: string | null;
  expires: string | null;
  mcp_tiers: string;
  created_by: string | null;
  revoked: string | null;
}

export interface TokenForm {
  library: string;
  actor: string;
  scope: string;
  prefix: string;
  expires: string;
  tiers: string;
}

export function tokensPage(opts: {
  tokens: TokenListRow[];
  libraries: string[];
  human: string;
  form: TokenForm;
  error?: string;
  notice?: string;
}): string {
  const now = Date.now();
  const rows = opts.tokens
    .map((t) => {
      const expired = t.expires !== null && Date.parse(t.expires) <= now;
      const state = t.revoked
        ? chip("revoked", "bad")
        : expired
          ? chip("expired", "warn")
          : chip("active", "ok");
      const revoke =
        t.revoked || expired
          ? ""
          : `<form method="post" action="/tokens/${esc(encodeURIComponent(t.id))}/revoke"><button type="submit">Revoke</button></form>`;
      return `<tr><td class="name"><strong>${esc(t.actor)}</strong><div class="small muted">${esc(t.library)}${t.prefix ? ` · ${esc(t.prefix)}/ only` : ""}${t.mcp_tiers === "files" ? " · file tools only" : ""}</div></td>
<td>${esc(t.scope)}</td><td class="small muted">${t.expires ? `expires ${esc(when(t.expires))}` : "no expiry"}${t.created_by ? `<br>by ${esc(t.created_by)}` : ""}</td>
<td>${state}</td><td>${revoke}</td></tr>`;
    })
    .join("");
  const f = opts.form;
  const libOptions = opts.libraries
    .map((l) => `<option value="${esc(l)}"${l === f.library ? " selected" : ""}>${esc(l)}</option>`)
    .join("");
  const radio = (name: string, value: string, label: string) =>
    `<label class="choice"><input type="radio" name="${name}" value="${value}"${(name === "scope" ? f.scope : f.tiers) === value ? " checked" : ""}> ${label}</label>`;
  return `<h1>Tokens</h1>
${opts.notice ? `<div class="notice ok">${esc(opts.notice)}</div>` : ""}
${rows ? `<div class="table-wrap"><table class="list"><thead><tr><th>Actor</th><th>Access</th><th></th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="muted">No tokens yet.</p>`}
<div class="panel-box"><h2>New token</h2>
${opts.error ? `<div class="notice">${esc(opts.error)}</div>` : ""}
${
  libOptions
    ? `<form class="token" method="post" action="/tokens">
<p><label>Library <select name="library">${libOptions}</select></label></p>
<p><label>Actor <input type="text" name="actor" value="${esc(f.actor)}" placeholder="claude-code/laptop" required></label>
app/label, process:name, or ${esc(opts.human)}</p>
<p>${radio("scope", "write", "Read and write")} ${radio("scope", "read", "Read only")}</p>
<p><label>Directory <input type="text" name="prefix" value="${esc(f.prefix)}" placeholder="whole library"></label>
<label>Expires <input type="date" name="expires" value="${esc(f.expires)}"></label></p>
<p>${radio("tiers", "all", "All MCP tools")} ${radio("tiers", "files", "File tools only")}</p>
<button class="primary" type="submit">Create token</button></form>`
    : `<p class="muted">Create a library first.</p>`
}</div>`;
}

export function tokenCreatedPage(opts: {
  origin: string;
  secret: string;
  actor: string;
  library: string;
}): string {
  const cmd = `claude mcp add --transport http ${opts.library} ${opts.origin}/mcp --header "Authorization: Bearer ${opts.secret}"`;
  return `<h1>Token created</h1>
<p>Shown once. Copy it now.</p>
<p>For <strong>${esc(opts.actor)}</strong> on <strong>${esc(opts.library)}</strong>:</p>
<pre class="src wrap">${esc(opts.secret)}</pre>
<p class="small muted">Claude Code:</p>
<pre class="src wrap">${esc(cmd)}</pre>
<p><a href="/tokens">Back to tokens</a></p>`;
}
