---
name: okf
description: Read and maintain an OKF (Open Knowledge Format) knowledge library through the Tempra MCP server. Use when the Tempra MCP tools (start, browse, read, write, edit, …) are connected, or when asked to look something up in, add to, or clean up the team's knowledge base.
---

# Working in an OKF library

## What OKF is

- A library (an OKF bundle) is a tree of markdown **concepts**, one idea per file, each with YAML frontmatter.
- `type` is the only required key. `title`, a one-line `description`, `tags` and `resource` (the URI of the asset described) are recommended.
- Concepts link to each other with ordinary markdown links. Absolute bundle links (`/tables/orders.md`) are preferred.
- `sources` lists what a concept was derived from. Individual claims cite a source with a footnote whose label is a `sources[].id`: `…is sharded daily.[^ga4-schema]`. A `resource` inside the library (`/policies/margin-standard.md`) is tracked like a link: it follows moves and is flagged when missing.
- Trust: `generated` records who wrote the current content (stamped by the server). `verified` records who checked it (a human or a process, never you). The trust tier is derived from these: unverified, machine-confirmed, or human-reviewed.
- Lifecycle: `status` is `draft`, `stable` (default) or `deprecated`. `stale_after` is the instant the content should be re-checked: a full datetime with an offset (`2026-12-31T00:00:00Z`), not a plain date.
- `index.md` (directory listings) and `log.md` (history) are synthesized by the server. Never write them.

Every write is attributed to your token's actor and recorded in a ledger. Nothing is lost: any change can be diffed and reverted.

## Reading: progressive disclosure

1. `start` once per session: the root index, counts by type, open work, and house rules. If your connection reaches several libraries, `start` lists them; open one with `start` and `library` (`owner/slug`), then pass the same `library` on every call.
2. `browse` a directory to see its concepts' titles and descriptions before opening any.
3. `read` the concept you need. Look at the header first: trust tier, `stale`, `status`, lint, inbound links. Then read the frontmatter, then the body.
4. Follow links to related concepts rather than guessing paths. Use `search` (ranked) or `grep` (exact text) when you do not know where something is.

Treat a `stale`, `deprecated` or unverified concept as a lead to confirm, not a fact.

## Writing a conformant concept

```markdown
---
type: Metric
title: Gross Margin
description: Gross margin for a period, per the FY2026 cost allocation standard.
tags: [finance, margin]
status: stable
stale_after: 2026-12-31T00:00:00Z
sources:
  - id: margin-standard
    resource: /policies/margin-standard.md
    title: Cost Allocation & Margin Standard (FY2026)
---

# Definition

Gross margin equals recognized [revenue](/metrics/revenue.md) minus full COGS.[^margin-standard]

[^margin-standard]: Cost Allocation & Margin Standard (FY2026)
```

- A non-empty `type` that says what kind of thing this is (`Metric`, `BigQuery Table`, `Decision`, `Playbook`). Every file is a concept, so `concept`, `page`, `note` or `doc` tell a reader nothing: pick the kind a reader would filter by. Reuse the types already in the library (`start` lists them).
- A `description` of one sentence: it is what `browse` and indexes show.
- Absolute links (`/dir/file.md`). A link to a concept that does not exist yet is allowed; it shows up in `work` as a broken link until someone writes it.
- Every footnote label matches a `sources[].id`, and every `[^id]` in the text has a `[^id]: …` definition line at the end of the body (without one, renderers show it as literal text).
- Timestamps (`stale_after`, `sources[].last_modified`) are ISO 8601 datetimes with an offset (`2026-06-30T14:00:00Z`). A plain date such as `2026-12-31` is flagged.
- Set `status` and `stale_after` honestly: `draft` when unsure; a `stale_after` when the content depends on something that changes.
- Do not write `generated` or `verified`. The server ignores them and says so in the write result's notes.
- A file with no frontmatter, frontmatter that is not valid YAML, or no `type` is refused (400) and nothing is written; fix it and write again. The rest of this list is lint: a generic `type`, no `description` or `status`, a relative link, an uncited footnote definition. A link to a heading the target lacks, and a `stale_after` already past, come back as notes.

## Editing

