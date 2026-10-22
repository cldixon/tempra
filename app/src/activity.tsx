import { useEffect, useState } from "react";
import type { ActedBy, ActorView } from "./agents";
import { api, useLoad } from "./api";
import { Avatar } from "./chrome";
import { ago, plural } from "./ui";
import { baseName, folderName, type Urls } from "./urls";

/*
 * Activity (take 3, TEMPRA-106; tempra-dev: app/activity): the ledger for people. One entry per
 * request, told as a sentence of what it did ("Claude Code changed 3 concepts in The app"), with
 * its note and the concepts it touched. The Activity page draws them grouped by day; the
 * library's home draws the latest few after the seen cursor in a compact form.
 */

/** One ledger event as `GET …/requests` returns it (worker/src/store/store.ts `EventRow`). */
export interface LedgerEvent {
  seq: number;
  ts: string;
  actor: string;
  op: string;
  path: string;
  prev_hash: string | null;
  hash: string | null;
  concept_id: string;
  meta: Record<string, unknown> | null;
}

/** One request with its events, oldest first (`RequestRow`). */
export interface LedgerRequest {
  request_id: string;
  ts: string;
  actor: string;
  note: string | null;
  by?: ActedBy | null;
  events: LedgerEvent[];
}

/** What a request did to one concept or file. */
export type What = "added" | "edited" | "rewrote" | "moved" | "deleted" | "reverted";

/**
 * Words an edit added and removed (the ledger's `meta.words`, on new versions), and how many the
 * text had before, when the ledger kept it.
 */
export interface Words {
  added: number;
  removed: number;
  before?: number;
}

/** An edit that removed more than half of what the text said is a rewrite. */
const rewrote = (w: Words | null) =>
  w !== null && w.before !== undefined && w.before > 0 && w.removed * 2 > w.before;

/** A concept or file a request touched, and what happened to it. */
export interface Touched {
  path: string;
  title: string;
  what: What;
  words: Words | null;
  /** Where a moved file was before. */
  from: string | null;
  /** The last event's sequence (a deleted file is shown as it was just before). */
  seq: number;
}

/** A piece of an entry's sentence: words, a concept to link, or a folder to link. */
export type Part =
  | string
  | { concept: string; title: string; seq: number; gone: boolean; words: Words | null }
  | { folder: string };

/** One request as Activity tells it. */
export interface Entry {
  id: string;
  /** When it ended (its last event). */
  ts: string;
  actor: string;
  by: ActedBy | null;
  /** Its first and last sequence. */
  first: number;
  last: number;
  /** What it did, after the person's name. */
  parts: Part[];
  /** The request's note, or what a comment said, quoted under the sentence. */
  quote: string | null;
  /** Content it changed, in order (not comments or verifications). */
  touched: Touched[];
  /** The sentence names every change itself, so a list beneath would only repeat it. */
  named: boolean;
}

/** A concept's title from the outline, else its file name. */
export function titleOf(path: string, titles: Record<string, string>): string {
  return titles[path] ?? baseName(path).replace(/\.md$/, "");
}

/** "+38 −12 words", or null when nothing changed. */
export function wordsText(w: Words | null): string | null {
  if (!w || (w.added === 0 && w.removed === 0)) return null;
  return `+${w.added} −${w.removed} words`;
}

/** Joins clauses as a person writes a list: "a", "a and b", "a, b and c". */
export function joinParts(clauses: Part[][]): Part[] {
  const out: Part[] = [];
  clauses.forEach((c, i) => {
    if (i > 0) out.push(i === clauses.length - 1 ? " and " : ", ");
    out.push(...c);
  });
  return out;
}

const asWords = (v: unknown): Words | null => {
  const w = v as Partial<Words> | null | undefined;
  if (!w || typeof w.added !== "number" || typeof w.removed !== "number") return null;
  return typeof w.before === "number"
    ? { added: w.added, removed: w.removed, before: w.before }
    : { added: w.added, removed: w.removed };
};

