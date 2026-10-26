# Porting app/ from React 19 to Svelte 5 (working notes, deleted before the PR)

The whole app is being ported in one branch (`svelte-migration`). Several agents port disjoint
sets of files at once; the integrator owns `App.svelte`, `main.ts`, the foundations below and
git. **Do not run git commands** (no add/commit/stash/checkout), do not touch files outside your
list, and do not run `bun run gate` or `cf dev`.

## Rules

- Plain Svelte 5 with runes, `<script lang="ts">`. Not SvelteKit.
- **Same DOM** wherever CSS (`design/src/*.css`) or the gate (`worker/scripts/gate.ts`) can see
  it: every element, class name, id, `data-*` attribute (`data-block`, `data-text`, `data-atom`,
  `data-skip`, `data-stay`, `data-autofocus`, …), ARIA role/name/state, `popover`, `inert`, the
  text people read. Grep `gate.ts` for your class names and texts before you change any markup.
  The gate is the acceptance test: its assertions do not change.
- **CSP is `script-src 'self'; style-src 'self'`**: no `<style>` blocks, no `style="…"`
  attributes, no `style:` directives, no Svelte transitions/animations, no `{@html}`. Placement
  goes through the CSSOM as today (`el.style.setProperty("--float-x", …)` in an effect).
- **Whitespace**: JSX drops whitespace between elements on separate lines; Svelte keeps one
  space. Where the React output had no space between two inline elements or between text and an
  element (`<b>{name}</b><span> for x</span>`, `<Icon/>Account`), write them adjacent on one line
  (or break inside the tag: `<b>{x}</b\n><span>`). Explicit `{" "}` in JSX is a real space.
  Text content the gate or tests read must come out identical.
- Comments in components: keep the React file's doc comments (they carry the design's why).
  Match the surrounding style: short sentences, tempra-dev / TEMPRA-n references kept.
- Biome formats `.ts` files; keep `.svelte` files tidy by hand (2-space indent, double quotes).

## File mapping

- A component `X` in `Foo.tsx` becomes `X.svelte` beside it (one component per file, named after
  the component). Small private helpers used by one component may stay in its `<script>`, or in a
  `<script module>` block when they are exported pure functions/types/constants.
- Non-component exports of a `.tsx` file (pure functions, types, constants) go to a `.ts` module
  named after the file with a lower-case first letter (`concept/History.tsx` → `concept/history.ts`,
  `pages/File.tsx` → `pages/file.ts`, `activity.tsx` → `activity.ts`). A hook (anything using React
  state/effects) goes to a `.svelte.ts` module (`concept/live.tsx` → `concept/live.svelte.ts`).
- Delete each `.tsx`/`.ts` file you ported once its replacement exists (plain `rm`, not git).
- Import with explicit extensions for Svelte: `import X from "./X.svelte"`,
  `import { useLoad } from "./load.svelte.ts"`. Plain `.ts` modules are imported without an
  extension, as today (`"./urls"`).

## React → Svelte