- `edit` for small changes: find-and-replace on the document as `read` shows it, frontmatter included. Each `old` must match once; quote enough context.
- Bodies are stored in a canonical form: `-` bullets, `*` emphasis, ATX headings, fenced code, padded tables, short YAML lists and mappings in flow style. What you write reads back normalized, and is byte-stable after that; when it differs from what you sent, the write result says so and shows the diff. Quote `old` from what `read` shows, not from what you sent.
- `write` for a new concept or a full rewrite. Replacing needs `if_match`.
- `batch` for related changes (a new concept plus the links to it; a rename plus fixes) so they land as one request.
- `move` renames a file or a whole directory. Links keep working; do not fix them by hand.
- Put a one-line `note` on every write, saying why. Humans read the ledger.
- Read the `lint` in every write result and fix it in the same session. The result's notes say what else to know: ignored fields, the stored form, the concept's open comment threads and any your edit left outdated.

## Conflicts

Pass `if_match` with the hash from your last `read`. If another agent changed the file since, you get a 412 with the current hash. Re-read, reapply your change to the new content, and write again. Do not overwrite blindly. Writing without `if_match` to a path that exists is a 409 `exists`: pass its hash to replace it, or pick another path. In a `batch`, an error says which op failed (`Op 2 of 3`).

## Beyond files

These tools have no equivalent in a folder of files. Use them instead of grepping YAML or guessing:

| Need | Tool |
| --- | --- |
| What others changed recently | `log` |
| What needs fixing (open comments, stale, broken links, lint) | `work` |
| Requests and questions people left on a concept | `comments`, then `comment` |
| Find by meaning, ranked | `search` |
| Filter by type, tag, status, trust, staleness | `query` |
| What links here, and what this links to | `links` |
| Which sources back which claims | `sources` |
| A concept's past versions | `history`, `read(path, at)`, `diff` |
| Undo a change or a whole request | `revert` |
| The whole bundle as files | `export` |

A good maintenance session: `start`, `log` to see what changed, `work` to pick an item, fix it, repeat.

## Comments

Comments are how people ask you for changes. A thread sits on a concept, often on a quoted sentence, and stays open until someone resolves it. Comments are not content: they never change the concept or its hash, `log.md` and exported bundles leave them out, and the ledger (`history`, the nightly backup) keeps them.

- `read` says when a concept has open comments. Read them with `comments` (pass `path`) before you edit it.
- Make the change the thread asks for with the normal write tools, then `comment` with `reply` saying what you did, and `resolve` (a resolve can carry that closing reply).
- Unsure what is meant? `reply` with a question and leave the thread open. If the last reply is yours, wait for an answer.
- Resolve only what you addressed. `reopen` a thread you resolved by mistake.
- You can start a thread too (`comment` with `open`, a `path` and optionally a `quote` copied from the body as `read` shows it; it is matched by the text it reads as, markup aside), to ask a person something you cannot decide.
- An outdated thread's quote is gone from the body; it may already be fixed. Check, then answer it.
- A concept with open threads cannot be deleted (409 `open_comments`): answer and resolve them first.

## When to split a concept

Split when a concept covers more than one idea, mixes definitions with procedures, or approaches the 100 KB cap (the server refuses larger ones). Write each part as its own concept and link them from a short overview. Prefer several focused concepts that link to each other over one long page.

## Etiquette with other agents and humans

- Read before you write, and pass `if_match`.
- One-line `note` on every write.
- `edit` for small changes, `batch` for related ones.
- Never write `index.md` or `log.md`. Never claim verification.
- Answer the comments on what you change; never resolve one you did not address.

## Connecting

The server speaks MCP over Streamable HTTP at `https://app.tempra.dev/mcp`. An app connection reaches the libraries its approver chose (all of the account's, or a selection); a bearer token reaches one library.

- **claude.ai, ChatGPT and other apps:** add the URL as a custom connector and approve it in the browser (OAuth; the approver picks all libraries or selected ones, read or write access, and the name your changes carry).
- **Claude Code and scripts:** use a bearer token, minted by a human on the service's Tokens page (`https://app.tempra.dev/tokens`):

```sh
claude mcp add --transport http tempra https://app.tempra.dev/mcp \
  --header "Authorization: Bearer <token>"
```

With a bearer token, use two libraries by adding two connections.