const isConcept = (path: string) => path.endsWith(".md");

/** What a request's content events did, one row per concept, in the order it was first touched. */
export function touchedBy(events: LedgerEvent[], titles: Record<string, string>): Touched[] {
  const byConcept = new Map<string, LedgerEvent[]>();
  for (const e of events) {
    if (e.op === "comment" || e.op === "verify") continue;
    const list = byConcept.get(e.concept_id) ?? [];
    list.push(e);
    byConcept.set(e.concept_id, list);
  }
  const out: Touched[] = [];
  for (const evs of byConcept.values()) {
    const last = evs[evs.length - 1] as LedgerEvent;
    const created = evs.some((e) => (e.op === "put" || e.op === "import") && e.prev_hash === null);
    const counted = evs.map((e) => asWords(e.meta?.words)).filter((w) => w !== null);
    const first = counted[0];
    const words: Words | null =
      counted.length === 0
        ? null
        : {
            added: counted.reduce((n, w) => n + w.added, 0),
            removed: counted.reduce((n, w) => n + w.removed, 0),
            ...(first?.before !== undefined ? { before: first.before } : {}),
          };
    const moved = evs.find((e) => e.op === "move");
    const what: What =
      last.op === "delete" || (last.op === "revert" && last.hash === null)
        ? "deleted"
        : created
          ? "added"
          : evs.some((e) => e.op === "revert")
            ? "reverted"
            : evs.some((e) => e.op === "put" || e.op === "import")
              ? rewrote(words)
                ? "rewrote"
                : "edited"
              : "moved";
    const from = typeof moved?.meta?.from_path === "string" ? moved.meta.from_path : null;
    out.push({
      path: last.path,
      title: titleOf(last.path, titles),
      what,
      words: what === "edited" || what === "rewrote" || what === "reverted" ? words : null,
      from: what === "moved" ? from : null,
      seq: last.seq,
    });
  }
  return out;
}

const conceptPart = (t: Touched, withWords: boolean): Part => ({
  concept: t.path,
  title: t.title,
  seq: t.seq,
  gone: t.what === "deleted",
  words: withWords ? t.words : null,
});

/** " in The app and Decisions", " across 4 folders", or nothing when some are at the top. */
function wherePart(paths: string[]): Part[] {
  const dirs: string[] = [];
  for (const p of paths) {
    const i = p.indexOf("/");
    if (i === -1) return [];
    const d = p.slice(0, i);
    if (!dirs.includes(d)) dirs.push(d);
  }
  if (dirs.length === 0) return [];
  if (dirs.length > 2) return [` across ${dirs.length} folders`];
  return [" in ", ...joinParts(dirs.map((d) => [{ folder: d }]))];
}

/** The content clause: "rewrote A and added B", or "changed 3 concepts in The app". */
function contentClauses(touched: Touched[], imported: boolean): Part[][] {
  if (touched.length === 0) return [];
  const unit = touched.every((t) => isConcept(t.path)) ? "concept" : "file";
  const verbs = [...new Set(touched.map((t) => t.what))];
  if (imported) {
    return [[`imported ${plural(touched.length, unit)}`, ...wherePart(touched.map((t) => t.path))]];
  }
  if (touched.length > 2) {
    const verb = verbs.length === 1 ? verbs[0] : "changed";
    return [[`${verb} ${plural(touched.length, unit)}`, ...wherePart(touched.map((t) => t.path))]];
  }
  return verbs.map((verb) => [
    `${verb} `,
    ...joinParts(touched.filter((t) => t.what === verb).map((t) => [conceptPart(t, true)])),
  ]);
}

