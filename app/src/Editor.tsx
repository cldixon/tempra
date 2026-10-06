/**
 * Editing a concept in the app (tempra-dev: app/editor, TEMPRA-15): the frontmatter as a form,
 * a required one-line note, save with If-Match, and a three-way merge when someone wrote in the
 * meantime. The body itself is edited in the reader (@tempra/editor/view, setEditable).
 */
import {
  type Block,
  conflicts,
  type Doc,
  type FieldMerge,
  fromTree,
  mergeDocs,
  mergeFields,
  reconcile,
  resolve,
  type Segment,
  toHTML,
} from "@tempra/editor";
import { type FormEvent, useState } from "react";
import { ApiError, api } from "./api";
import { baseName, dirOf, enc, type Urls } from "./urls";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type Frontmatter = { [k: string]: Json };

/** A concept as the page loaded it: what an edit starts from. */
export interface Base {
  path: string;
  hash: string;
  doc: Doc;
  frontmatter: Frontmatter;
}

/** Fields the server stamps or keeps: shown, never sent back. */
const STAMPED = new Set(["generated", "verified"]);

export const STATUSES = ["stable", "draft", "deprecated"] as const;

/** A source row in the form; `original` is the source as loaded (its other keys are kept). */
export interface SourceRow {
  id: string;
  title: string;
  resource: string;
  original?: Frontmatter;
}

/** The form's state: the fields people edit, as strings. */
export interface FormState {
  type: string;
  title: string;
  description: string;
  tags: string;
  status: string;
  /** `datetime-local` value (UTC, to the second), or "". */
  staleAfter: string;
  sources: SourceRow[];
}

const str = (v: Json | undefined) => (typeof v === "string" ? v : v == null ? "" : String(v));
const isObject = (v: Json | undefined): v is Frontmatter =>
  v !== null && typeof v === "object" && !Array.isArray(v);

export function formOf(fm: Frontmatter): FormState {
  const stale = str(fm.stale_after);
  const date = stale ? new Date(stale) : null;
  return {
    type: str(fm.type),
    title: str(fm.title),
    description: str(fm.description),
    tags: Array.isArray(fm.tags) ? fm.tags.map(str).join(", ") : str(fm.tags),
    status: str(fm.status) || "stable",
    staleAfter: date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 19) : "",
    sources: Array.isArray(fm.sources)
      ? fm.sources.map((s) => {
          const o = isObject(s) ? s : {};
          return { id: str(o.id), title: str(o.title), resource: str(o.resource), original: o };
        })
      : [],
  };
}

const sameRows = (a: SourceRow[], b: SourceRow[]) =>
  a.length === b.length &&
  a.every((r, i) => {
    const o = b[i];
    return !!o && r.id === o.id && r.title === o.title && r.resource === o.resource;
  });

/**
 * The frontmatter to write: the loaded one without the stamped fields, with what the person
 * changed in the form put over it. A field left as it was keeps its exact loaded value (its
 * spelling, its other keys), so a save, and a merge, only carries real changes; a field emptied
 * is removed.
 */
export function frontmatterOf(base: Frontmatter, form: FormState): Frontmatter {
  const was = formOf(base);
  const out: Frontmatter = {};
  for (const [k, v] of Object.entries(base)) if (!STAMPED.has(k)) out[k] = v;
  const set = (key: string, value: Json | undefined) => {
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
      delete out[key];
    } else out[key] = value;
  };
  const text = (key: "type" | "title" | "description") => {
    if (form[key] !== was[key]) set(key, form[key].trim());
  };
  text("type");
  text("title");
  text("description");
  if (form.tags !== was.tags) {
    set(
      "tags",
      form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    );
  }
  if (form.status !== was.status) set("status", form.status);
  if (form.staleAfter !== was.staleAfter) {
    const v = form.staleAfter.length === 16 ? `${form.staleAfter}:00` : form.staleAfter;
    const date = v ? new Date(`${v}Z`) : null;
    set(
      "stale_after",
      date && !Number.isNaN(date.getTime()) ? `${date.toISOString().slice(0, 19)}Z` : undefined,
    );
  }
  if (!sameRows(form.sources, was.sources)) {
    set(
      "sources",
      form.sources
        .filter((s) => s.resource.trim() || s.id.trim() || s.title.trim())
        .map((s) => {
          const o: Frontmatter = { ...(s.original ?? {}) };
          for (const key of ["id", "title", "resource"] as const) {
            const v = s[key].trim();
            if (v) o[key] = v;
            else delete o[key];
          }
          return o;
        }),
    );
  }
  return out;
}

