import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { href as designHref } from "@tempra/design";
import type { LibraryRef } from "../accounts";

/** Escapes text for HTML; every client-supplied string passes through here. */
export const esc = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} - Tempra</title>
<link rel="stylesheet" href="${designHref}"></head>
<body><main>${body}</main></body></html>`;
}

export interface ConsentForm {
  /** All of the account's libraries, including later ones, or the selected ones only. */
  libraries: "all" | "selected";
  /** Slugs of the selected libraries. */
  selected: string[];
  newLibrary: string;
  access: "read" | "write";
  prefix: string;
  actor: string;
  tiers: "all" | "files";
}

/** The consent page (spec: Apps under Auth): what the app is, where tokens go, what it may do. */
export function consentPage(opts: {
  details: ConsentDescription;
  handle: string;
  signedInAs: string;
  libraries: LibraryRef[];
  form: ConsentForm;
  error?: string;
}): string {
  const { details, form } = opts;
  const name = esc(details.clientName || "An app");
  const origin = details.clientDomain
    ? `Published by <strong>${esc(details.clientDomain)}</strong>.`
    : "This app registered itself; its name is not verified.";
  const libChecks = opts.libraries
    .map(
      (l) =>
        `<label><input type="checkbox" name="library" value="${esc(l.slug)}"${form.selected.includes(l.slug) ? " checked" : ""}> ${esc(l.owner)}/${esc(l.slug)}</label><br>`,
    )
    .join("");
  const radio = (field: string, value: string, current: string, label: string, hint: string) =>
    `<label><input type="radio" name="${field}" value="${value}"${value === current ? " checked" : ""}> ${label}</label>${hint ? ` <small>${hint}</small>` : ""}<br>`;
  return page(
    `Connect ${details.clientName || "an app"}`,
    `<h1>Connect ${name} to your libraries</h1>
<p>Signed in as ${esc(opts.signedInAs)}. ${origin} Access goes to <strong>${esc(details.redirectHost)}</strong>.</p>
${details.redirectIsLoopback ? "<p><strong>This sends access to an app on your computer. Continue only if you just started connecting from it.</strong></p>" : ""}
${opts.error ? `<p><strong>${esc(opts.error)}</strong></p>` : ""}
<form method="post">
  <input type="hidden" name="handle" value="${esc(opts.handle)}">
  <fieldset>
    <legend>Libraries</legend>
    ${radio("libraries", "all", form.libraries, "All libraries", "including ones you create later")}
    ${radio("libraries", "selected", form.libraries, "Only selected libraries", "")}
    ${libChecks}
    <label class="field" for="new_library">New library (optional)</label>
    <input type="text" id="new_library" name="new_library" value="${esc(form.newLibrary)}" placeholder="e.g. team-notes">
  </fieldset>
  <fieldset>
    <legend>Access</legend>
    ${radio("access", "read", form.access, "Read only", "")}
    ${radio("access", "write", form.access, "Read and write", "")}
  </fieldset>
  <fieldset>
    <label class="field" for="prefix">Limit writes to a directory in each library (optional)</label>
    <input type="text" id="prefix" name="prefix" value="${esc(form.prefix)}" placeholder="e.g. notes">
  </fieldset>
  <fieldset>
    <label class="field" for="actor">Name in the ledger</label>
    <input type="text" id="actor" name="actor" value="${esc(form.actor)}">
  </fieldset>
  <fieldset>
    <legend>Tools</legend>
    ${radio("tiers", "all", form.tiers, "All tools", "")}
    ${radio("tiers", "files", form.tiers, "File tools only", "")}
  </fieldset>
  <div class="actions">
    <button class="primary" name="decision" value="approve">Connect</button>
    <button name="decision" value="deny">Cancel</button>
  </div>
</form>`,
  );
}

/** What /apps shows for a grant's libraries, by their current names. */
export function messagePage(title: string, message: string, status = 200) {
  return new Response(page(title, `<h1>${esc(title)}</h1><p>${esc(message)}</p>`), {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY" },
  });
}