/** The comment clauses: "replied on Reader and resolved it", "opened a thread on Tenancy". */
function commentClauses(events: LedgerEvent[], titles: Record<string, string>): Part[][] {
  const threads = new Map<string, { path: string; seq: number; kinds: string[] }>();
  for (const e of events) {
    if (e.op !== "comment") continue;
    const c = e.meta?.comment as { kind?: string; thread?: string } | undefined;
    const id = c?.thread ?? String(e.seq);
    const t = threads.get(id) ?? { path: e.path, seq: e.seq, kinds: [] };
    t.kinds.push(c?.kind ?? "reply");
    threads.set(id, t);
  }
  if (threads.size === 0) return [];
  const on = (t: { path: string; seq: number }): Part => ({
    concept: t.path,
    title: titleOf(t.path, titles),
    seq: t.seq,
    gone: false,
    words: null,
  });
  const list = [...threads.values()];
  if (list.length > 2) {
    const paths = [...new Set(list.map((t) => t.path))];
    const first = list[0] as (typeof list)[number];
    return paths.length === 1
      ? [[`commented ${list.length} times on `, on(first)]]
      : [[`commented on ${plural(paths.length, "concept")}`]];
  }
  return list.map((t) => {
    const k = new Set(t.kinds);
    if (k.has("open")) return ["opened a thread on ", on(t)];
    if (k.has("reply") && k.has("resolve")) return ["replied on ", on(t), " and resolved it"];
    if (k.has("reply")) return ["replied on ", on(t)];
    if (k.has("resolve")) return ["resolved a thread on ", on(t)];
    return ["reopened a thread on ", on(t)];
  });
}

/** The verification clause: "verified A", "verified A and B", "verified A and 2 more". */
function verifyClauses(events: LedgerEvent[], titles: Record<string, string>): Part[][] {
  const seen = new Map<string, LedgerEvent>();
  for (const e of events) if (e.op === "verify") seen.set(e.path, e);
  if (seen.size === 0) return [];
  const items: Part[][] = [...seen.values()].map((e) => [
    { concept: e.path, title: titleOf(e.path, titles), seq: e.seq, gone: false, words: null },
  ]);
  if (items.length > 2)
    return [["verified ", ...(items[0] ?? []), ` and ${items.length - 1} more`]];
  return [["verified ", ...joinParts(items)]];
}

/** The first thing a comment in the request said, on one line and kept short. */
function commentQuote(events: LedgerEvent[]): string | null {
  for (const e of events) {
    const body = (e.meta?.comment as { body?: unknown } | undefined)?.body;
    if (e.op === "comment" && typeof body === "string" && body.trim()) {
      const said = body.replace(/\s+/g, " ").trim();
      return said.length > 160 ? `${said.slice(0, 159)}…` : said;
    }
  }
  return null;
}

/**
 * A request as an Activity entry, or null when nothing of it is left to show (`hideComments`
 * drops comment events, so a request that only commented goes).
 */
export function toEntry(
  r: LedgerRequest,
  titles: Record<string, string>,
  opts: { hideComments?: boolean } = {},
): Entry | null {
  const events = opts.hideComments ? r.events.filter((e) => e.op !== "comment") : r.events;
  const first = events[0];
  const last = events[events.length - 1];
  if (!first || !last) return null;
  const touched = touchedBy(events, titles);
  const imported = events.every((e) => e.op === "import");
  const clauses = [
    ...contentClauses(touched, imported),
    ...commentClauses(events, titles),
    ...verifyClauses(events, titles),
  ];
  return {
    id: r.request_id,
    ts: last.ts,
    actor: r.actor,
    by: r.by ?? null,
    first: first.seq,
    last: last.seq,
    parts: joinParts(clauses),
    quote: r.note?.trim() || commentQuote(events),
    touched,
    named: touched.length <= 2 && !imported,
  };
}

/** Whether a request was made by a person in the app (not by one of their agents). */
export const byPerson = (r: Pick<LedgerRequest, "actor" | "by">) =>
  r.actor.startsWith("human:") && !r.by?.agent;

