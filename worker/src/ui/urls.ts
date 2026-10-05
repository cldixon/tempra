/**
 * The URLs of a library's pages that the server still answers itself (downloads, raw markdown,
 * redirects); the app's own URLs are in app/src/urls.ts (v2 spec: URLs).
 */
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
  /** Directories and files sit at their own path, unless it starts with the pages' `-/`. */
  private own(path: string) {
    return path === "-" || path.startsWith("-/") ? null : `${this.base}${enc(path)}`;
  }
  tree(dir: string) {
    if (dir === "") return `${this.base}${this.q()}`;
    return `${this.own(dir) ?? `${this.base}-/tree/${enc(dir)}`}/${this.q()}`;
  }
  raw(path: string) {
    return `${this.base}-/raw/${enc(path)}${this.q()}`;
  }
  download(path: string) {
    return `${this.base}-/download/${enc(path)}${this.q()}`;
  }
}

const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
