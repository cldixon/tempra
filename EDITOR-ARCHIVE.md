# The Wordgard editor, archived

This branch (`archive/wordgard-editor`) keeps Tempra's in-app editor as it stood on `main` the day it
was removed (TEMPRA-99, 2026-10-18). Nothing here is deployed. It is kept so the work can be lifted
into its own repository and reused in another app, or brought back to Tempra as its own mode (not a
toggle on the reader) if human editing ever returns.

Why it went: Tempra v1 is read and comment only; agents write. The reader *was* the editor with
editing switched off, so every reading-first choice had to be negotiated with an editing engine, and
every reader downloaded a full editor. See the tempra-dev Decision "v1 is read and comment only; the
app renders bodies without an editor" (`decisions/read-and-comment-only.md` in the `cl_dixon/tempra-dev`
library), which supersedes the one exported here.

## What it was

A person opened a concept in the app's reader, pressed Edit, edited the body in place (Wordgard,
Marijn Haverbeke's successor to ProseMirror, pinned at `0.5.2`), filled the frontmatter in as a form,
wrote a one-line note and saved. The save was an ordinary ledger request by `human:<handle>`:
`PUT …/files/{path}` with `If-Match` and `X-Note`, body and frontmatter as JSON. If an agent had
written meanwhile (412), the app merged the two versions block by block and asked the person only
about blocks both sides had changed.

The design notes, exported from tempra-dev as they stood:

- [`archive/tempra-dev/app/editor.md`](archive/tempra-dev/app/editor.md): the editor (Design).
- [`archive/tempra-dev/decisions/editor-wordgard.md`](archive/tempra-dev/decisions/editor-wordgard.md):
  why Wordgard, behind one facade package (Decision).

## How the pieces fit

```
stored tree (mdast + block IDs, @tempra/editor/doc)            ← the Worker stores this
   │  fromTree (bridge.ts)                     ▲ toTree (bridge.ts)
   ▼                                           │
Wordgard document (schema.ts)  ── view.ts: mountReader ── the reader (read-only)
                                     │  setEditable(true) reconfigures one compartment
                                     ▼
                               edit.ts: menu bar, history, GFM commands, Mod-k link dialog,
                                        image paste/drop, change listener
app: pages/File.tsx useEditing ── Editor.tsx: frontmatter form, link targets, image upload,
     (freeze, save bar,             saveConcept (PUT with If-Match), startMerge + MergeView
      leave guard, 412)                  │
                                         ▼
                               merge.ts: merge3 (diff3 over keyed items), mergeDocs (by block ID),
                                         resolve, mergeFields
```

- **`editor/src/schema.ts`**: the Wordgard schema for OKF bodies: Wordgard's GFM types plus Tempra's
  own elements: `BlockId` (a mark carrying the stored block ID; kept on the first half of a split and
  through a type change), `Link` (the URL and title as stored, plus the reader's computed href, path
  and broken flag, never stored), `Image`, `FootnoteRef`, `SoftBreak`, and `RawInline`/`RawBlock`
  (a tree node the schema does not model, carried whole and shown as its markdown).
- **`editor/src/bridge.ts`**: `fromTree(tree, options)` builds the Wordgard document (footnote
  definitions kept beside it, heading anchors, where each textblock starts so text offsets and document
  positions convert both ways: `textOffset`, `documentPos`); `toTree(doc, footnotes)` goes back,
  re-nesting marks into mdast wrappers so `*a **b***` round-trips. Every fixture body survives the trip
  unchanged, IDs included (`editor/editor.test.ts`).
- **`editor/src/view.ts`**: `mountReader`: a read-only, non-editable Wordgard with hover tooltips
  (footnotes, links), a word diff as decorations, comment highlights as a state field of range
  decorations, a selection toolbar (a Wordgard tooltip), and `hideFirst`. `setEditable` swaps the
  compartment between reading and `edit.ts`'s extensions with no remount; `dirty()`, `tree()`,
  `reset()` serve the save.
