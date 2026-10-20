# Handoff: layout take 4 (Option A)

A redesign of the app's frame, the concept page and the person's views, decided on the design canvas on 2026-10-20 with the product owner. It follows layout take 3 (`../layout-take-3/`, TEMPRA-106, built and merged) and changes it where they differ. Linear: TEMPRA-112 to TEMPRA-118 under the Design v1 project, one per step (listed at the end), and TEMPRA-119 for a later pass on how change is shown.

Take 3 gave the app a home, a byline, margins and the person's views. Living with it showed three problems: the frame had no fixed place for page tools, so they scattered (byline, margins, "…", sidebar foot); comments in the margin competed with the text and the contents; and five overlapping places told a person what happened or what to do (Inbox, Needs you, Activity, the ledger, the work queue). Take 4 is "Option A": **one library at a time**, a docs-site layout (a top bar, a navigation sidebar, the page, its contents on the right), and **three surfaces** for activity instead of five.

## How to read this

- **Look at `screenshots/`** first: one PNG per board, numbered in reading order (desktop 1440×900, phone 390×844, both at 2×). The page row (16 to 27) is a click-through: each board's title below names what was clicked to reach it, and a cursor sits on that control.
- **The boards' source** is in `boards/` (`.dc.html`, the same numbers): HTML with inline styles, readable as a spec of structure, spacing and wording. To open one in a browser, `support.js` loads React and Babel from unpkg.com.
- **The design canvas** has the same boards on its "Option A · every page" page: https://claude.ai/artifact/H4rEdkvVCyK2AHQaosbaih (private to the owner's account; a session on that account can read it with the Artifact tool). Its "Before consolidation" row and the "Exploration" page are **not** part of this handoff. Everything needed is in this folder.
- **They are mockups, not code.** Recreate them with the app's components, `@tempra/design` tokens and CSS (CLAUDE.md's UI rule: nothing inline, every visual decision in the package). Structure, hierarchy, wording and behaviour are decided; pixel values are intent. Where a board and this file disagree, **this file wins**.
- **The boards are drawn in the system sans throughout.** TEMPRA-108's type rule stands: a concept's own text (title, description, body) is the serif. Colour stays as now: greys and ink, and the one warm colour (`--tempra-color-agent`) only for the change dot (below).
- **Content is illustrative.** Names, counts, threads and times are made up.

## Boards

