/**
 * What a preview is seeded with (TEMPRA-109; tempra-dev: delivery/preview-deployments, Seed
 * library): a copy of a real library the operator maintains, exported over the API from where it
 * lives and imported into the preview, or, with none configured, Google's four sample bundles.
 * Free of side effects and of Cloudflare, so the decision and the copy are tested in process.
 *
 *   PREVIEW_SEED_LIBRARY  owner/slug of the library to copy (a repository variable in CI)
 *   PREVIEW_SEED_TOKEN    a read-only token on it (a secret in CI; never printed)
 *   PREVIEW_SEED_URL      where it lives (default https://app.tempra.dev)
 */

export const DEFAULT_SEED_URL = "https://app.tempra.dev";

/** A library over the REST API: its deployment, path and a token on it. */
export interface RemoteLibrary {
  url: string;
  owner: string;
  slug: string;
  token: string;
}

export type SeedChoice =
  | { kind: "library"; source: RemoteLibrary }
  | { kind: "samples"; reason: string; warn: boolean };

const LIBRARY = /^([a-z0-9][a-z0-9_-]*)\/([a-z0-9][a-z0-9_-]*)$/i;

/**
 * The seed library from the environment, or the samples and why. A library with no token (a run
 * without secrets) falls back with a warning; a malformed library or URL is the operator's mistake
 * and fails.
 */
export function seedChoice(env: Record<string, string | undefined>): SeedChoice {
  const library = env.PREVIEW_SEED_LIBRARY?.trim();
  if (!library) {
    return { kind: "samples", reason: "no PREVIEW_SEED_LIBRARY is set", warn: false };
  }
  const m = LIBRARY.exec(library);
  if (!m?.[1] || !m[2]) {
    throw new Error(`PREVIEW_SEED_LIBRARY must be owner/slug, not ${JSON.stringify(library)}.`);
  }
  const token = env.PREVIEW_SEED_TOKEN?.trim();
  if (!token) {
    return {
      kind: "samples",
      reason: `PREVIEW_SEED_LIBRARY is ${library} but PREVIEW_SEED_TOKEN is not set`,
      warn: true,
    };
  }
  const raw = env.PREVIEW_SEED_URL?.trim() || DEFAULT_SEED_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`PREVIEW_SEED_URL is not a URL: ${JSON.stringify(raw)}.`);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error(`PREVIEW_SEED_URL must be https (http only for localhost): ${raw}.`);
  }
  return {
    kind: "library",
    source: { url: url.origin, owner: m[1], slug: m[2], token },
  };
}

export interface CopyOptions {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  /** How many times a 5xx is tried before giving up. */
  attempts?: number;
}

const base = (lib: RemoteLibrary) =>
  `${lib.url}/api/v1/libraries/${encodeURIComponent(lib.owner)}/${encodeURIComponent(lib.slug)}`;

const auth = (lib: RemoteLibrary) => ({ Authorization: `Bearer ${lib.token}` });

/**
 * Imports a bundle into `target` unless it already has files, so a re-run or a later push keeps
 * what is there. `bundle` is called only when an import is needed. A library's Durable Object,
 * new in a namespace created moments ago by the deploy, can answer 5xx for a few seconds (PR #52's
 * first preview): those are retried, checking the library is still empty first, so a retried
 * import never doubles one that went through.
 */
export async function importIfEmpty(
  target: RemoteLibrary,
  bundle: () => Promise<{ bytes: Uint8Array; source: string }>,
  opts: CopyOptions = {},
): Promise<"imported" | "kept"> {
  const f = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? Bun.sleep;
  const log = opts.log ?? console.log;
  const attempts = opts.attempts ?? 4;
  const lib = base(target);
  let body: { bytes: Uint8Array; source: string } | undefined;
  for (let attempt = 1; ; attempt++) {
    const tree = await f(`${lib}/tree`, { headers: auth(target) });
    if (tree.ok) {
      const { entries } = (await tree.json()) as { entries?: unknown[] };
      if ((entries ?? []).length > 0) return "kept";
      body ??= await bundle();
      const imp = await f(`${lib}/import?source=${encodeURIComponent(body.source)}`, {
        method: "POST",
        headers: { ...auth(target), "Content-Type": "application/x-tar" },
        body: body.bytes as unknown as BodyInit,
      });
      if (imp.ok) return "imported";
      if (imp.status < 500 || attempt >= attempts) {
        throw new Error(
          `import into ${target.owner}/${target.slug}: ${imp.status} ${await imp.text()}`,
        );
      }
    } else if (tree.status < 500 || attempt >= attempts) {
      throw new Error(
        `tree of ${target.owner}/${target.slug}: ${tree.status} ${await tree.text()}`,
      );
    }
    log(`${target.owner}/${target.slug} not ready (attempt ${attempt}); retrying`);
    await sleep(2000 * 2 ** (attempt - 1));
  }
}

/** The source library's bundle at head as a tar, and a `source` naming where and when it was. */
export async function exportLibrary(
  source: RemoteLibrary,
  opts: CopyOptions = {},
): Promise<{ bytes: Uint8Array; source: string; seq: number }> {
  const f = opts.fetch ?? fetch;
  const r = await f(`${base(source)}/export`, { headers: auth(source) });
  if (!r.ok) {
    // The body is the API's error; the token is never part of it.
    throw new Error(
      `export of ${source.owner}/${source.slug} from ${source.url}: ${r.status} ${await r.text()}`,
    );
  }
  const bytes = new Uint8Array(await r.arrayBuffer());
  const seq = Number(r.headers.get("X-Seq") ?? 0);
  const host = new URL(source.url).host;
  return { bytes, seq, source: `${host}/${source.owner}/${source.slug}@${seq}` };
}

/**
 * Copies `source` into `target` (an empty library on the preview): the bundle at head through
 * export and import, as one import request. Keeps a target that already has files.
 */
export async function copyLibrary(
  source: RemoteLibrary,
  target: RemoteLibrary,
  opts: CopyOptions = {},
): Promise<"imported" | "kept"> {
  return importIfEmpty(target, () => exportLibrary(source, opts), opts);
}
