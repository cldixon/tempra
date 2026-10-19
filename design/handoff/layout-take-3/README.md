# Handoff: layout take 3

A redesign of the app's frame and its main pages, decided on the design canvas on 2026-10-18 and 19 with the product owner. It follows layout take 2 (`../layout-take-2/`, TEMPRA-53), which this replaces where they differ. Linear: TEMPRA-106 (this work), under the Design v1 project.

The aim is the human half of Tempra: a legible, low-friction place to read what agents wrote, check it, and answer them. Take 2 gave the app good bones; take 3 changes what a person sees first, how they learn who did what, and where context and comments live. Colour and type are deliberately not part of this round (see the end).

## How to read this

- **The boards** are in `boards/` (`.dc.html`, open them in a browser; `support.js` is their runtime) and, more legibly, on the design canvas: https://claude.ai/artifact/H4rEdkvVCyK2AHQaosbaih (private to the owner's account; a Claude session on that account can read it with the Artifact tool, `action: "read"`). Images on the boards point at the canvas's own uploads, so they are blank when a board is opened from disk.
- **They are mockups, not code.** Recreate them with the app's existing components, `@tempra/design` tokens and CSS (the UI rule in CLAUDE.md: nothing styled inline, every visual decision in the package). Treat structure, hierarchy, wording and behaviour as decided; treat exact pixel values as intent. Where a board and this file disagree, this file wins.
- **The content on the boards is illustrative.** Names, threads, counts and times are made up to show shape.
- The same canvas holds the audit that motivated this round ("Fundamentals audit") and colour explorations that are not part of it.

## Ship it as one change

This changes the frame every library page sits in, so it lands together: one branch, one PR, reviewed in its PR preview, never half-merged into `main`. Work in whatever order suits you inside the branch (a suggested order is at the end), but `main` goes from take 2 to take 3 in one merge. Gate and tests change in the same PR.

## Spec first

CLAUDE.md's rule applies: update the concepts in the tempra-dev library before (or with) the code. Several current statements are reversed by this round.

| Concept | What changes |
| --- | --- |
| `app/workspace.md` | The header bar goes; the library switcher, search, Home, Needs you and Activity move to the sidebar. A library's root opens its **home**, not a blank sheet. The panel system (Comments, Review, Contents & sources, History, Properties; `PanelHost`, `usePanels`, the control cluster) is removed: comments go to the right margin, contents to the left margin, history to the byline, the rest to a "…" menu. Phone: a top bar and the existing drawer, no panels. |
| `app/reader.md` | The byline; sources as a section at the end of the body; figures (captions, numbering, enlarge, a broken-image state); the full-screen image view; the history menu; review and verify from the byline. |
| `app/comments.md` | Threads in the margin beside their quotes; the corner toggle; the phone sheet. Anchoring, storage and the selection toolbar are unchanged. |
| `v2/design-system.md` | Note the round (take 3) and the colour rule below. |
| a new decision, e.g. `decisions/margins-not-panels.md` | Why panels went: two places to close one thing, controls far from their content, context competing with the text. What we gave up (one generic container for every kind of context) and what we accepted (margin layout work, below). |

Then update CLAUDE.md's UI paragraph, which currently describes panels, the blank root and the cluster.

## The frame

Board: `Home`, `Concept`, `Folder`, `Activity`, `NeedsYou`.

- **No header bar.** The page is the ground with two things on it: the sidebar and the sheet.
- **Sidebar, top to bottom:**
  - the library switcher (the library's name, its owner beneath, a chevron; it opens today's library menu: switch library, settings, Import & export, Recovery, Connect, Members, Delete, by role as now);
  - the search pill (opens the quick switcher; show `⌘K` on macOS and `Ctrl K` elsewhere);
  - **Home**, **Needs you** (with its count as plain text, no badge), **Activity**;
  - a small "Library" label, then the file tree. Top-level folders are listed by a readable name with their concept count. Folder names come from the slug for now (see open questions); concepts by title as today;
  - at the bottom: **Inbox** with its unread count, and the person (avatar and name) opening today's avatar menu.