/** "You and 2 agents", "You, 1 other person and 3 agents", "2 people". */
export function whoWorksHere(you: boolean, people: number, agents: number): string {
  const parts: string[] = [];
  if (you) parts.push("You");
  if (people > 0)
    parts.push(
      you
        ? `${people} other ${people === 1 ? "person" : "people"}`
        : `${people} ${people === 1 ? "person" : "people"}`,
    );
  if (agents > 0) parts.push(plural(agents, "agent"));
  if (parts.length === 0) return "Nobody yet";
  const last = parts.pop() as string;
  return parts.length > 0 ? `${parts.join(", ")} and ${last}` : last;
}

// ---------------------------------------------------------------- every event

/**
 * Every event (take 4, TEMPRA-115): the ledger as a table, one row per event, newest first. The
 * rows come from the same `GET …/requests` pages as the Summary, so each carries its request's
 * note, who acted and whether a person or an agent did.
 */

/** The kinds the table names, in the order the "Any kind" filter lists them. */
export const KINDS = [
  "write",
  "edit",
  "move",
  "delete",
  "comment",
  "verify",
  "revert",
  "import",
] as const;

/** An event's kind as the table names it: a new concept is a write, a new version an edit. */
export function kindOf(e: Pick<LedgerEvent, "op" | "prev_hash">): string {
  if (e.op === "put") return e.prev_hash === null ? "write" : "edit";
  return e.op;
}

/** One row of Every event. */
export interface EventRow {
  event: LedgerEvent;
  request: LedgerRequest;
  kind: string;
  /** What the row says beside the path: a comment's words, where a move came from, the note. */
  note: string;
  /** The first row of its request shown: the one that names who and when. */
  lead: boolean;
}

const oneLine = (s: string, max = 140) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** What an event's row says beside its path. */
export function eventNote(e: LedgerEvent, r: Pick<LedgerRequest, "note">): string {
  if (e.op === "comment") {
    const c = e.meta?.comment as { kind?: string; body?: unknown } | undefined;
    if (typeof c?.body === "string" && c.body.trim()) return oneLine(c.body);
    if (c?.kind === "resolve") return "Resolved a thread";
    if (c?.kind === "reopen") return "Reopened a thread";
  }
  if (e.op === "move" && typeof e.meta?.from_path === "string") {
    const from = e.meta.from_path;
    return r.note?.trim() ? oneLine(r.note) : `From ${from}`;
  }
  return r.note?.trim() ? oneLine(r.note) : "";
}

/** The filters Every event applies in the app (who and the folder go to the server). */
export interface EventFilter {
  who?: "everyone" | "agents" | "people";
  kind?: string;
  /** Text to find in the path or the note, case aside. */
  q?: string;
}

/**
 * Requests (newest first, as the API pages them) as table rows, newest event first, filtered.
 * A request is listed once even when two pages both carry it.
 */
export function eventRows(requests: LedgerRequest[], f: EventFilter = {}): EventRow[] {
  const q = f.q?.trim().toLowerCase() ?? "";
  const ids = new Set<string>();
  const rows: EventRow[] = [];
  for (const r of requests) {
    if (ids.has(r.request_id)) continue;
    ids.add(r.request_id);
    if (f.who === "people" && !byPerson(r)) continue;
    if (f.who === "agents" && byPerson(r)) continue;
    let lead = true;
    for (const e of [...r.events].reverse()) {
      const kind = kindOf(e);
      if (f.kind && kind !== f.kind) continue;
      const note = eventNote(e, r);
      if (q && !e.path.toLowerCase().includes(q) && !note.toLowerCase().includes(q)) continue;
      rows.push({ event: e, request: r, kind, note, lead });
      lead = false;
    }
  }
  return rows;
}

/** How long after an agent's last write it still reads as writing now (the pulsing dot). */
export const LIVE_MS = 60_000;

/** An agent's write seen arriving on the change feed. */
export interface LiveWrite {
  actor: string;
  by: ActedBy | null;
  path: string;
  seq: number;
  /** When it arrived (this browser's clock). */
  at: number;
}