/** A link target typed or pasted: an app URL into this library becomes its bundle path. */
export function linkTarget(urls: Urls, raw: string): string {
  const text = raw.trim();
  const scheme = /^[a-z][a-z0-9+.-]*:/i.test(text);
  try {
    // Only a full URL or a rooted path can be one of the app's; "#x" and "dir/x.md" are not.
    if (!scheme && !text.startsWith("/")) throw new Error("relative");
    const here = new URL(location.href);
    const url = new URL(text, here);
    const prefix = `/${urls.owner}/${urls.slug}/`;
    if (url.origin === here.origin && url.pathname.startsWith(prefix)) {
      const rest = decodeURIComponent(url.pathname.slice(prefix.length));
      if (rest && !rest.startsWith("-/")) return `/${rest}${url.hash}`;
    }
  } catch {
    // Not a URL: written as it is, below.
  }
  if (scheme || text.startsWith("/") || text.startsWith("#")) {
    return text;
  }
  return `/${text}`;
}

let uploads = 0;

/** Stores an image beside the concept, as its own ledger request; its bundle path and URL. */
export async function uploadImage(urls: Urls, conceptPath: string, file: File) {
  const dir = dirOf(conceptPath);
  const stem = baseName(conceptPath).replace(/\.md$/, "");
  const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? file.type.split("/")[1] ?? "png")
    .toLowerCase()
    .replace("jpeg", "jpg");
  // Two images in the same instant still get names of their own.
  const name = `${stem}-${Date.now().toString(36)}${(++uploads).toString(36)}.${ext}`;
  const path = dir ? `${dir}/${name}` : name;
  await api(urls.api(`files/${enc(path)}`), {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "If-None-Match": "*",
      "X-Note": encodeURIComponent(`Image for ${conceptPath}`),
    },
    body: file,
  });
  return { path, src: urls.download(path) };
}

/** What a save answers. */
export interface Saved {
  hash: string;
  lint: { code: string; message: string }[];
}

/** Writes the concept with If-Match. A 412 comes back as an ApiError with status 412. */
export async function saveConcept(
  urls: Urls,
  path: string,
  ifMatch: string,
  frontmatter: Frontmatter,
  doc: Doc,
  note: string,
): Promise<Saved> {
  const r = await api<{ hash: string | null; lint?: Saved["lint"] }>(
    urls.api(`files/${enc(path)}`),
    {
      method: "PUT",
      headers: { "If-Match": ifMatch, "X-Note": encodeURIComponent(note) },
      body: JSON.stringify({ frontmatter, doc }),
    },
  );
  return { hash: r.hash ?? "", lint: r.lint ?? [] };
}

/** The concept's types in this library, for the type field's suggestions. */
export async function libraryTypes(urls: Urls): Promise<string[]> {
  const s = await api<{ types: Record<string, number> }>(urls.api("summary"));
  return Object.entries(s.types)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t)
    .filter((t) => t !== "(no type)");
}

// ------------------------------------------------------------------ the form

