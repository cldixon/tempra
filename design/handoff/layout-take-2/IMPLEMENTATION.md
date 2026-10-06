# Implementing take 2 (TEMPRA-53)

Working notes for the one PR that builds this handoff into the SPA. The README beside this file is
the design; this file records what was decided on top of it (2026-10-06, with the operator) and
how each part maps onto the app. The spec lives in tempra-dev (`app/workspace.md`,
`v2/design-system.md`); this file is for the implementer and can go once the PR merges.

## Decisions on the gaps

1. Trust, type, status, staleness and lint (gone from under the title in the mock) get their own
   **Review** panel in the cluster, plus a quiet trust and stale note in the crumb row.
2. **Verify** is a button in the Review panel; History keeps the "Verified by…" line.
3. The **Markdown view** (the file exactly as an agent reads it) stays: a toggle in the cluster
   beside Edit. "Changes since verification" moves into the Review panel.
4. **Frontmatter** is the **Properties** panel: read-only while reading, the existing form while
   editing.
5. **Library settings** (Import & export, Recovery, Connect, Delete) live in the library switch
   menu in the header.
6. **New version**: the pulsing glyph opens a popover (who, when, note, Show diff, Show new
   version). While editing it says the change is merged at save. A move or delete keeps a notice
   in the sheet.
7. Tree marks keep today's meaning: ● an agent changed it in the last minutes, ∗ changed since the
   last visit, a digit for open comment threads.
8. No library descriptions in the UI for now (the data has none).
9. Under 900px the sidebar is a drawer behind a Files button in the header.
10. Light and dark follow the system; no in-app toggle.
11. Small items at the implementer's discretion: no "Copy link" (no range permalinks yet); Escape
    closes, in order, a comment draft, a drawer, the switcher, then the panel (never an edit);
    account pages use the library list's centred column.

Not here: the colour palette and heat (TEMPRA-1); the editor's floating formatting toolbar
(TEMPRA-21), so Wordgard's menu bar stays while editing.

## Where today's concept page goes

| Today (`pages/File.tsx`)                  | Take 2                                         |
| ----------------------------------------- | ---------------------------------------------- |
| Crumbs, h1, description                   | Article: crumb row, serif title and tagline    |
| Type, trust, stale, status, lint chips    | Review panel; trust and stale note in crumbs   |
| Markdown button                           | Cluster toggle beside Edit                     |
| Edit button                               | Cluster pencil                                 |
| Changes since verification toggle         | Review panel                                   |
| Edit bar (note, Save, Cancel)             | Sticky bar at the sheet's top                  |
| Live banner                               | Cluster glyph and popover (notice for move/delete) |
| Lint section under the body               | Review panel (and Work)                        |
| Context: Verification                     | Review panel                                   |
| Context: Comments                         | Comments panel                                 |
| Context: Contents, Sources, Linked from   | Contents & sources panel                       |
| Context: Work                             | Work panel                                     |
| Context: History                          | History panel                                  |
| Context: Frontmatter (and edit form)      | Properties panel                               |
| Header: Libraries, select, Open…, Context, Connect, Tokens, Apps, email | Tempra / library menu; avatar menu; search pill in the sidebar |
| Sidebar: filter, tree, six views          | Search pill, tree, Ledger and Work queue       |