/** Whether an agent's write arrived recently enough to read as writing now. */
export const isLive = (w: Pick<LiveWrite, "at"> | null | undefined, now: number) =>
  !!w && now - w.at < LIVE_MS;

// ---------------------------------------------------------------- times

/** A local day as a key ("2026-10-19"). */
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

const shortDate = (d: Date, now: Date) =>
  d.toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });

const clock = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** "Today", "Yesterday", or the date: the heading of a day's entries (local time). */
export function dayLabel(ts: string, now: number): string {
  const d = new Date(ts);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return "Today";
  if (dayKey(d) === dayKey(yesterday)) return "Yesterday";
  return shortDate(d, today);
}

/** Entries in order, split into days, newest first as they come. */
export function groupByDay<T extends { ts: string }>(
  items: T[],
  now: number,
): { label: string; items: T[] }[] {
  const days: { label: string; items: T[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.ts, now);
    const day = days[days.length - 1];
    if (day?.label === label) day.items.push(item);
    else days.push({ label, items: [item] });
  }
  return days;
}

/**
 * When, beside an entry: "14 min" today, the clock time on an earlier day under its day's
 * heading, or (compact, with no headings) "yesterday" and the date.
 */
export function entryTime(ts: string, now: number, compact = false): string {
  const label = dayLabel(ts, now);
  if (label === "Today") return ago(ts, now);
  if (!compact) return clock(new Date(ts));
  return label === "Yesterday" ? "yesterday" : label;
}

/** A moment as words: "today, 09:12", "yesterday, 18:40", "Oct 12, 18:40". */
export function momentText(ts: string, now: number): string {
  const label = dayLabel(ts, now);
  return `${label === "Today" || label === "Yesterday" ? label.toLowerCase() : label}, ${clock(new Date(ts))}`;
}

const AGO_WORDS: [number, string][] = [
  [86_400, "day"],
  [3600, "hour"],
  [60, "minute"],
];

/** How long ago in words, for a sentence: "just now", "2 hours ago", "3 days ago", "on Oct 12". */
export function agoWords(ts: string, now: number): string {
  const secs = Math.max(0, Math.round((now - Date.parse(ts)) / 1000));
  if (secs >= 30 * 86_400) return `on ${shortDate(new Date(ts), new Date(now))}`;
  for (const [size, unit] of AGO_WORDS) {
    if (secs >= size) return `${plural(Math.floor(secs / size), unit)} ago`;
  }
  return "just now";
}

/** The clock relative times are read against, ticking so "2 min" stays true. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// ---------------------------------------------------------------- data

/** The library's titles by path and its top-level folders, from `GET …/outline`. */
export interface Titles {
  seq: number;
  titles: Record<string, string>;
  folders: string[];
}

/** Titles and top-level folders from the outline (the same index the tree reads). */
export async function loadTitles(urls: Urls): Promise<Titles> {
  const r = await api<{ seq: number; files: { path: string; title?: string | null }[] }>(
    urls.api("outline"),
  );
  const titles: Record<string, string> = {};
  const folders = new Set<string>();
  for (const f of r.files) {
    if (f.title) titles[f.path] = f.title;
    const i = f.path.indexOf("/");
    if (i > 0) folders.add(f.path.slice(0, i));
  }
  return { seq: r.seq, titles, folders: [...folders].sort() };
}

/** One load of a library's titles, shared by home and Activity. */
export function useTitles(urls: Urls) {
  return useLoad(`titles ${urls.base}`, () => loadTitles(urls));
}

// ---------------------------------------------------------------- drawing

/** How many touched concepts an entry lists before "and n more". */
const LISTED = 8;

