# Handoff: Tempra Layout, Take 2

## Overview
Structural pass on Tempra's web app: a library of concepts written by agents over MCP and reviewed by humans. Four states are mocked: Library list, Reading, Commenting, Editing. This take is the "light and airy" direction (Zen-browser-like): the document is a floating sheet on a soft ground, the sidebar sits on the ground with no card, and the right-hand context has been split into exclusive panels toggled from a control cluster that hovers over the document.

## About the Design Files
`Tempra Layout v2.dc.html` (+ `support.js`, its runtime) is a **design reference built in HTML**, not production code. Recreate it in the target codebase's existing environment and patterns (current app is plain HTML moving to a SPA); do not ship these files. `Tempra Layout.dc.html` is Take 1 (the denser, Obsidian-like direction) kept for comparison. Open either file in a browser; the strip at the top switches screens and light/dark and is prototype chrome, not part of the app.

## Fidelity
**Structural / mid-fidelity, black and white on purpose.** Layout, spacing, type scale and information architecture are decided. Color, iconography beyond the five glyphs here, and the "heat" treatment for recency are deliberately not designed yet. Treat measurements as intended; treat greys as placeholders for a later palette.

## Global frame
- Root: system UI sans, 14px / 1.5, antialiased. Ground `--bg2`. `color-scheme` toggles light/dark via the `light-dark()` tokens below.
- Workspace grid: `grid-template-columns: 232px minmax(0,1fr) [320px when a panel is docked]`; rows `48px minmax(0,1fr)`; `column-gap: 10px; padding: 0 10px 10px`; height = viewport. Panes scroll internally; the page never scrolls.
- Breakpoints: `< 1100px` the panel overlays the sheet (fixed, right 10px, top 142px, bottom 10px, width min(320px, 100vw-20px)) instead of taking a column. `< 900px` the sidebar is removed.

## Screens

### Library list
- No sheet; content sits on the ground. Header 52px: "Tempra" (600) left; right: "Connect an agent" link (`--fg2`), avatar.
- Main: max-width 720px centered, padding 72px 24px 96px. Row: h1 "Libraries" 28px/1.2 weight 500 letter-spacing -.02em; right: **New** button: white pill (`#fff`, text `#161617`, 1px `--line`, radius 999, padding 6px 12px 6px 8px, `--shadow`), circled "+" glyph 16px stroke 1.4 then "New". Hard white in both schemes.
- Library rows (gap 6px): block links, padding 16px 18px, radius 12, hover `--hover`. Name 15px/500; description 13px `--fg2` below. No counts or metrics.
- Footer line 13px `--fg2`: "Agents write to a library over MCP. Connect an agent or mint a token." (links underlined).

### Workspace header (48px, all workspace screens)
- Left, gap 10px, padding 0 6px 0 10px: "Tempra" (600) · "/" (`--fg3`) · library switch "tempra-dev ▾" (ghost pill, `--fg2`, hover `--hover`).
- Right: avatar button "CD" 26px circle, `--sel` fill, 10px/600. Settings and sign-out live in its menu.
- Nothing else. Search and panels moved out of the header.

### Sidebar (232px, on the ground)
- Padding 8px 4px 0; column flex; the tree scrolls, not the pane.
- Search pill at top: white pill, 1px `--line`, radius 999, padding 6px 8px 6px 12px, `--shadow`; text "Search tempra-dev…" in `--fg3`; kbd "⌘K" as a `--bg2` pill. Scope: the current library only (concepts, Ledger, Work queue). Margin-bottom 10px.
- Tree rows: height 30px, radius 8, 13px, gap 6px, padding-right 10px, indent `10 + depth·14` px. Dirs: `--fg` 500 with ▾/▸ glyph (10px, `--fg3`). Files: `--fg2` 400. Current file: `--sel` fill, `--fg` 500. Hover `--hover`. Right-aligned mark 11px `--fg3`: `●` changed, `∗` stale/unverified, digit = open comments.
- Below the tree (margin-top 20px): library views "Ledger  seq 214", "Work queue  6" as rows indented 28px.