- **The sheet:** the open page, full height, radius 10px, a hairline edge rather than a soft shadow. Corners slightly squarer than take 2 overall.
- **The sidebar can be hidden** (a sidebar toggle at the sheet's top left when it is). Hidden is a reading mode; the toggle remembers per library.
- The Ledger and Work queue rows leave the sidebar: Activity and Needs you replace them as the human views; the ledger and the work queue stay at their URLs, linked from those pages.

## Library home

Board: `Home`, `HomePhone`. Replaces the blank sheet at `/<owner>/<library>/`.

1. **Header:** the library's title (or slug) as the page title, its description beneath (TEMPRA-102 adds these; omit the line until it lands), then one quiet line: who works here (avatars of people and agents), the number of concepts, and when it last changed.
2. **Needs you:** the first three items of the Needs you page (below), with "All n" linking to it.
3. **Since you last looked:** the latest few Activity entries after the person's seen cursor, with the cursor's time, and a link to Activity. If nothing is new, say so in one line.
4. **Start here** (on the board) is **out of scope** for now: there is nowhere to keep pins yet.

Keep the first version to this; it should feel quiet.

## The concept page

Boards: `Concept`, `Comments`, `Figures`, `ConceptPhone`.

**Header:** title, description, then the **byline**, one line:
- left: the author of the current version as an avatar and name, with who they act for when an agent ("Claude Code for @cl_dixon"), "updated 14 min ago", and **"6 versions"** as a button that opens the history menu;
- right: where it stands with the reader: "Verified by you, Oct 9" (ink, a filled check), or "2 changes since you verified" / "Not yet verified" (a hollow circle), and a **Review** button when there is something to review.

**Top-right corner of the sheet:** two controls only.
- **Comments toggle:** a comment icon with the open-thread count; pressed, the right margin shows; off, the text re-centres. Remember the choice.
- **"…" menu:** Markdown view (today's toggle), Properties (the frontmatter, read-only, as a small dialog or popover), the raw file, Contents (only when the left margin cannot show it), and the concept's agent notes (its lint and work items, as the Review panel lists them today).
- The new-version glyph stays and keeps its behaviour; it sits beside these two when a newer version exists.

**Left margin:** the table of contents, a short list of the h2/h3 headings in small grey type, the section in view in ink, sticky while scrolling. Shown only when there is room (see breakpoints) and the concept has at least two headings.

**Sources:** move out of the panel into a "Sources" section at the end of the body, numbered as the footnote markers and hover cards number them. The cards stay.

**History menu** (from "6 versions"): a popover under the byline. First line: when this concept was last verified, by whom, at which version. Then the latest versions: number, author, note, when; "All versions" opens the full history (today's History panel content can become this page or a dialog). Choosing a version shows it with the word diff against the current one drawn in place, as the verification diff is drawn today, with a clear way back.

**Review:** "Review" (or clicking the verification state) turns on the changes-since-verification diff in the text and shows a slim bar at the top of the sheet with the note field and **Verify this version** (respecting roles: no Verify for a read member). This replaces the Review panel's trust and verify section.

**Comments in the margin** (board `Comments`):
- A right margin inside the sheet (about 290px) beside a text column of about 620px. Each open thread sits beside the paragraph its anchor resolves to, joined to the underlined quote by a short hairline. The active thread is expanded (the quote's highlight filled, the thread's comments, a reply field, Resolve); the others are one collapsed line each (author, first words, age) that expands in place.
- Threads on the whole concept (no quote) sit at the top of the margin, beside the title.
- When threads would overlap, push the later ones down; keep them in document order. The margin scrolls with the text.
- New comments: the selection toolbar stays as it is (Comment, for now); Comment opens a draft in the margin beside the selection.
- Highlights keep the CSS Custom Highlight API and stay lines and greys, as now.
- "Resolved" threads: a "Show resolved" item at the end of the margin, or in the "…" menu.

**Breakpoints (adjust to taste):**
- Wide enough for contents, text and comments: three columns, as on the board.
- Not wide enough for contents: contents moves into the "…" menu.
- Not wide enough for the margin (comments on): the comments open as a sheet over the right side of the page, with a close button, rather than squeezing the text.
- Phone: see below.

## Folders

Board: `Folder`. A folder's URL shows a folder view instead of the synthesized `index.md` (agents still read `index.md`; keep the Markdown view of it in the "…" menu).
- Header: the folder's name, its description if there is one (see open questions), and one line of counts: concepts, how many not verified, the newest change.
- Controls: sort Recent / A–Z; filters "Not verified" and "With open threads".
- One row per concept: title and description (one line each, truncated), the author of its latest version with when, its open-thread count, and a small dot (filled when a person has verified the current version, hollow when not).
- Subfolders above the concepts, as rows with their counts.

## Figures

Boards: `Figures`, `Lightbox`. All in the reader and `design/src/prose.css`.
- **Images** become figures: the image, then a caption from the image's title, else its alt text; no caption when neither exists. Clicking an image opens the full-screen view.
- **Numbering:** "Figure n." before captions, counting images and diagrams in document order. Optional; drop it if it reads as heavy.
- **Diagrams:** a quiet frame with the caption below and two small controls in its corner: Source (shows the Mermaid source in place) and Enlarge.
- **Broken image** (the image fails to load): a dashed box of the same size with "This image can't be shown", the path, and the alt text. TEMPRA-105 tracks a stored image that is actually corrupt.
- **Tables:** fill the column, with a light header row; wide tables scroll inside their own box (as now).
- **Full-screen view:** over the app on the ground colour; the image as large as fits; previous and next through the concept's figures; Escape closes; "Open original" and "Download" as pill buttons; beneath, the caption and a quiet line: path, size and who added it (dimensions only if known).

## Activity

Board: `Activity`. A new page in the sidebar, for people; the ledger stays as the audit view behind "The full ledger".
- Grouped by day.
- One entry per **request** (the ledger's request id): who (avatar, name, who they act for), a sentence of what they did ("changed 3 concepts in The app and Decisions"), the request's note quoted, then the concepts it touched, each with what happened (added, edited, rewrote, moved, deleted) and, for edits, the size of the change in words if cheap to compute.
- Comments and verifications are entries too ("replied on Reader", "You verified …").
- A dot on entries after the seen cursor; the page moves the cursor forward as the ledger does today.
- Filters: Everyone / Agents / People; a folder; hide comments.
- Live: new entries arrive through the existing feed.

## Needs you

Board: `NeedsYou`. A new page in the sidebar: what only a person can do. It replaces the Work queue as the person's view; the work queue stays at its URL.
1. **Waiting on your reply:** open threads where the last comment is not yours and you took part (or were mentioned), newest first.
2. **To verify:** concepts changed since a person last verified them, with who changed them and when, each with a Review button that opens the concept in review mode.
3. **Going stale:** concepts stale or going stale within 14 days, with "Ask an agent to review" (posts a comment on the concept asking for a review) and "Still true" (out of scope until there is a human path to set `stale_after`; show only the first for now).
4. **Agents' housekeeping:** one collapsed line counting lint, structure and broken links ("You don't need to act"), linking to the work queue.

The sidebar's count is the total of 1 to 3.

## Phone

Boards: `HomePhone`, `ConceptPhone`, `CommentsPhone`. A web app on a phone, not an iOS app:
- A top bar: a menu button opening the existing sidebar drawer (Home, Needs you, Activity, the tree, Inbox, account), the library name, search, the avatar.
- No bottom tab bar.
- On a concept: back to the folder, the comment toggle, "…".
- Comments: a sheet from the bottom with a title, the open count and a close (×) button; nothing opens over the page by itself (today a remembered panel can, see the audit).
- 44px touch targets.

## Colour and type: hold back

Not part of this round, and nothing here should introduce colour.
- Keep today's greys and tokens. White sheet, light grey ground, near-black text; primary actions are black pills, secondary are outlined pills; the selected row is a grey fill. "Verified" is ink, never coloured.
- The one colour allowed: a small orange dot for an agent's recent change (in the tree, beside Activity, in the byline), cooling to grey as the change ages. Add a token for it in `design/src/tokens.css`. The `Colour` board shows the intent (its "links" tweak shows blue as a possible secondary colour for links later; do not use it now).
- Keep the system fonts. Web fonts are a later decision.
- Fold new values into tokens as you go (spacing, the sheet radius, the margin widths); `workspace.css` already has many raw pixel values, so don't add more.

## Data: what exists and what is missing

| Need | Today | Suggestion |
| --- | --- | --- |
| Byline author, time | the concept's `generated: {by, at}`; ledger meta `by: {person, agent}` (`agents.ts`), `GET …/agents` names them | use the latest event's `by` for the current version |
| Versions, verification | `GET …/history/{path}`; trust tier in the concept JSON; `POST …/verify/{path}` | as is |
| Needs you: threads | inbox (`/api/v1/inbox`, cross-library), `GET …/comments` | filter the inbox to this library; or add `GET …/needs` combining the three sources |
| Needs you: to verify | the health summary (`computeHealth()` in `store.ts`) lists the newest unverified concepts and their total | expose the full list (paged) |
| Needs you: stale | `GET …/work?kind=stale` and `stale_soon` | as is |
| Activity | `GET …/requests` (requests with their events), `GET …/events?since=`, the seen cursor | group by request in the app first; move to the server only if it is slow |
| Home counts | `GET …/summary`, `GET …/tally` | as is |
| Folder rows | `GET …/outline` (path, kind, title, seq), `GET …/concepts` | add the latest author, verified state and open threads per concept if not already there; keep it to one request |
| Image size, dimensions | attachment JSON has size and media type | dimensions later |
| Folder descriptions, Start here pins, "Ask an agent", linking an agent's reply to the version it made | none | out of scope; see open questions |

## Tests and the gate

`worker/scripts/gate.ts` drives the panels through `.cluster` and `.ws-panel` (`panel(...)` around lines 500 and 1545: History, Review, Comments; a "Close panel" check at phone width). Rewrite those steps for the byline, the "…" menu, review mode and the margin. Keep every behaviour the gate checks today (verify, the changes since verification, comments posted on a selection and kept through an agent's write, the Markdown view, the drawer at phone width) passing in the new places. Add: the root shows the home; a folder shows the folder view; an image opens the full-screen view; Needs you and Activity load. `app/app.test.ts` checks the router against the server's URLs: add the new pages.

## Suggested order inside the branch

1. The spec changes above.
2. The frame: sidebar and sheet, without panels (the concept page temporarily without context).
3. The concept page: byline, corner controls, history menu, review mode, sources at the end, contents margin.
4. Comments in the margin, then the phone sheet.
5. Library home, Needs you, Activity.
6. Folder view; figures and the full-screen view.
7. Gate and tests; the preview; the owner's review.

## Open questions

- **Folder names and descriptions:** the boards use readable names ("Spec: v2 managed service", "The app"). Options: the folder's `index.md` gets a title and description from a convention (e.g. a concept named after the folder), or a small frontmatter-only file. Until then, show the slug with its first letter capitalised, and no description.
- **Margin layout cost:** keeping threads aligned to their paragraphs through scrolling, resizing and live updates is the hardest part of this round. If it fights back, ship comments as the right-side sheet from the narrow breakpoint at all widths, and keep the margin as a follow-up.
- **"Ask an agent"** (the selection toolbar, a broken image, a stale concept): which agent? Until managed agents (TEMPRA-69), it can only be a comment that @mentions the agent that last wrote the concept.
- **History as a page or a dialog** for "All versions".