- **`editor/src/edit.ts`**: the editing side: Wordgard's schema extensions for the blocks and marks,
  history, a menu bar, a Link button and `Mod-k` dialog that offers the library's paths and builds the
  link by the parser's own rules (refusing `javascript:` and `data:`), image files pasted or dropped
  uploaded beside the concept (each pending insert mapped through edits made while it uploads).
- **`editor/src/merge.ts`** (+ `merge.test.ts`): `merge3` (diff3 over keyed items, LCS with the common
  prefix and suffix trimmed), `mergeDocs` (block order by ID, then each block's content takes the side
  that changed it; both changed is a conflict), `resolve`, `mergeFields` (frontmatter field by field).
- **`app/src/Editor.tsx`** (+ `app/editor.test.ts`): the frontmatter form (`formOf`/`frontmatterOf`:
  writes only what the person changed, so a field left alone keeps its exact bytes), `linkTarget` (an
  app URL into this library becomes its bundle path), `uploadImage`, `saveConcept`, `startMerge` and
  `MergeView` (each overlap needs an explicit choice: mine, theirs or both; "Back to editing" keeps the
  original base, so the next save merges again).
- **`app/src/pages/File.tsx` `useEditing`**: freezes the concept on screen while editing (a refresh
  never remounts the reader under the person's hands), the sticky note/Save/Cancel bar, the router's
  leave guard (`setLeaveGuard` in `router.ts`, also covering query changes) and `beforeunload`, the
  412 path into the merge view.
- **`design/src/reader.css`**: the `--wg-*` variable mapping onto Tempra tokens, the `flow-root` caret
  fix, the edit bar, the frontmatter form, the merge view and Wordgard's sticky menu bar offsets.
- **`worker/src/ui/spa.ts`**: the per-response CSP style nonce, passed to `Wordgard.cspNonce` for
  Wordgard's runtime (`style-mod`) style sheets.
- **`worker/scripts/gate.ts`**: the editor step: edit and save with a note in Chromium, Ctrl+K link
  saved as a bundle path, the ledger records `human:` with the note, an agent edits after, a write
  meanwhile is merged at save (twice, through "Back to editing").

## Lessons learned

- **Keep the stored form your own.** The decision to store Tempra's own tree (mdast + block IDs), not
  Wordgard's JSON, is what made removing the editor cheap: comments, anchors, reconciliation and the
  Worker never knew Wordgard existed. Any editor brought back should again be a bridge onto that tree.
- **A reader that is an editor pays the editor's costs.** Tables needed CSS to undo the editor's
  break-anywhere wrapping; a `flow-root` existed only so the caret was drawn on the right line (a
  collapsed top margin put Wordgard's measured and drawn caret apart); constructs the schema could
  not model showed as grey code; a rich block (a diagram) would have needed a node view; injected
  styles forced a CSP nonce; and every reader downloaded the whole engine (the app bundle was 712 KB
  minified, 220 KB gzipped, with it).
- **Merge by block ID, and make the person choose.** Three-way merge over block IDs combined edits to
  neighbouring blocks cleanly. The merge view must pick nothing by default and must keep the edit's own
  base after "Back to editing", or a second save silently overwrites the agent's write.
- **Forms write only what changed.** Re-serializing every frontmatter field on save rewrote offsets,
  seconds and key order that the person never touched; tracking edits per field fixed it.
- **Don't move the focus on Edit.** Focusing put the caret at the start of the body, or after the
  person's click on a fresh view; let them click where they mean to type.
- **Guard every way out.** The leave guard had to cover links, back/forward (restoring the address
  when refused), query changes (`?at=`, `?done=`) and the tab itself.
- **0.x moves fast.** Wordgard went from 0.1 to 0.5.2 in three months; an exact pin and a facade
  package kept the churn contained.