### Document sheet (main)
- `background --bg; border 1px --line; border-radius 16px; box-shadow --shadow; overflow: hidden auto`.
- **Control cluster** (hovers top-right inside the sheet): `position: sticky; top: 12px; margin: 12px 12px -50px auto; z-index 3`. White pill, 1px `--line`, radius 999, padding 3px, gap 2px, `--shadow`. Buttons 30px circles, icons 16px Lucide-style stroke 1.4; idle `--fg2` on transparent, hover `--hover`, active `--fg` fill with `--bg` glyph. Order, left→right:
  1. New-version glyph (only when a newer version exists): refresh arrow, `--fg`, pulsing (`opacity 1→.35→1`, 1.6s ease-in-out infinite). Tooltip: "New version · claude-code/laptop · tighten the merge section". Click swaps in the new version. No text, no timer.
  2. Hairline divider (1×18px `--line`).
  3. Edit (pencil). Toggles editing; active while editing.
  4. Divider.
  5. Comments (speech bubble; 6px `--fg` dot at top-right when open comments exist), Contents & sources (three lines), Work (circled check), History (clock).
  Panels are mutually exclusive. Tap the active icon, the panel's ×, or Esc to close. Default on load: Comments open.
- **Article**: max-width 680px centered, padding 56px clamp(16px,5%,40px) 140px. Crumb "app / editor.md" 12px `--fg3`, margin-bottom 24px. Title block (margin-bottom 32px): h1 serif 36px/1.15 500 letter-spacing -.01em; tagline serif 17px/1.5 `--fg2`. No tags, pills or meta under the tagline.
- **Body**: serif 17px/1.7. h2 serif 22px/1.3 500, margin 40px 0 12px. p margin 0 0 18px. code: mono 15px on `--bg2`, padding 1px 6px, radius 5. blockquote: 2px left rule `--line2`, padding-left 22px, italic `--fg2`. Footnote superscripts link to `#src-*` in the Contents & sources panel. Commented text: dotted underline (1px, offset .22em), title shows the count.

### Reading
Sheet as above. If a newer version exists the pulsing glyph appears in the cluster. Nothing else changes.

### Commenting
- Selected sentence: `<mark>` with `--sel` fill, radius 3. Popover anchored to the selection's right end, 44px above: white pill, 1px `--line`, radius 999, padding 3px, `--shadow`; "Comment" (solid `--fg`/`--bg`, radius 999, 4px 12px, 12px 500) and "Copy link" (ghost, `--fg2`).
- Comments panel opens automatically with a draft card at top: `--bg2` fill, radius 12, padding 12px 14px; quoted selection (12px italic, 2px left rule), textarea (13px, borderless), Cancel (ghost) / Comment (solid).

### Editing
- Sticky edit bar at the sheet's top: `padding 10px 204px 10px 24px` (right padding clears the cluster), `--bg`, bottom rule 1px `--line`, flex-wrap, gap 8px 10px. Contents, left→right: spacer · note input (placeholder "What you changed, in one line", `--bg2` pill, radius 999, padding 6px 12px, 13px, `flex: 1 1 120px`, max-width 360) · **Save** (solid `--fg`/`--bg` pill, 6px 14px, 13px 500) · **Cancel** (ghost `--fg2`). Save requires the note.
- No mode label or icon in the bar; the active pencil in the cluster is the mode indicator. (A distinct editing *surface* treatment was tried and parked for a separate session.)
- Formatting toolbar: not persistent. Appears floating above a text selection, same pill style as the comment popover: ¶ H2 H3 B I </> " • ⌘K.
- Frontmatter: not shown in this take (modal and inline drawer both removed). Pending decision.
- Body is frozen on the version the edit started from; a write landing meanwhile shows the new-version glyph and is merged at save (412 → 3-way merge).