/** A piece of the sentence: text, or a link to a concept (as it was, when gone) or a folder. */
function PartView({ part, urls, compact }: { part: Part; urls: Urls; compact: boolean }) {
  if (typeof part === "string") return <>{part}</>;
  if ("folder" in part) return <a href={urls.tree(part.folder)}>{folderName(part.folder)}</a>;
  const href = part.gone ? urls.pinned(part.seq - 1).file(part.concept) : urls.file(part.concept);
  const words = compact ? null : wordsText(part.words);
  return (
    <>
      <a href={href}>{part.title}</a>
      {words && <span className="entry-words"> {words}</span>}
    </>
  );
}

/** The concepts an entry touched, each with what happened to it. */
function TouchedList({ touched, urls }: { touched: Touched[]; urls: Urls }) {
  const shown = touched.slice(0, LISTED);
  const more = touched.length - shown.length;
  return (
    <ul className="entry-touched">
      {shown.map((t) => {
        const href = t.what === "deleted" ? urls.pinned(t.seq - 1).file(t.path) : urls.file(t.path);
        const words = wordsText(t.words);
        return (
          <li key={t.path}>
            <span className="entry-what">{t.what}</span>
            <a href={href}>{t.title}</a>
            {words && <span className="entry-words">{words}</span>}
            {t.from && <span className="entry-words">from {t.from}</span>}
          </li>
        );
      })}
      {more > 0 && <li className="entry-more">and {more} more</li>}
    </ul>
  );
}

/**
 * One Activity entry: who (avatar, name, whom an agent acts for), what they did, the note, the
 * concepts touched (unless compact), when, and the solid change dot when it is new since the
 * person looked.
 */
export function EntryRow(props: {
  entry: Entry;
  urls: Urls;
  actor: ActorView;
  now: number;
  isNew: boolean;
  compact?: boolean;
}) {
  const { entry: e, urls, actor, now, isNew, compact = false } = props;
  // A compact entry that names its changes by count lists their titles on a second line.
  const titles = !e.named && compact ? e.touched.slice(0, 3).map((t) => t.title) : [];
  const classes = ["entry", compact ? "compact" : "", isNew ? "new" : ""].filter(Boolean);
  return (
    <article className={classes.join(" ")}>
      <Avatar name={actor.mark} agent={actor.agent} />
      <div className="entry-body">
        <p className="entry-line">
          <b className="entry-who">{actor.name}</b>
          {actor.for && <span className="entry-for"> for {actor.for}</span>}{" "}
          {e.parts.map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one sentence, fixed.
            <PartView key={i} part={p} urls={urls} compact={compact} />
          ))}
        </p>
        {e.quote && <q className="entry-note">{e.quote}</q>}
        {titles.length > 0 && (
          <p className="entry-titles">
            {titles.join(" · ")}
            {e.touched.length > titles.length ? ` · ${e.touched.length - titles.length} more` : ""}
          </p>
        )}
        {!compact && !e.named && <TouchedList touched={e.touched} urls={urls} />}
      </div>
      <span className="entry-side">
        <time dateTime={e.ts}>{entryTime(e.ts, now, compact)}</time>
        {isNew && (
          <span className="change-dot">
            <span className="visually-hidden">New since you looked</span>
          </span>
        )}
      </span>
    </article>
  );
}

/**
 * The live entry at the top of the Summary: an agent writing now ("Claude Code is editing
 * Reader"), with the pulsing dot, while its writes keep arriving.
 */
export function LiveEntry(props: {
  write: LiveWrite;
  urls: Urls;
  actor: ActorView;
  title: string;
}) {
  const { write: w, urls, actor } = props;
  return (
    <article className="entry live" aria-live="polite">
      <Avatar name={actor.mark} agent={actor.agent} />
      <div className="entry-body">
        <p className="entry-line">
          <b className="entry-who">{actor.name}</b>
          {actor.for && <span className="entry-for"> for {actor.for}</span>} is editing{" "}
          <a href={urls.file(w.path)}>{props.title}</a>
        </p>
      </div>
      <span className="entry-side entry-now">
        <span className="change-dot live" aria-hidden="true" />
        now
      </span>
    </article>
  );
}