| # | Board | What it shows, and how you get there |
| --- | --- | --- |
| 01 | All libraries | `/`: the account's sidebar (Libraries, Inbox, Yours, Shared with you), library cards, New library |
| 02 | Inbox | `/inbox`: everything for the person across libraries, newest first, until done |
| 03 | The bell, open | The bell in the top bar, clicked from any page: the same Inbox, latest few |
| 04 | Account settings | Avatar menu → Account. Settings' own sidebar; Appearance (theme) is new |
| 05 | Connect an agent | Avatar menu → Connect an agent (`/connect`) |
| 06 | Sign in | Reference only: sign-in stays server-rendered in TEMPRA-110's public look |
| 07 | Library switcher, open | Clicking the library's name |
| 08 | Account menu, open | Clicking the avatar |
| 09 | Library home | A library's root |
| 10 | Folder | A folder in the sidebar, or a folder link |
| 11 | Activity · summary | Sidebar → Activity |
| 12 | Activity · every event | Activity → "Every event" (today's ledger) |
| 13 | Inbox, filtered | Home → "All n in Inbox": the Inbox, filtered to this library |
| 14 | For agents | Home → the line at its foot (today's work queue, `-/work`) |
| 15 | Search | The search button beside the switcher, or Ctrl/Cmd+K |
| 16 | 1 · A page | A concept: contents on the right, page tools in the top bar |
| 17 | 2 · An agent editing | The byline while an agent writes the page |
| 18 | 3 · Text selected | Selecting text: the Comment button |
| 19 | 4 · A draft comment | Comment clicked: a draft in the Comments panel |
| 20 | 5 · Comments | "Comments 2" in the top bar, or an underlined quote |
| 21 | 6 · History | ⋯ → History |
| 22 | 7 · Changes shown | Show changes: the changes in the text, with Verify (see Verification) |
| 23 | 8 · One version | A version in History: what it changed |
| 24 | 9 · The ⋯ menu | ⋯ beside Copy page |
| 25 | 10 · Markdown view | ⋯ → View Markdown |
| 26 | 11 · Properties | ⋯ → Properties |
| 27 | 12 · Full-screen figure | Clicking a figure |
| 28 | Attachment | A file in the sidebar, or "Open file" in the full-screen view |
| 29 | Library settings · Members | Settings at the sidebar's foot, or the switcher menu |
| 30 | Invitation | An invitation in the Inbox (`/invitations`) |
| 31 | Empty library | A new library with no pages |
| 32 | Not found | A path that is not there, with where it moved if the ledger says |
| 33–36 | Phone | Page, drawer, comments as a sheet, home |

## Spec first

CLAUDE.md's rule: update the concepts in tempra-dev before (or with) the code. Take 4 reverses several take 3 statements.

| Concept | What changes |
| --- | --- |
| `app/workspace.md` | A top bar returns (below). The sidebar is Home, Activity, a rule, the tree (with files), Settings at its foot. Needs you, the Inbox row, the person and the Hide sidebar button leave the sidebar. The sheet-on-a-ground look gives way to a flat page with hairline rules. |
| `app/reader.md` | Contents on the right; page tools in the top bar (Comments, Copy page, ⋯); one panel at a time (Comments, History, Properties); the byline (who, for whom, when, live); review and version views; the Markdown view; the full-screen view's "Open file". |
| `app/comments.md` | Threads in the Comments panel, not the margin. Anchors, storage, highlights and the selection toolbar are unchanged. |
| `app/home.md` | "For you here" (from the Inbox), all top-level sections in tree order, the line to the agents' work. "Since you last looked" leaves home (Activity marks new entries). |
| `app/activity.md` | Summary and Every event in one page; the ledger page becomes its second view. |
| `app/needs-you.md` | Retired: its items move into the Inbox. Keep the page as the record of `GET …/needs`, which the Inbox and Home use. |
| the notifications concept (TEMPRA-58's) | The Inbox holds what is for a person until it is done, not only what was addressed to them (below). |
| a new decision, e.g. `decisions/one-panel-from-the-top-bar.md` | Supersedes `margins-not-panels.md`: why panels return (one at a time, opened from one fixed place, closing restores the contents), what the margins cost (comments competing with text, tools scattered). |
| a new decision, e.g. `decisions/three-activity-surfaces.md` | Inbox (account), Activity (library), History (page); why Needs you, the ledger page and the work queue stop being separate destinations. |
| `v2/design-system.md` | Note take 4. |

`decisions/verification-out-of-the-way.md` (2026-10-20) **stands**; see Verification. Then update CLAUDE.md's UI paragraph.

## The frame

Boards 07–16, 28, 29.

- **A top bar, 60px, across the whole window**, split at the sidebar's edge:
  - over the sidebar: the Tempra mark, the **library switcher** (the library's name and a chevron), and a round **search** button (opens the quick switcher; Ctrl/Cmd+K);
  - over the page: **crumbs** (folders, then the page) on the left; on the right the **page's tools** (on a concept: below), then the **bell** (Inbox, with the unread count as a small badge) and the **avatar**.
  - No status text ("Updated 14 min ago") in the top bar: the byline says when, and the dot says what is live.
- **The sidebar** (264px, a hairline on its right): **Home**, **Activity**, a hairline rule, then the **tree**, and **Settings** at its foot.
  - The tree: top-level folders by readable name with their concept counts and a chevron; an open folder lists its concepts by title and **its files** (attachments) by filename. The current page is a grey row. Keep take 3's outline, refresh and remembered open folders.
  - Keep the hide-sidebar shortcut (Ctrl/Cmd+\); the button is not on the boards.
- **The switcher menu** (07): Yours, Shared with you (with the person's role), then All libraries, New library, then "<library> settings".
- **The avatar menu** (08): name and handle, then Account, Notifications, Connect an agent, Tokens, Connected apps; Theme (System, Light, Dark; new, below); Sign out. Invitations live in the Inbox.
- **Library settings** (29): their own sidebar, "Back to <library>", then General, Members, Connect, Import & export, Recovery, Delete library (by role, as now). The Members page as on the board: invite by email or handle with a role, people with their role, pending invites, and the agents that have worked here.
- **Account pages** (04, 05): the same pattern: "Back to libraries", then Account, Notifications, Connect an agent, Tokens, Connected apps. The library list (01) and the Inbox (02) use the account's sidebar.

## The change dot

One mark, the existing warm dot (`--tempra-color-agent`), with two meanings:

- **Solid**: changed since the person last looked, by the library's seen cursor (`…/seen`). In the tree, a folder's rows, Home's sections, the phone drawer.
- **Pulsing**: being written now: an agent's write arrived on the change feed in the last 60 seconds or so (tune it). In the byline ("Claude Code is editing now"), a folder's row ("Claude Code is editing"), Activity's live entry, the newest rows of Every event.

Nothing else is orange. A better treatment of change (the owner tried a moving glow and a tint and wants a dedicated pass) is TEMPRA-119; build the dot now.

## Library home

Board 09.

1. The library's title, its description (TEMPRA-102; omit until it lands), and one quiet line: who works here, the page count, "Start with the guide" when there is one.
2. **For you here**: up to three cards from this library's Inbox items (a reply, the pages to verify, a page going stale), and "All n in Inbox", which opens the Inbox filtered to this library (13).
3. **Sections**: every top-level folder, in the tree's order, with its description and count and the solid dot when it changed since the last visit. No pinning.
4. At the foot, quietly: "n housekeeping items for agents" → For agents (14, today's `-/work`).

## Folder

Board 10. The folder's title and its description (from the folder's index), then its concepts: title, one-line description, and the dot. That is all: no author, threads or verified columns, no sort or filters. The synthesized index.md stays for agents.

## Activity

Boards 11, 12. One page, `-/activity`, with a two-way switch:

- **Summary** (default): take 3's Activity (requests as sentences, grouped by day, the concepts each touched), with an "Anyone" filter. The live entry pulses.
- **Every event**: the ledger as a table (seq, when, who, kind, path and note), with Anyone, Any kind, a path or note filter, and Download. `-/ledger` opens this view.

Viewing moves the seen cursor, as now.

## Inbox

Boards 02, 03, 13. **This needs server work.**

The Inbox becomes the one place for what a person should do or answer, across their libraries, and items stay until done:

| Item | Until |
| --- | --- |
| A reply on a thread they're in, a new thread on a concept they wrote | the thread is resolved |
| A mention | read |
| To verify: a concept they verified that changed since (TEMPRA-111's rule) | they verify or dismiss it |
| Going stale (within 14 days) | it is refreshed or dismissed |
| An invitation, an access change | answered, or read |

- One list, newest first, the library named on each row (its mark and name), then the kind and time, the title, a detail line, a quote when there is one, and the row's actions (Reply, Resolve, Review, Open, Accept, Decline).
- Open / Done tabs; an "All libraries" filter (`/inbox?library=<owner>/<slug>` from Home). "Mark all read" clears unread, not open.
- The bell's badge counts unread; its popover lists the latest few with "Mark all read" and "Open inbox".
- **Server:** today `/api/v1/inbox` carries D1 notifications only, and "to verify" and "going stale" come from each library's `GET …/needs`. Decide in the spec how the Inbox gets both (for example: the Worker merges each of the person's libraries' `…/needs` into the notification list, cached and refreshed on the feed; or the write path and the daily sweep emit those items into D1 as notifications). Keep `GET …/needs` for Home.
- `-/needs` redirects to `/inbox?library=…`. Needs you's collapsed counts (never verified, housekeeping) go: housekeeping is Home's foot line; never-verified is not shown (TEMPRA-111, `verification-out-of-the-way`).

## The concept page

Boards 16–27.

**Top bar tools**, left to right: **Comments n** (a pill with the open count; toggles the Comments panel), **Copy page** (copies the page as markdown, one click), **⋯** (History, Properties, View Markdown, a rule, Copy link, Download .md). The take 3 comments toggle, sheet bar glyphs and "…" menu are replaced by these.

**Layout:** the page (title, description, byline, body) centred in its column; on the right, **the contents**: the page's headings, nested, the current one marked with a rule, sticky. No heading over it, no tabs, not collapsible.

**One panel at a time** (Comments, History, Properties) opens on the right in place of the contents, about 360px, with its title, a count where it has one, and ×. Closing (×, Escape, or the same control again) brings the contents back. Under 1100px it overlays the page; on a phone it is a bottom sheet (35). It is never opened by itself except by the person's click (a quote, a control, a link with `?panel=`).

**The byline** (16, 17): the author's avatar, "Claude Code for @cl_dixon", "edited 14 min ago". While an agent writes this page: "Claude Code is editing now" and the pulsing dot. (The boards also show verification here; see Verification.)

**Comments** (18–20): selecting text shows the Comment button above the selection (the existing toolbar). Comment opens the Comments panel with a draft at the top (the quote, a text box, Comment and Cancel); the quote is filled grey in the body until posted or cancelled. The panel lists threads (Open / Resolved n), the active one as a card with its replies, Reply and Resolve; others compact. Open threads are underlined in the body; clicking one opens its thread in the panel. Anchors, highlights (`::highlight(...)`) and storage are unchanged; `comments/Margin.tsx` and `layout.ts` go.

**History** (21, 23): the versions, newest first: version number, note, who and when. Clicking a version shows what it changed in the text under a slim bar ("v16 · note · who · when", Back to latest). "11 older versions" pages back.

**Review** (22): the word diff in the text: a hairline warm rule left of each changed block, insertions underlined on a grey ground, deletions struck through in grey.

**Markdown** (25): the file as stored (frontmatter and body, monospace, line numbers) in place of the page, with "Back to page" and the path.

**Properties** (26): Type, Status, Stale after, Sources, Path, Generated, and the Verification section (below).

**Full-screen figure** (27): take 3's view with "fig. n of m", previous and next, Download, **Open file** (to the attachment page), close.

### Verification

`decisions/verification-out-of-the-way.md` stands. The boards were drawn before it and show "Verified by you Oct 12 · 3 edits since" in the byline (16) and the review block at the top of History (21, 22). Instead:

- the byline shows no verification;
- the review block ("n changes since you verified", Show changes / Hide changes, Verify this version) is the **Verification section of Properties**, shown only when there is something to review, and Inbox's "To verify" opens the page straight into review (22's view);
- History is the versions alone.

## Other pages

- **Attachment** (28): the image (or a file icon) large on a dark frame, and beside it the filename, Download, Copy link, Type, Size, Added (who, when), Used in (the concepts that link it).
- **Invitation** (30): who invited, the library as a card (name, description, size), the access offered, Accept and Decline.
- **Empty library** (31): the steps to connect an agent (the MCP URL to copy) and a "waiting for the first write" line with the pulsing dot, which fills in live; "Import a bundle".
- **Not found** (32): "This page isn't here", and when the ledger shows a move: "Moved to <path> by <who>, <when>" with Open; Home and Search.
- **Search** (15): take 3's quick switcher, scoped to the library: Pages, Headings, In the text; keyboard hints; "Search all libraries".

## Phone

Boards 33–36. Keep TEMPRA-107's top bar (menu, where you are) and drawer. On a page the top bar adds the Comments pill and ⋯. The drawer is the sidebar: switcher, search, Home, Activity, the tree, then Settings and Inbox at its foot. Comments, History and Properties are a bottom sheet with ×. Home stacks the same sections.

## Not drawn

Build these from the rules above:

- A **read member's** view: no Verify, no Settings items beyond Members and Leave; a **write member** has no owner items.
- **A newer version arrived** while reading (today's glyph and notice, now in the top bar's tools), and the page **moved or deleted** under the reader.
- Library settings' other tabs (General, Connect, Import & export, Recovery, Delete) and the account's other pages: today's content in the new frame.
- Empty states: search with no results, an empty Inbox ("Nothing for you"), no Activity yet, no comments.
- **Dark mode**: from the tokens (`light-dark()`), no new boards. The **theme setting** (System, Light, Dark) is new: store it per account and apply it on the root.
- **Widths**: under 1100px the panel overlays the page and the contents column hides; under 900px the phone layout.

## Ship it in steps

Unlike take 3, this lands in several PRs, each leaving the app whole:

1. **Spec** (TEMPRA-112): the concepts and decisions above, and CLAUDE.md.
2. **Frame** (TEMPRA-113): the top bar (switcher, search, crumbs, bell with its popover, avatar menu, theme), the sidebar (Home, Activity, tree with files, Settings at the foot), library and account settings' sidebars. Needs you stays reachable from Home until step 5.
3. **Concept page** (TEMPRA-114): the tools, the contents column, the panels (Comments, History, Properties), Copy page and ⋯, the byline, Markdown, review and version views, Open file.
4. **Activity** (TEMPRA-115): Summary and Every event; `-/ledger` into it.
5. **Inbox** (TEMPRA-116): the server work, the merged list, filters, the bell; `-/needs` redirects; Home's "For you here".
6. **Home and Folder** (TEMPRA-117): sections, the foot line, the simpler folder list; Attachment, Empty, Not found.
7. **Phone** (TEMPRA-118).

Update the gate's take 3 flows as each step lands (margin comments, Needs you and the sidebar foot change), and keep `bun run check` and `bun run gate` green on every PR.