### Panels (one at a time)
Card: `--bg`, 1px `--line`, radius 16, `--shadow`, 13px, scrolls internally. Header row padding 14px 16px 10px: title 13px/500 · count 12px `--fg3` · spacer · × (24px circle, `--fg3`, hover `--hover`). Body padding 0 16px 16px.
- **Comments** (count "1 open"): composer pill "Comment on this concept, or select text…" (`--bg2`, radius 999, 8px 14px, `--fg3`); then each thread: quoted anchor (12px italic, 2px left rule), author 12px/500 + time `--fg3`, body 13px/1.45, replies indented 12px, reply input (`--bg2` pill) + Resolve (ghost). `<details>` "Resolved (3)" at the bottom.
- **Contents & sources**: section list with a 2px left rule (`--fg` for the current section, `--line` otherwise), padding 4px 0 4px 10px. Then "SOURCES" (11px uppercase .04em `--fg3`) numbered 1, 2 with title and a `--fg3` line "external · cited 1×" / "app/live.md · human-reviewed · cited 1×". Then "LINKED FROM" list.
- **Work** (count 1): each item a `--bg2` card radius 12 padding 10px 12px: "lint" pill (`--bg` 11px radius 999) + message 12px `--fg2`. Footer link "All open work in tempra-dev (6)".
- **History** (count "seq 214"): verification line first (7px `--fg` dot + "Verified by cl_dixon, 2026-10-05 17:51. No content change since."), then rows `grid 36px 1fr auto`, 12px, 1px top rule each: seq (verify rows weight 600) · "op actor" + note (`--fg3`, ellipsis) · relative time. Footer links "All 9 · View at seq… · Raw".

## Interactions & behavior
- Panel cluster: click toggles; same button closes; Esc closes; one panel open at most. Persist the open panel, screen and scheme across reloads (prototype uses localStorage).
- Entering Commenting opens the Comments panel.
- Under 1100px the panel becomes an overlay starting below the cluster (top 142px) so the cluster stays reachable.
- Hover fills use `--hover`; no browser defaults. Focus rings not yet designed; use a 2px `--fg` outline with 2px offset until the color round.
- No animation beyond the 1.6s pulse on the new-version glyph.

## State
`screen: home | reading | commenting | editing`, `scheme: light | dark`, `panel: comments | contents | work | history | null`, `wide` (≥900), `roomy` (≥1100), `showBanner` (newer version exists). Data: tree rows (label, depth, kind, current, mark), library list (slug, description), history rows (seq, op, actor, note, when), comment threads, sources, work items.

## Design tokens (light / dark)
- `--bg` #ffffff / #1b1b1d (sheet, panel, pills)
- `--bg2` #f3f3f1 / #121214 (ground, inset fills)
- `--fg` #1a1a1b / #ececea · `--fg2` #6f6f73 / #9a9a9e · `--fg3` #a3a3a7 / #68686c
- `--line` #e8e8e4 / #2a2a2d · `--line2` #d2d2ce / #3c3c40
- `--hover` #e9e9e6 / #222225 · `--sel` #e1e1dd / #2a2a2e
- `--shadow`: `0 1px 2px rgba(0,0,0,.04 / .4), 0 6px 24px rgba(0,0,0,.04 / .35)`
- Selection highlight: #dededa / #3a3a3d
- Type: UI `-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, 'Segoe UI', Helvetica, sans-serif`; reader `'Iowan Old Style', 'Palatino Linotype', Charter, Georgia, serif`; mono `ui-monospace, 'SF Mono', Menlo, monospace`.
- Type scale: 11 (labels, uppercase .04em) · 12 (meta) · 13 (UI) · 14 (base) · 15 (library name, code) · 17 (reader body, tagline) · 22 (h2) · 28 (page h1) · 36 (document h1).
- Radii: 999 pills · 16 sheet/panel · 12 cards/rows · 8 tree rows · 5 code · 3 mark.
- Spacing: 10px frame gutter · 12px cluster inset · 16px panel padding · 24/40px article side padding · 56px article top.

## Assets
Five inline SVG glyphs (16px viewBox, stroke 1.4, round caps): refresh, pencil, speech bubble, three lines, circled check, clock, circled plus. Replace with the codebase's icon set (Lucide-style, 1.5 stroke) when available. No images.

## Screenshots
`screenshots/` — 1440px-wide captures: 01 library list · 02 reading with Comments · 03 reading, no panel · 04 commenting (selection + popover) · 05 editing with History · 06 dark mode with Contents & sources.

## Files
- `Tempra Layout v2.dc.html` — this take (all four screens, light/dark).
- `Tempra Layout.dc.html` — Take 1, for comparison.
- `support.js` — runtime the mock files need to open in a browser.

## Open items for a later design session
- Editing surface: make the sheet itself read as "unset" while editing, without buttons or labels (two attempts parked).
- Heat: recency as color on the new-version glyph and tree marks, hot→cool ramp (yellow-white → orange → red → dull blue), no live timers.
- Frontmatter access while editing.
- Settings contents (profile, appearance, agent tokens, library membership).
- A rethink of the whole surface for an app where agents write and humans review.