| React | Svelte 5 |
| -- | -- |
| props | `let { a, b = 1 }: { a: string; b?: number } = $props();` (or `let props: {...} = $props()`) |
| `children` / render props | `Snippet` / `Snippet<[T]>`: `{@render children()}`, `{#snippet name(x)}…{/snippet}` |
| `useState` | `let x = $state(v)`; data objects from the API: `$state.raw` (never deep-proxy API data: `share()` in cache.ts relies on identity) |
| `useMemo` | `const x = $derived(expr)` / `$derived.by(() => …)` |
| `useCallback` | a plain function |
| `useEffect` / `useLayoutEffect` | `$effect(() => { …; return cleanup })` (`$effect.pre` for before-DOM-update work); wrap reads you do not want tracked in `untrack` |
| `useRef` to an element | `let el: HTMLElement \| undefined = $state(); … bind:this={el}` |
| `useRef` for a mutable value | a plain `let` in the script |
| `key={…}` to remount | `{#key value}…{/key}` |
| context | `setContext` / `getContext` (see `frame.svelte.ts`) |
| `useId` | `const id = $props.id()` |
| conditional class | `class={cond ? "a b" : "a"}` (same strings as React's `className`) |
| `onClick` | `onclick`; `onKeyDown` → `onkeydown`; `onBlur` (bubbling in React) → `onfocusout`; `onFocus` → `onfocusin` |
| `dangerouslySetInnerHTML` | not allowed |
| `createPortal` | `Portal.svelte` (`<Portal target={el}>…</Portal>`) |

**Hooks become rune functions** in `.svelte.ts` modules, called while a component initialises.
Arguments that can change are **getters** (`useLoad(() => key, load)`), and results are objects
read through getters (`me.current`, `loaded.data`) — **never destructure them** (`const { data } =
loaded` freezes the value). Same for `useFrame()`: read `frame.narrow` where it is used.

## Foundations (already ported; use them, do not edit — ask the integrator in your report)

- `router.ts` (unchanged, framework-free): `match`, `navigate`, `pageKey`, `followsInPlace`,
  `lastNavigation`, `interceptLinks`. `location.svelte.ts`: `here.url` (the current `URL`, a rune).
- `api.ts`: `api<T>(url, init)`, `ApiError`, `Loaded<T>`, `field`, `prefetch(key, load)`,
  `holding()`. `load.svelte.ts`: `useLoad(() => key, load)` → `{ current: Loaded<T>, state, data,
  error, reload() }`; `useAction()` → `{ busy, error, setError(e), run(fn) }`.
- `cache.ts`, `boot.ts`, `urls.ts`, `prefetch.ts`, `recent.ts`, `changes.ts` (unchanged).
- `ui.ts` (pure): `Me`, `Tone`, `who`, `relativeTime`, `localTime`, `day`, `calendarDay`, `clip`,
  `formatSize`, `switcherKey`, `commentKey`, `plural`, `anchorId`, `baseName`.
  `ui.svelte.ts`: `useMe()` → `.current: Me | null`; `useTitle(() => title)`;
  `useScrollToHash(() => ready)`; `useNow(ms?)` → `.current`; `useCopy()` → `{ state, copy(text) }`.
- Components: `Status.svelte` (`<Status loaded={l.current}>{#snippet children(data)}…{/snippet}</Status>`),
  `ErrorView.svelte` (`error`), `Chip.svelte`, `TrustChip.svelte`, `AtNotice.svelte`
  (`urls, head, current`), `Moment.svelte` (`ts, now?`), `AgentName.svelte` (`who`),
  `CopyField.svelte` (`value, label, id?`), `Icon.svelte` (`name: Glyph, size?`; `import Icon, { type Glyph } from "./Icon.svelte"`),
  `Avatar.svelte` (`name, agent?`), `Menu.svelte` (props as React's `Menu`; `label` is a snippet,
  content is `children`), `Bell.svelte`, `AccountMenu.svelte` (`me`), `ThemeChoice.svelte`
  (`value, onChange`), `Dialog.svelte` (`title, open, onClose, wide?`, children),
  `ComposeDialog.svelte` (React's props; `context` and `fields` are snippets, `onSubmit(e)` gets
  the SubmitEvent), `confirm.svelte.ts` `useConfirm()` → `{ ask, confirm(ask), close() }` with
  `<ConfirmDialog asking={c} />` (`Ask.body` is a string or a snippet), `PageBar.svelte` (`path?`,
  `actions?` snippets, `phoneTools?`), `PageColumn.svelte` (`wide?`), `Portal.svelte`.
- `chrome.ts`: `initials`. `modal.ts`: the dialog attachment.
- `frame.ts`: `Place`, `NARROW`, `SETTINGS_VIEWS`, `AccountPage`. `frame.svelte.ts`: `Frame`,
  `provideFrame(frame)`, `useFrame()`, `useTitleOf()` → `.of(path)`, `useMedia(() => query)` → `.current`.
- `tree.ts`: `OutlineFile`, `fileLabel`.
- `live.ts` (framework-free: `LibraryFeed`, `FeedEvent`, `FeedStatus`, `feedOf`, …);
  `live.svelte.ts`: `useFeedStatus(() => urls)` → `.current`; `useFeed(() => urls, () => from,
  onEvents, onReset)`; `useTrailing(fn, ms)`.
- `agents.ts`, `role.ts`, `inbox.ts`: the pure helpers and types, unchanged. Their hooks are in
  `agents.svelte.ts`, `role.svelte.ts`, `inbox.svelte.ts`:
- `agents.svelte.ts` (`useActors(() => urls, () => me)` → `{ view(actor,
  by), contributors }`; `useAgentNames(() => urls)` → `{ label(actor, by), note(id) }`).
- `role.svelte.ts`: `useLibraries()` (a Load), `useRole(() => lib)` → `.current`,
  `useLibraryLabel(() => lib)` → `.current`.
- `inbox.svelte.ts`: `useUnread()` → `.current`;
  `useAgentLabels(() => items)` → `.current`; `usePageTitles(() => items)` → `.current`.
- `theme.svelte.ts`: `useTheme()` → `{ current, choose(t) }`, `THEMES`, `applyTheme`, `currentTheme`.

## Tests

- `bun test --conditions browser <files>` from `app/` (the package's `test` script). A preload
  (`test/setup.ts`) compiles `.svelte`/`.svelte.ts` and installs one global happy-dom window.
- `test/dom.ts`: `draw(Component, props)` → `{ host, destroy() }` (mount + flushSync), `settle(ms)`.
  Use `flushSync()` from `svelte` after changing state. React's `renderToStaticMarkup` →
  `draw(…)` and `host.innerHTML`; `act` → `flushSync`/`settle`.
- Port a `.test.tsx` to `.test.ts`; keep every assertion exactly as strict. Svelte leaves `<!---->`
  comment anchors in the DOM: compare text and attributes, or strip comments, never weaken the check.
- A failing fixture is a bug in the port, never a test to skip or loosen.
- Typecheck your files: `bunx svelte-check --tsgo --tsconfig ./tsconfig.json --threshold error`
  reports the whole app, so filter its output to your files (others are mid-port).
