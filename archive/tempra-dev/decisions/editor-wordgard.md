---
type: Decision
title: Concept bodies render and edit with Wordgard, behind @tempra/editor
description: "Decided 2026-10-04: the app renders concept bodies with Wordgard from the start, read-only first, and later lets people edit them; Wordgard is wrapped in one package, @tempra/editor, that speaks markdown."
tags: [decision, app, editor, wordgard]
status: stable
stale_after: 2027-04-04T00:00:00Z
sources:
  - id: wordgard
    title: wordgard 0.5.2 on npm (MIT, Marijn Haverbeke)
    resource: https://www.npmjs.com/package/wordgard
  - id: wordgard-site
    title: Wordgard documentation
    resource: https://wordgard.net/docs/
  - id: v1doc
    title: OKF Knowledge Service, Spec v0.1 ("not a WYSIWYG editor"; "No editor in v1")
    resource: https://claude.ai/artifact/KMuKyyFBSJHzukyEGqvUDn
  - id: project
    title: Linear project P-TEMPRA-9, Web app (React SPA)
    resource: https://linear.app/subverse-labs/project/web-app-react-spa-5a355cae6a89
generated: { by: claude-ai/connector, at: 2026-10-06T02:15:14Z }
---
# Concept bodies render and edit with Wordgard, behind @tempra/editor

Decided 2026-10-04: the app uses Wordgard, Marijn Haverbeke's successor to ProseMirror, as the engine for concept bodies. It starts as a read-only reader (TEMPRA-11) and later becomes the editor (TEMPRA-15) and the base for collaborative editing (TEMPRA-16). Only one package, `@tempra/editor` in `editor/`, imports Wordgard; everything else talks to it in markdown and change events.[^project]

This reverses the v1 stance that the service is not a WYSIWYG editor and that humans edit only by asking an agent.[^v1doc] Agents stay the primary writers and the ledger stays the product; direct editing is for the person who reads a concept and sees a sentence to fix. It is deliberately late in the project's order.

## Why Wordgard

- **Changes are deltas.** A `ChangeSet` has `transform`, `compose`, `invert`, `mapPos` and JSON serialization: the primitive for comment anchors that survive edits, for folding agents' writes into a live view, and for collaboration.[^wordgard]
- **The document and state modules run without a DOM** (verified under Node on 0.5.2). The same schema and corrections can run inside the Library Durable Object, which makes the DO the natural collaboration authority.
- **Reader and editor are one engine.** `GardState.readOnly` and the `Wordgard.editable` facet switch modes without a remount, so decorations, tooltips and anchors are written once.
- **Composable schema with corrections instead of content expressions**, so Tempra nodes (footnote reference, concept link, raw-markdown fallback) are small additions.[^wordgard-site]

## What Wordgard does not provide, and how we cover it

| Gap                                                      | Our answer                                                                                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No markdown parser or serializer (DOM and JSON only)     | The [markdown bridge](/app/markdown-bridge.md): the stored tree (mdast with block IDs) to Wordgard doc and back, and one canonical markdown parser and serializer |
| No React binding                                         | A thin `ConceptView` wrapper in `app/`; the editor DOM is owned by Wordgard                                                                                       |
| No server for `collab`                                   | The Library DO ([Live updates and collaboration](/app/live.md))                                                                                                   |
| Styles injected at runtime by `style-mod`                | A per-response CSP nonce through `Wordgard.cspNonce`                                                                                                              |
| 0.x and moving fast (0.1 in July 2026, 0.5.2 in October) | Exact version pin; the facade keeps a swap to ProseMirror or TipTap possible                                                                                      |

## Options considered

| Option                         | Why not                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ProseMirror or TipTap          | Mature, with `prosemirror-markdown` and React bindings, but a tree-with-steps change model and DOM-bound server story; the delta model fits the ledger better |
| Lexical, Slate                 | Framework-bound or weaker on structured schemas and collaboration                                                                                             |
| No editor, server HTML forever | Rules out anchored comments, live diffs and editing without a second rendering path                                                                           |

## Consequences

- `editor/` joins `design/` as a package `worker/` may import (DOM-free parts only).
- Human edits are attributed `human:<handle>` with a required note, like any ledger request.
- Since TEMPRA-22 the facade speaks the stored tree, not markdown, and the tree is our own schema, not Wordgard's ([structured documents](/decisions/structured-documents.md)); the canonical serializer defines how every body reads to agents.

[^project]: Issues TEMPRA-10, 11, 15, 16.

[^v1doc]: Overview ("What it is not") and Human interfaces ("No editor in v1").

[^wordgard]: `dist/doc.d.ts` and `dist/collab.d.ts` of the published package.

[^wordgard-site]: System guide and reference manual.
