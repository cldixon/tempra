---
type: Design
title: Editor
description: "Direct editing of a concept by one person in the app: the reader made editable, saved with If-Match and a note, a three-way merge on 412, and frontmatter as a form."
tags: [app, editor, wordgard]
status: stable
stale_after: 2026-11-04T00:00:00Z
sources:
  - id: tempra15
    title: TEMPRA-15, Editor, single user
    resource: https://linear.app/subverse-labs/issue/TEMPRA-15/editor-single-user-edit-a-concept-in-wordgard-save-with-if-match-and-a
  - id: decision
    title: Decision, Wordgard behind @tempra/editor
    resource: /decisions/editor-wordgard.md
generated: { by: claude-ai/connector, at: 2026-10-06T20:12:23Z }
---
# Editor

The editor is the [reader](/app/reader.md) with Wordgard made editable. One person edits at a time; a save is an ordinary ledger request by `human:<handle>` with a note.[^tempra15] It comes after the reader, live feed and comments on purpose: agents are the primary writers.[^decision]

## Editing

- "Edit" reconfigures one compartment of the same instance (editable, menu bar, key bindings, input rules, undo history): no remount, no scroll jump. Cancel puts the loaded version back.
- Links: the menu's Link button (and `Mod-k`) asks for a target, offering the library's concept paths as you type; an app URL for a file in the same library becomes an absolute bundle link (`/dir/x.md`). Images pasted or dropped are uploaded as attachments beside the concept and inserted by bundle path (our Image node, not Wordgard's, so the upload is ours too).
- Footnote definitions stay beside the body and are written back as they were; references can be moved or deleted in the text.
- Comments stay visible while editing; their highlights map through the local changes.
- While editing, a new version never swaps in by itself; leaving the page (a link, the tree, back, closing the tab) with unsaved changes asks first.

## Saving

- The body goes back to the stored tree through the [markdown bridge](/app/markdown-bridge.md), with the block IDs it kept. It is sent as JSON `{ frontmatter, doc }` with `PUT /files/{path}`, `If-Match` (the hash the page loaded) and `X-Note` from a required one-line note field. The server writes the tree canonically, keeps the IDs that name blocks of the current version, and returns lint, shown inline; lint blocks nothing, but a concept with no `type` is refused with 400 like any write ([decision](/decisions/write-refuses-invalid-concepts.md)).
- **412:** an agent wrote meanwhile. A three-way merge by block (base: the version loaded; theirs: the current one; mine: the edit, matched to the base first), done in `@tempra/editor` so it is tested without a browser. Block order merges by ID; a block one side changed takes that side; a block both changed is a conflict that shows both sides, drawn as the reader draws them. Edits to neighbouring blocks combine. Frontmatter merges field by field the same way. Then save with the current hash as `If-Match`. A feed event for the open concept during editing shows the new-version glyph, which says the change will be merged at save; the merge happens at save.

## Frontmatter

A form, never document content: type (picker seeded from the library's types, free text allowed), title, description, tags, status, `stale_after` as a datetime control that writes a full offset timestamp, and a sources list (id, title, resource). `generated` and `verified` are shown and not editable; a human save lapses human verification like any write.

## As built

- `@tempra/editor`: `edit.ts` is the compartment's editing side (Wordgard's schema extensions for the GFM blocks and marks, history, menu bar, the Link button and `Mod-k`, paste and drop of image files, a change listener); `view.ts` switches the compartment with `setEditable` and adds `dirty()`, `tree()` and `reset()`; `merge.ts` holds `merge3` (diff3 over keyed items, LCS with the common prefix and suffix trimmed), `mergeDocs` (by block), `resolve` and `mergeFields`. `view.ts` gives the edited body back as a tree (`tree()`).
- App: `Editor.tsx` (the form, link targets, image upload, save, the merge view) and `useEditing` in `pages/File.tsx`. While editing, the page freezes the concept it shows, so a background refresh never remounts the reader. The router's leave guard covers links and back (popstate restores the address when refused); `beforeunload` covers the tab.
- Link targets: a full URL or rooted path into this library's app pages becomes the bundle path (with its `#fragment`); `#x` and other schemes stay as typed; a bare path gets a leading `/`. The link is then built by the parser's own rules (`linkParam` in `@tempra/editor`), so it is drawn like any link in the body; a scheme a browser must not follow (`javascript:`, `data:`) is refused. Link on a link (or the caret in one) removes the whole link.
- Images are stored at `<dir>/<concept stem>-<time><n>.<ext>` with `If-None-Match: *`, each as its own ledger request with a note. Each pending insert maps through the edits made while it uploads; Save waits for uploads; a failed upload is reported.
- The frontmatter form writes only what the person changed: a field left alone keeps its exact loaded value (a source's other keys, `stale_after`'s offset and seconds, tags as written), so neither a save nor a merge rewrites what was not touched.
- The leave guard also covers a change of query (`?at=`, `?done=`), which draws a new page; Verify is hidden while editing. A save that finds the concept deleted or moved says so.
- The merge view picks nothing for the person: each overlap (body or field) needs a choice of mine, theirs or (for blocks) both, mine first, before "Save merged"; "Back to editing" keeps the edit against the version it started from, so the next Save meets the 412 again and merges again; only "Save merged" writes against the newer hash. Edit does not move the focus: the person clicks where they mean to type.
- Tests: `editor/merge.test.ts`, `app/editor.test.ts`; the gate edits and saves with a note in Chromium, makes a link with Ctrl+K and checks it is saved as a bundle path, checks the ledger records `human:` with the note, has an agent edit after, then saves over an agent's write and merges.

## Not here

Several people at once, and agents' writes folded in live: [collaboration](/app/live.md).

[^tempra15]: Scope and done criteria.

[^decision]: Why editing is late in the order.
