/** URLs of the app's pages for one library, optionally pinned to a sequence (v2 spec: URLs). */
export class Urls {
  readonly base: string;
  constructor(
    readonly owner: string,
    readonly slug: string,
    readonly at?: number,
  ) {
    this.base = `/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/`;
  }
  private q() {
    return this.at === undefined ? "" : `?at=${this.at}`;
  }
  pinned(at: number | undefined) {
    return new Urls(this.owner, this.slug, at);
  }
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
  work(kind?: string) {
    return `${this.page("work")}${query({ kind })}`;
  }
  /** The export download (a server redirect to a signed link). */
  exportTar(at?: number) {
    return `${this.page("export")}${query({ at })}`;
  }
  /** A nightly export's file (served by the server from R2). */
  nightly(date: string, file: string) {
    return this.page(`exports/${encodeURIComponent(date)}/${encodeURIComponent(file)}`);
  }
  transfer() {
    return this.page("transfer");
  }
  recovery() {
    return this.page("recovery");
  }
  connect() {
    return this.page("connect");
  }
  remove() {
    return this.page("delete");
  }
  /** The REST API for this library. */
  api(rest: string, params: Record<string, string | number | undefined> = {}) {
    return `/api/v1/libraries/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.slug)}/${rest}${query(params)}`;
  }
}

export interface LedgerFilters {
  prefix?: string;
  actor?: string;
  from?: string;
  to?: string;
  before?: number;
}

export const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

export function query(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function baseName(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function dirOf(path: string) {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}