export function FrontmatterForm(props: {
  form: FormState;
  types: string[];
  onChange(form: FormState): void;
  stamped: Frontmatter;
}) {
  const { form, onChange } = props;
  const field = (key: keyof FormState) => (e: { currentTarget: { value: string } }) =>
    onChange({ ...form, [key]: e.currentTarget.value });
  const setSource = (i: number, key: keyof SourceRow, value: string) =>
    onChange({
      ...form,
      sources: form.sources.map((s, j) => (j === i ? { ...s, [key]: value } : s)),
    });
  return (
    <fieldset className="frontmatter-form">
      <legend>Frontmatter</legend>
      <label>
        Type
        <input
          value={form.type}
          onChange={field("type")}
          list="fm-types"
          required
          placeholder="Metric, Decision, …"
        />
      </label>
      <datalist id="fm-types">
        {props.types.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <label>
        Title
        <input value={form.title} onChange={field("title")} />
      </label>
      <label>
        Description
        <input value={form.description} onChange={field("description")} />
      </label>
      <label>
        Tags
        <input value={form.tags} onChange={field("tags")} placeholder="comma, separated" />
      </label>
      <label>
        Status
        <select value={form.status} onChange={field("status")}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label>
        Stale after (UTC)
        <input
          type="datetime-local"
          step={1}
          value={form.staleAfter}
          onChange={field("staleAfter")}
        />
      </label>
      <div>
        Sources
        {form.sources.map((s, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place, by position.
          <div className="source-row" key={i}>
            <input
              aria-label="Source id"
              placeholder="id"
              value={s.id}
              onChange={(e) => setSource(i, "id", e.currentTarget.value)}
            />
            <input
              aria-label="Source title"
              placeholder="title"
              value={s.title}
              onChange={(e) => setSource(i, "title", e.currentTarget.value)}
            />
            <input
              aria-label="Source resource"
              placeholder="URL or /path.md"
              value={s.resource}
              onChange={(e) => setSource(i, "resource", e.currentTarget.value)}
            />
            <button
              type="button"
              onClick={() => onChange({ ...form, sources: form.sources.filter((_, j) => j !== i) })}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            onChange({ ...form, sources: [...form.sources, { id: "", title: "", resource: "" }] })
          }
        >
          Add source
        </button>
      </div>
      {Object.keys(props.stamped).length > 0 && (
        <p className="small muted">
          Set by the server: {Object.keys(props.stamped).join(", ")}. Saving lapses human
          verification.
        </p>
      )}
    </fieldset>
  );
}

// ------------------------------------------------------------------ merging

/** A merge in progress: the body's blocks and the frontmatter fields, against `theirs`. */
export interface Merge {
  theirs: Base;
  segments: Segment<Block>[];
  fields: FieldMerge[];
}

export function startMerge(base: Base, mine: Doc, mineFm: Frontmatter, theirs: Base): Merge {
  const strip = (fm: Frontmatter) =>
    Object.fromEntries(Object.entries(fm).filter(([k]) => !STAMPED.has(k)));
  // The edit's blocks matched to the version it started from, so a block it kept is that block.
  const edited = reconcile(base.doc, structuredClone(mine));
  return {
    theirs,
    segments: mergeDocs(base.doc, edited, theirs.doc),
    fields: mergeFields(strip(base.frontmatter), strip(mineFm), strip(theirs.frontmatter)),
  };
}

type Pick = "mine" | "theirs" | "both";

/** Shows what someone else changed meanwhile; overlapping changes are picked here. */
export function MergeView(props: {
  merge: Merge;
  busy: boolean;
  error: string | null;
  onSave(doc: Doc, frontmatter: Frontmatter): void;
  onCancel(): void;
}) {
  const { merge } = props;
  const body = conflicts(merge.segments);
  const fieldConflicts = merge.fields.filter((f) => f.kind === "conflict");
  // Nothing is picked for the person: each overlap needs a choice before the merge is saved.
  const [picks, setPicks] = useState<(Pick | null)[]>(() => body.map(() => null));
  const [fieldPicks, setFieldPicks] = useState<("mine" | "theirs" | null)[]>(() =>
    fieldConflicts.map(() => null),
  );
  const undecided = picks.includes(null) || fieldPicks.includes(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (undecided) return;
    const doc: Doc = {
      type: "root",
      children: resolve(merge.segments, (i) => picks[i] ?? "mine"),
    };
    const fm: Frontmatter = {};
    let n = 0;
    for (const f of merge.fields) {
      const value =
        f.kind === "same" ? f.value : (fieldPicks[n++] ?? "mine") === "mine" ? f.mine : f.theirs;
      if (value !== undefined) fm[f.key] = value as Json;
    }
    props.onSave(doc, fm);
  };
  const clean = body.length === 0 && fieldConflicts.length === 0;
  return (
    <form className="merge" onSubmit={submit}>
      <h2>Changed while you edited</h2>
      <p className="small">
        Someone saved this concept after you started.{" "}
        {clean
          ? "Your changes and theirs touch different blocks, so they combine."
          : "Pick a side for each place you both changed; everything else combines."}
      </p>
      {fieldConflicts.map((f, i) => (
        <fieldset key={f.key} className="conflict">
          <legend>
            Field <code>{f.key}</code>
          </legend>
          {(["mine", "theirs"] as const).map((side) => (
            <label key={side}>
              <input
                type="radio"
                name={`field-${i}`}
                checked={fieldPicks[i] === side}
                onChange={() => setFieldPicks((p) => p.map((x, j) => (j === i ? side : x)))}
              />{" "}
              {side === "mine" ? "Mine" : "Theirs"}:{" "}
              <code>{JSON.stringify(f.kind === "conflict" ? f[side] : null) ?? "(none)"}</code>
            </label>
          ))}
        </fieldset>
      ))}
      {body.map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: conflicts are positional.
        <fieldset key={i} className="conflict">
          <legend>A block both changed</legend>
          {(["mine", "theirs", "both"] as const).map((side) => (
            <label key={side}>
              <input
                type="radio"
                name={`conflict-${i}`}
                checked={picks[i] === side}
                onChange={() => setPicks((p) => p.map((x, j) => (j === i ? side : x)))}
              />{" "}
              {side === "mine" ? "Mine" : side === "theirs" ? "Theirs" : "Both, mine first"}
              {side !== "both" && <Blocks blocks={c[side]} />}
            </label>
          ))}
        </fieldset>
      ))}
      {props.error && <div className="notice">{props.error}</div>}
      <button className="primary" type="submit" disabled={props.busy || undecided}>
        Save merged
      </button>{" "}
      <button type="button" onClick={props.onCancel} disabled={props.busy}>
        Back to editing
      </button>
    </form>
  );
}

/** One side of a conflict, drawn as the reader draws it (escaped by Wordgard). */
function Blocks({ blocks }: { blocks: Block[] }) {
  if (blocks.length === 0) return <div className="merge-side">(removed)</div>;
  const html = toHTML(fromTree({ type: "root", children: blocks }).doc);
  // biome-ignore lint/security/noDangerouslySetInnerHtml: Wordgard escapes every text and attribute.
  return <div className="merge-side prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** A thrown save error: a 412 means someone wrote meanwhile. */
export const isConflict = (e: unknown) => e instanceof ApiError && e.status === 412;
