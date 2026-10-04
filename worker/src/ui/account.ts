import type { User } from "../accounts";
import type { Limits } from "../limits";
import type { SessionInfo } from "../session";
import { esc, when } from "./layout";
import type { Urls } from "./views";

/**
 * First run, connecting an agent, the account page and deletion (v2 spec: Onboarding, A2).
 * Plain HTML with browser defaults, as little text as works (v2 spec: UI rule for Phase A).
 */

export const SKILL_URL = "https://github.com/cldixon/tempra/blob/main/skills/okf/SKILL.md";

const err = (e?: string) => (e ? `<p><strong>${esc(e)}</strong></p>` : "");

export function welcomePage(opts: {
  handle: string;
  library: string;
  starter: boolean;
  error?: string;
}): string {
  return `<h1>Welcome</h1>
${err(opts.error)}
<form method="post" action="/welcome">
<p><label>Handle <input type="text" name="handle" value="${esc(opts.handle)}" required></label></p>
<p><label>First library <input type="text" name="library" value="${esc(opts.library)}" required></label></p>
<p><label><input type="checkbox" name="starter" value="1"${opts.starter ? " checked" : ""}> Add a start-here note</label></p>
<p><button type="submit">Create</button></p>
</form>`;
}

/** The starter concept a first library may begin with. */
export const STARTER = `---
type: Guide
title: Start here
description: What this library is and how to add to it.
---
This library holds concepts: one markdown file per idea, with YAML frontmatter.

Connect an agent, then ask it to read this note and add what you know.
`;

export interface AgentWrite {
  actor: string;
  ts: string;
  note: string | null;
}

/** How to connect each kind of client; `slug` names the library when the page is about one. */
function connectSteps(mcp: string, slug?: string): string {
  const pick = slug
    ? `choose All libraries, or select ${esc(slug)}`
    : "choose All libraries, or select the ones it may use";
  return `<h2>claude.ai</h2>
<p>Add a custom connector with this URL. When asked, ${pick}.</p>
<pre>${esc(mcp)}</pre>
<h2>Claude Code</h2>
<pre>claude mcp add --transport http tempra ${esc(mcp)}</pre>
<p>Then run /mcp in Claude Code to sign in.</p>
<h2>Other clients</h2>
<p><a href="/tokens${slug ? `?library=${esc(encodeURIComponent(slug))}` : ""}">Create a token</a></p>
<h2>Skill</h2>
<p><a href="${SKILL_URL}">SKILL.md</a></p>`;
}

/** /connect: connecting an agent to the account (connections reach all or selected libraries). */
export function accountConnectPage(opts: { mcp: string }): string {
  return `<h1>Connect an agent</h1>
<p>One connection can reach all your libraries, or the ones you select.</p>
${connectSteps(opts.mcp)}
<h2>Connected apps</h2>
<p><a href="/apps">See and revoke connections</a></p>`;
}

/** A library's Connect tab: the same steps naming it, and whether an agent has written yet. */
export function connectPage(opts: { urls: Urls; mcp: string; latest: AgentWrite | null }): string {
  const { urls } = opts;
  const status = opts.latest
    ? `Last agent write: ${esc(opts.latest.actor)}, ${esc(when(opts.latest.ts))} UTC${opts.latest.note ? `, "${esc(opts.latest.note)}"` : ""}. <a href="${esc(urls.ledger())}">Ledger</a>`
    : `No agent has written yet. <a href="${esc(urls.connect())}">Refresh</a>`;
  return `<h1>Connect an agent</h1>
<p>Connections belong to your account. <a href="/connect">Connect an agent</a> covers every library.</p>
${connectSteps(opts.mcp, urls.slug)}
<h2>Status</h2>
<p id="status">${status}</p>`;
}

export function accountPage(opts: {
  user: User;
  sessions: SessionInfo[];
  current: string | null;
  usage: { libraries: number; tokens: number };
  limits: Limits;
  notice?: string;
  error?: string;
  /** Local dev: the email-change link, shown instead of mailed. */
  devLink?: string;
}): string {
  const { user } = opts;
  const rows = opts.sessions
    .map(
      (
        s,
      ) => `<tr><td>${esc(when(s.created))}</td><td>${esc(when(s.last_seen))}</td><td>${esc(s.user_agent ?? "")}</td>
<td>${
        s.id === opts.current
          ? "this device"
          : `<form method="post" action="/account/sessions/end"><input type="hidden" name="id" value="${esc(s.id)}"><button type="submit">Sign out</button></form>`
      }</td></tr>`,
    )
    .join("");
  return `<h1>Account</h1>
${opts.notice ? `<p>${esc(opts.notice)}</p>` : ""}${err(opts.error)}
${opts.devLink ?? ""}
<form method="post" action="/account/email">
<p><label>Email <input type="text" name="email" value="${esc(user.email)}" required></label> <button type="submit">Change</button></p>
</form>
<form method="post" action="/account/handle">
<p><label>Handle <input type="text" name="handle" value="${esc(user.handle)}" required></label> <button type="submit">Change</button></p>
</form>
<p>Actor: ${esc(user.actor)}</p>
<h2>Limits</h2>
<p>Libraries: ${opts.usage.libraries} of ${opts.limits.libraries}. Active tokens: ${opts.usage.tokens} of ${opts.limits.tokens}.</p>
<h2>Sessions</h2>
<table><tr><th>Started</th><th>Last seen</th><th>Device</th><th></th></tr>${rows}</table>
<form method="post" action="/sign-out"><button type="submit">Sign out</button></form>
<form method="post" action="/sign-out/everywhere"><button type="submit">Sign out everywhere</button></form>
<h2>Delete account</h2>
<p>Deletes every library you own. Export them first.</p>
<form method="post" action="/account/delete">
<p><label>Type ${esc(user.handle)} to confirm <input type="text" name="confirm" autocomplete="off" required></label></p>
<p><button type="submit">Delete account</button></p>
</form>
<p><a href="/terms">Terms</a> | <a href="/privacy">Privacy</a></p>`;
}

export function emailConfirmPage(t: string): string {
  return `<h1>Confirm your new email</h1>
<form method="post" action="/account/email/confirm">
<input type="hidden" name="t" value="${esc(t)}">
<p><button type="submit">Confirm</button></p>
</form>`;
}

export function deleteLibraryPage(opts: { urls: Urls; error?: string }): string {
  const { urls } = opts;
  return `<h1>Delete ${esc(urls.slug)}</h1>
${err(opts.error)}
<p>Deletes every concept, attachment, export and token of this library. <a href="${esc(urls.exportTar())}">Export it first</a>.</p>
<form method="post" action="${esc(urls.remove())}">
<p><label>Type ${esc(urls.slug)} to confirm <input type="text" name="confirm" autocomplete="off" required></label></p>
<p><button type="submit">Delete library</button></p>
</form>`;
}
