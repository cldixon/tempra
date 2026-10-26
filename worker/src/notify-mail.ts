import type { Accounts, ReachableLibrary } from "./accounts";
import type { Item, Notifications, Prefs } from "./notify";
import { esc } from "./oauth/pages";
import type { Mailer } from "./signin";

/**
 * Notification mail (TEMPRA-74): what is addressed to a person, batched so a burst is one mail,
 * and an opt-in daily digest. Every mail carries a one-click unsubscribe (RFC 8058) and counts
 * against the person's daily cap. Free of Worker APIs: the cron and tests drive it.
 */

/** A batch waits this long after its newest item, so a burst of replies is one mail... */
export const QUIET_MS = 2 * 60_000;
/** ...but no longer than this after its oldest. */
export const MAX_WAIT_MS = 10 * 60_000;

export interface MailDeps {
  accounts: Accounts;
  notifications: Notifications;
  mailer: Mailer | null;
  /** The app's origin for links: https://app.tempra.dev. */
  origin: string;
  now: Date;
  meter?: (e: { kind: "email"; account: string }) => void;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Whether a library's mail of this kind is on: its override, else the account's setting. */
export function wants(prefs: Prefs, library: string | null, kind: "immediate" | "digest"): boolean {
  const own = library ? prefs.libraries.find((l) => l.library === library) : undefined;
  return own?.[kind] ?? prefs[kind];
}

const KIND_TEXT: Record<string, string> = {
  reply: "replied",
  mention: "mentioned you",
  invitation: "invited you",
};

/** Who did it, as people read it: @ann for a person, the actor otherwise. */
const who = (actor: string) => actor.replace(/^human:/, "@");

/** Where an item leads in the app. */
export function itemLink(origin: string, i: Pick<Item, "kind" | "place" | "path">): string {
  if (i.kind === "invitation") return `${origin}/invitations`;
  if (!i.path) return `${origin}/${i.place}/`;
  const path = i.path.split("/").map(encodeURIComponent).join("/");
  return `${origin}/${i.place}/${path}#comments`;
}

function itemLine(i: Item): string {
  const where = i.path ? ` on ${i.path}` : "";
  return `${who(i.actor)} ${KIND_TEXT[i.kind] ?? i.kind}${where} in ${i.place}`;
}

export interface Composed {
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

/** The unsubscribe link and headers every notification mail carries. */
function footer(origin: string, key: string) {
  const unsubscribe = `${origin}/unsubscribe?k=${key}`;
  const settings = `${origin}/account#notifications`;
  return {
    text: `\n--\nMail settings: ${settings}\nUnsubscribe from all notification mail: ${unsubscribe}\n`,
    html: `<hr><p><small><a href="${esc(settings)}">Mail settings</a> · <a href="${esc(unsubscribe)}">Unsubscribe</a></small></p>`,
    // Mail providers reject non-https unsubscribe URIs; local dev has none to send anyway.
    headers: origin.startsWith("https:")
      ? {
          "List-Unsubscribe": `<${unsubscribe}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        }
      : ({} as Record<string, string>),
  };
}

/** One mail for a person's batch of items: plain text plus minimal HTML. */
export function composeBatch(origin: string, key: string, items: Item[]): Composed {
  const first = items[0];
  const subject =
    items.length === 1 && first
      ? `${who(first.actor)} ${KIND_TEXT[first.kind] ?? first.kind}${first.path ? ` on ${first.path}` : ""}`
      : `${items.length} new in your Tempra inbox`;
  const text = items
    .map((i) => `${itemLine(i)}:\n${i.excerpt ? `  ${i.excerpt}\n` : ""}  ${itemLink(origin, i)}\n`)
    .join("\n");
  const html = `<ul>${items
    .map(
      (i) =>
        `<li><p><a href="${esc(itemLink(origin, i))}">${esc(itemLine(i))}</a></p>${i.excerpt ? `<p>${esc(i.excerpt)}</p>` : ""}</li>`,
    )
    .join("")}</ul>`;
  const f = footer(origin, key);
  return {
    subject,
    text: `${text}\nYour inbox: ${origin}/inbox\n${f.text}`,
    html: `${html}<p><a href="${esc(`${origin}/inbox`)}">Your inbox</a></p>${f.html}`,
    headers: f.headers,
  };
}

/** Sends one notification mail within the person's cap; false when capped or it failed. */
async function deliver(
  d: MailDeps,
  user: { id: string; email: string; handle: string },
  compose: (key: string) => Composed,
): Promise<"sent" | "capped" | "failed"> {
  if (!d.mailer) return "failed";
  if (!(await d.notifications.takeMailSlot(user.id, day(d.now)))) return "capped";
  const m = compose(await d.notifications.unsubscribeKey(user.id));
  try {
    await d.mailer.send({ to: user.email, ...m });
    d.meter?.({ kind: "email", account: user.handle });
    return "sent";
  } catch (e) {
    console.error(JSON.stringify({ mail_failed: "notification", error: String(e) }));
    await d.notifications.recordFailure(day(d.now));
    return "failed";
  }
}

/**
 * The immediate mail (the 5-minute cron): one mail per person for what waits, once their batch
 * is quiet (or has waited long enough). Items already read in the app, from libraries whose mail
 * is off, or from libraries the person no longer reaches are skipped, never mailed later. `force`
 * sends what waits now (the dev outbox's Send now).
 */
export async function flushMail(d: MailDeps, opts: { force?: boolean } = {}) {
  const now = d.now.getTime();
  const out = { mails: 0, items: 0, skipped: 0, waiting: 0 };
  for (const { user: id, items } of await d.notifications.pendingMail()) {
    const newest = Math.max(...items.map((i) => Date.parse(i.created)));
    const oldest = Math.min(...items.map((i) => Date.parse(i.created)));
    if (!opts.force && now - newest < QUIET_MS && now - oldest < MAX_WAIT_MS) {
      out.waiting += items.length;
      continue;
    }
    const user = await d.accounts.account(id);
    const prefs = await d.notifications.prefs(id);
    const reach = user ? new Set((await d.accounts.reachable(id)).map((l) => l.id)) : new Set();
    const send = items.filter(
      (i) =>
        user &&
        i.read_at === null &&
        i.done_at === null &&
        (i.library === null || (reach.has(i.library) && wants(prefs, i.library, "immediate"))),
    );
    const skip = items.filter((i) => !send.includes(i)).map((i) => i.id);
    let sent: string[] = [];
    if (user && send.length > 0) {
      const r = await deliver(d, user, (key) => composeBatch(d.origin, key, send));
      if (r === "sent") {
        sent = send.map((i) => i.id);
        out.mails++;
        out.items += sent.length;
      } else skip.push(...send.map((i) => i.id));
    }
    await d.notifications.setMail(sent, "sent");
    await d.notifications.setMail(skip, "skipped");
    out.skipped += skip.length;
  }
  return out;
}

/** One library's digest counts (LibraryStore.digest). */
export interface LibraryDigest {
  head: number;
  changes: { people: number; agents: number };
  threads: { opened: number; resolved: number };
  health: Record<string, number>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The health summary's counts, as the digest words them (one, many). */
const HEALTH_WORDS: Record<string, [string, string]> = {
  stale: ["stale", "stale"],
  stale_soon: ["stale soon", "stale soon"],
  broken_link: ["broken link", "broken links"],
  lint: ["lint", "lint"],
  external_image: ["page with hotlinked images", "pages with hotlinked images"],
  structure: ["structure finding", "structure findings"],
  comment: ["open comment", "open comments"],
  unverified: ["unverified", "unverified"],
};

/** One library's lines in the digest; null when nothing happened there. */
export function digestLines(lib: ReachableLibrary, g: LibraryDigest): string[] | null {
  const { changes, threads, health } = g;
  if (changes.people + changes.agents + threads.opened + threads.resolved === 0) return null;
  const lines = [`${lib.owner}/${lib.slug}`];
  if (changes.people + changes.agents > 0) {
    lines.push(
      `  ${plural(changes.people, "change")} by people, ${plural(changes.agents, "change")} by agents`,
    );
  }
  if (threads.opened + threads.resolved > 0) {
    lines.push(`  ${plural(threads.opened, "thread")} opened, ${threads.resolved} resolved`);
  }
  // Where the library stands: its health summary (TEMPRA-66).
  const now = Object.entries(health)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => {
      const [one, many] = HEALTH_WORDS[k] ?? [k.replace(/_/g, " "), k.replace(/_/g, " ")];
      return `${n} ${n === 1 ? one : many}`;
    });
  if (now.length > 0) lines.push(`  Now: ${now.join(", ")}`);
  return lines;
}

export interface DigestDeps extends MailDeps {
  /** A library's digest counts since a time, by its Durable Object name. */
  digest(doId: string, since: string): Promise<LibraryDigest>;
}

/**
 * The daily digest (opt-in, from the daily cron): per library the person reaches with the digest
 * on, what happened since their last digest (or a day). Each library is asked once, however many
 * people's digests it is in. Nothing happened anywhere: no mail.
 */
export async function sendDigests(d: DigestDeps) {
  const out = { mails: 0, people: 0 };
  const dayAgo = new Date(d.now.getTime() - 86_400_000).toISOString();
  const cache = new Map<string, Promise<LibraryDigest | null>>();
  const counts = (doId: string, since: string) => {
    const key = `${doId}|${since}`;
    let p = cache.get(key);
    if (!p) {
      p = d.digest(doId, since).catch((e) => {
        console.error(JSON.stringify({ digest_failed: doId, error: String(e) }));
        return null;
      });
      cache.set(key, p);
    }
    return p;
  };
  for (const id of await d.notifications.digestUsers()) {
    const user = await d.accounts.account(id);
    if (!user) continue;
    out.people++;
    const prefs = await d.notifications.prefs(id);
    const last = await d.notifications.digestAt(id);
    // A day at most, so a long-quiet account does not get its whole history.
    const since = last && last > dayAgo ? last : dayAgo;
    const sections: string[][] = [];
    for (const lib of await d.accounts.reachable(id)) {
      if (!wants(prefs, lib.id, "digest")) continue;
      const g = await counts(lib.do_id, since);
      const lines = g ? digestLines(lib, g) : null;
      if (lines) sections.push([...lines, `  ${d.origin}/${lib.owner}/${lib.slug}/-/ledger`]);
    }
    if (sections.length === 0) continue;
    const r = await deliver(d, user, (key) => {
      const f = footer(d.origin, key);
      const body = sections.map((s) => s.join("\n")).join("\n\n");
      return {
        subject: `Tempra digest: ${plural(sections.length, "library", "libraries")}`,
        text: `What happened in your libraries since ${since.slice(0, 16).replace("T", " ")} UTC.\n\n${body}\n${f.text}`,
        html: `<p>What happened in your libraries since ${esc(since.slice(0, 16).replace("T", " "))} UTC.</p>${sections
          .map(
            (s) =>
              `<p><strong>${esc(s[0] ?? "")}</strong><br>${s
                .slice(1, -1)
                .map((l) => esc(l.trim()))
                .join("<br>")}<br><a href="${esc((s.at(-1) ?? "").trim())}">Ledger</a></p>`,
          )
          .join("")}${f.html}`,
        headers: f.headers,
      };
    });
    if (r === "sent") {
      out.mails++;
      await d.notifications.setDigestAt(id, d.now.toISOString());
    }
  }
  return out;
}

// ---------------------------------------------------------------- local dev

/**
 * Local dev (DEV_SIGNIN=1): notification mail is kept here and shown at /_dev/mail instead of
 * being sent, as sign-in links are shown on the page. One isolate in `cf dev`; newest first.
 */
export const devOutbox: (Parameters<Mailer["send"]>[0] & { at: string })[] = [];

export const devMailer: Mailer = {
  async send(m) {
    devOutbox.unshift({ ...m, at: new Date().toISOString() });
    devOutbox.length = Math.min(devOutbox.length, 100);
    console.log(`Mail for ${m.to}: ${m.subject}`);
  },
};
