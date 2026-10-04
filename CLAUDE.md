# CLAUDE.md

## Spec
The source of truth for Tempra's design, decisions and current state is the Tempra library
**`cl_dixon/tempra-dev`**, read and written over the Tempra MCP tools (`start` with
`library: "cl_dixon/tempra-dev"`). Its `guide.md` says what belongs there; `v2/` is the managed
service as built, `delivery/` is CI/CD, `decisions/` records why, `process/workflow.md` is how a
change goes from a Linear issue to production. Read the concepts a feature touches before starting
on it. When implementation shows a concept is wrong, update the concept first, then the code.

OKF semantics, the store, the ledger and the MCP tools are still specified in the v1 Claude Doc,
**OKF Knowledge Service — Spec** (https://claude.ai/artifact/KMuKyyFBSJHzukyEGqvUDn), until they are
carried over. The v2 Claude Doc is retired (carried over at rev 20). There is no markdown copy of
either in this repo; do not add one.

## UI
The app and the landing page share one design system, `design/` (`@tempra/design`, TEMPRA-8): tokens as CSS custom properties (`--tempra-*`, light and dark through `light-dark()`), a base stylesheet and `.prose` for rendered markdown. Edit `design/src/*.css`, then `bun run build` in `design/` to regenerate `design/dist/` (committed; a test fails if it is stale). The app serves it at a hashed path (`/_design/tempra.<hash>.css`, `style-src 'self'`) and links it from every page; the site imports `@tempra/design/tempra.css`. Visual changes go in the package, not in either consumer.

Minimal and barebones first, in the app and on the site (spec: tempra-dev `v2/design-system.md`, UI rule). This is about styling, not technology: white background, dark text, clear links, buttons for actions, no design flourish, and as little text as works (headings, labels, links, short sentences), so the bones of what we build stay visible. Scripts, TypeScript, React components and client-side state are fine where a page needs them; the app is becoming a React SPA (TEMPRA-9). Every visual decision comes from `@tempra/design` (tokens, base CSS, and layout primitives and components as they are needed); neither consumer adds styling beyond its own page layout, and nothing is styled inline. The look comes from a separate design effort (TEMPRA-1) working in the package.

The app is becoming a React SPA, `app/` (`@tempra/app`, TEMPRA-9), screen by screen. Rebuilt pages (library list, directory, concept, ledger, diff) are one shell from the Worker (`worker/src/ui/spa.ts`): the design stylesheet, the bundle at a hashed path (`/_app/app.<hash>.js`, immutable) and an empty root, under a CSP of `script-src 'self'` and `style-src 'self' 'nonce-…'` (a per-response nonce, for Wordgard later); no inline scripts or styles. The server still checks sign-in and, for library pages, `authorizeLibrary` before answering with the shell. The SPA reads everything from the REST API with the session cookie (writes pass `fromThisSite`); `GET …/files/{path}` with `Accept: application/json` describes any file (a concept with its body, a synthesized file's markdown, an attachment's size and type). Concept bodies are drawn by the reader: Wordgard, read-only, through `@tempra/editor` (TEMPRA-10, TEMPRA-11), with footnote and link tooltips, a table of contents and a word diff of the changes since human verification. Wordgard's look comes from `@tempra/design` (`design/src/reader.css` sets its `--wg-*` variables); its runtime styles use the shell's nonce. The app follows writes live (TEMPRA-12): `GET …/feed` upgrades to a WebSocket held by the Library DO with the hibernation API (`worker/src/feed.ts`), counted once on connect against the caller's request limit and metered as `feed`; after each write call the DO pushes the new events. The SPA keeps one socket per library (`app/src/live.ts`), catches up from `GET …/events?since=` after a gap, shows a banner on the concept page (swapping in the new version only while the reader is idle), tails the ledger and reloads directories in place, and marks what is new since the last visit (local storage). The shell's CSP allows the socket (`connect-src 'self' wss://<host>`). Pages not rebuilt yet stay server-rendered HTML in `worker/src/ui/`; sign-in, consent and legal pages stay that way for good.

The landing page (`site/`) is Astro: semantic HTML, the design package plus one small layout stylesheet, no web fonts or third-party scripts.

## Tooling
- **bun for everything JS/TS**: installing (`bun install`, `bun add`), scripts (`bun run …`), tests (`bun test`), one-off binaries (`bunx`). Do not use npm, npx, yarn or pnpm, and do not commit other lockfiles.
- **TypeScript only** on the server (Worker + Durable Object). No Rust or WASM in v1.
- **Biome** for lint and format (`biome.json`); no ESLint or Prettier.
- **cf** (Cloudflare's CLI, beta, pinned) is a dev dependency of `worker/`; run it with `bunx cf …` from `worker/`. The Worker is configured in `worker/cloudflare.config.ts`; there is no `wrangler.jsonc`. To find a command, use `bunx cf cli search "<task>"` (anonymous wording: no names or IDs), then `--help` on the match or `bunx cf schema <command>`; do not walk nested `--help`. cf resource commands take IDs, not names or bindings (scripts/cf.ts reads the D1 ID from the config). Set `CF_SEND_TELEMETRY=false` in scripts and CI. Scripts call cf through `scripts/cf.ts` (async): cf (beta) sometimes prints its result and then never exits (a confirmation prompt keeps it alive, e.g. `d1 migrations apply`), so the helper accepts a complete JSON result once cf goes quiet, and otherwise times out and retries; keep calls made through it safe to repeat.
- **wrangler** stays a dev dependency only as the bundler `cf dev`/`cf build` delegate to (`worker/wrangler.config.ts`). Use Wrangler directly only for what cf lacks: live logs (`bunx wrangler tail tempra`).
- **The site is the exception:** `site/` is configured with `site/wrangler.jsonc`, because Cloudflare Workers Builds (which deploys it and posts PR previews) reads a Wrangler config. It has no bindings or data.

## Commands (from the repo root)
| Command | What it does |
| --- | --- |
| `bun install` | Install all workspace deps |
| `bun run dev` | `cf dev` for the Worker (local D1, R2 and DO state in `worker/.wrangler/state`) |
| `bun run check` | Lint + typecheck + tests; run before every commit |
| `bun run format` | Apply Biome fixes |
| `bun run deploy` | Apply D1 migrations (database ID from `cloudflare.config.ts`), then `cf deploy`; `--dry-run` builds and validates only; `--mode staging` deploys the staging Worker (its resource ids must be set first) |
| `bun run seed` | Create a local user (`dev@localhost`, handle `dev`), library (`dev/dev`) and write token in the local D1; prints the token. From `worker/`, `bun run seed --slug x --actor y` for more |
| `bun run admin` | Accounts on D1 (local, or `--remote`): `users`, `transfer --library <owner>/<slug> --to <email>`, `suspend --email <email> [--undo]`, `limits --email <email> [--set libraries=10] [--reset]`, `invite`/`uninvite --email <email>`, `waitlist`, `rename --email <email> --handle <handle>` (reserved handles allowed) |
| `bun run preview` | PR previews (`tempra-pr-N` on `pr-N.tempra.dev`, own D1, R2, KV): `up --pr N [--email E]` creates what is missing, migrates, deploys, seeds the samples and runs the MCP smoke; `down --pr N` deletes it all; `sweep --keep 3,7` tears down every preview whose PR is not listed; `agents --pr N` runs the scripted agents against it (a token per agent on its `agents` library); `--dry-run` on `down`/`sweep` lists only. CI runs it; creating resources by hand needs the operator's go-ahead |
| `bun run agents` | Scripted agents (no model) working on one library over MCP at once, each with its own token and actor: `--url <base> --seed N` mints local tokens (cf dev), or `--library owner/slug --token T …` for any deployment; scenarios `edit-race`, `live` (watch the printed page; `--pace 2000` slows them to human speed), `load` (`--rounds n`); reports each tool's latency and each write's arrival on the change feed; `--patient` waits out rate limits (the account's 60 writes a minute), `--json` for the report. `bun run preview agents --pr N` runs it against a preview |
| `bun run logs` | Recent events from Workers Observability via `cf observability telemetry query` (`--minutes`, `--errors`, `--json`) |
| `cd design && bun run build` | Regenerate the design package's `dist/` after editing `design/src/` |
| `cd app && bun run build` | Rebuild the SPA bundle (`app/dist/app.ts`, gitignored; `bun install` runs it too). `bun run dev` there rebuilds on every change, beside `bun run dev` at the root |
| `cd site && bun run dev` | The landing page (`site/`, tempra.dev) locally; `bun run check`, `bun test`, `bun run build` there too. It is its own project (own `bun.lock`, not a root workspace) |
| `bun run gate` | Gate: boots `cf dev` on fresh state (a throwaway project in `worker/.gate/`), round-trips Google's sample bundles over HTTP, checks every UI page for them is the app's shell and every file reads through the API (signed in by a dev magic link), drives the SPA in Chromium (every concept of a bundle in the reader, a footnote and a link tooltip, an agent's write reaching the open page live and the ledger tailing it, verify, an agent's edit and the changes since verification; `GATE_SCREENSHOTS=<dir>` saves screenshots), runs the nightly export through the DO into local R2, checks a restore is refused cleanly (no PITR locally), signs up a second account that must see nothing of the first, has a fresh account go through first run, connect over OAuth with PKCE, write through MCP and delete its library, runs the daily sweep through the scheduled handler, runs the MCP smoke flow, and has three scripted agents work on one library at once (every write must reach the change feed); also runs in CI |

Binding types come from `cloudflare.config.ts`: `bun run typecheck` regenerates them with `cf workers types` into `worker/.cloudflare/types/` (gitignored). Secrets are not in the config; type them in `worker/src/env.d.ts`.

## Layout
```
worker/                  Worker + Library Durable Object (TypeScript, Hono)
worker/src/index.ts      Worker entry: wires D1, the Library DO, R2 and KV into createWorker
worker/src/worker.ts     Cloudflare's OAuth provider in front of the app: discovery, /register, /token, guards /mcp
worker/src/app.ts        Hono app: REST routes under /api/v1/libraries/{owner}/{lib}/, with injectable deps
worker/src/auth.ts       Bearer tokens: hash lookup in D1, scope, prefix, expiry, revocation, suspension
worker/src/accounts.ts   Users (handles), libraries and tokens in D1, every query scoped to one account
worker/src/tenancy.ts    authorizeLibrary: the one check that a caller may reach {owner}/{slug}; 404 otherwise. grantLibraries: what an app connection reaches
worker/src/session.ts    Magic links and sessions in D1 (hashes only), the session cookie
worker/src/signin.ts     /sign-in, /sign-out and signedIn(); SIGNUP (open, invite, closed) decides who gets a link
worker/src/origin.ts     fromThisSite(): the same-site check for every state-changing post (Origin, then Sec-Fetch-Site)
worker/src/lifecycle.ts  Deleting a library or an account: rows, grants, then the DO and R2 exports (Deps.destroyLibrary)
worker/src/limits.ts     Per-account limits (libraries, tokens) with overrides in users.limits; storage per library
worker/src/usage.ts      Rate limits (Rate Limiting bindings) and metering (Analytics Engine) for tokens and apps
worker/src/sweep.ts      The daily cron: blob sweep (31 days unreferenced) and operator digest; free of Worker APIs
worker/src/legal.ts      /terms (draft) and /privacy
worker/src/oauth/        /authorize consent (all or selected libraries, like GitHub repo access) and /apps (connected apps: list, revoke)
worker/src/handles.ts    Handle rules: syntax, reserved names (routes, roles, brand), the 90-day hold on released handles
worker/src/ui/spa.ts     The SPA's shell and its bundle route
worker/src/ui/           Built-in UI at the root (`/`, `/<handle>/<library>/…`, library pages under `/-/`; old `/app/…` URLs 308): routes, views, account.ts (welcome, connect, account, delete) for the pages not yet in the SPA
worker/src/feed.ts       The change feed: the events a write pushes to the library's WebSockets, prefix filters; free of Worker APIs
worker/src/client.ts     Worker <-> DO boundary: one `call` RPC, errors as data, R2 blob checks
worker/src/library.ts    Library DO: one per OKF library, hosts the store on its SQLite; its daily alarm runs the maintainers; holds the change feed's WebSockets (hibernation API)
worker/src/maintain.ts   Daily maintainers (nightly export to R2 with retention, usage pruning), free of Worker APIs
worker/src/recovery.ts   Point-in-time restore: pre-restore export, restore records in R2, undo; free of Worker APIs
worker/src/okf/          OKF semantics: parse, record, render, links, footnotes, trust, lint, index/log render, diff
worker/src/store/        Library schema and LibraryStore (writes, ledger, snapshots, queries) against a plain SQLite handle
worker/src/util/tar.ts   Tar reader and writer for import and export
worker/src/mcp/server.ts MCP server at /mcp: stateless Streamable HTTP, tier 1 and tier 2 tools, okf:// resources
worker/cloudflare.config.ts  The Worker for cf: bindings, Durable Object exports, compatibility
worker/scripts/          cf.ts (runs cf, reads the config), deploy.ts, logs.ts, seed.ts (`bun run seed`), admin.ts (`bun run admin`), gate.ts (`bun run gate`), preview.ts (`bun run preview`), mcp-smoke.ts (MCP flow against any URL), restore-smoke.ts (PITR restore and undo against a deployed Worker), agents.ts with agents/ (scripted MCP agents: runner, scenarios)
worker/migrations/       D1 migrations (account layer)
worker/test/             bun tests; worker/test/tsconfig.json adds bun types
design/                  @tempra/design: tokens, base and prose CSS (src/), build.ts generates dist/tempra.css and dist/tempra.ts (css, hash, href)
editor/                  @tempra/editor: the only package that imports Wordgard (pinned exactly). DOM-free entry: schema.ts (the OKF body schema), parse.ts (markdown → mdast → document, with source ranges and a position map), serialize.ts (document → mdast → markdown; unchanged blocks keep their exact source), links.ts (the server's link rules and heading slugs), diff.ts (word diff); view.ts (`@tempra/editor/view`): the read-only reader
app/                     @tempra/app: the React SPA (src/: main.tsx, router.ts, api.ts, urls.ts, ui.tsx, pages/); build.ts bundles it with Vite into dist/app.ts (js, hash, href) for the Worker
site/                    The landing page at tempra.dev: static Astro (src/pages, src/layouts), worker.ts (www redirect, security headers), wrangler.jsonc
skills/okf/SKILL.md      Agent skill doc: the OKF workflow over the MCP tools
fixtures/                Google's four sample OKF bundles, vendored unchanged; do not edit
```

## Testing
- Unit tests run under `bun test`. `cloudflare:workers` does not exist outside workerd, so tests stub it with `mock.module` (see `worker/test/healthz.test.ts`).
- Keep storage and OKF logic free of Worker APIs so it can be tested under bun with `bun:sqlite` standing in for the DO's SQLite handle (`worker/test/sqlite.ts`).
- `editor/editor.test.ts` round-trips every concept body in `fixtures/` (byte for byte unchanged, the same mdast when written from scratch), checks raw constructs survive, unsafe links never reach the document, attributes are escaped, and the position map and word diff. A failing fixture is a bug in the bridge, not a fixture to skip.
- `app/app.test.ts` checks the SPA's router against the server's URLs; the gate drives the SPA in Chromium (`playwright-core`, browser from `CHROME_PATH`, the container's `/opt/pw-browsers/chromium`, or `/usr/bin/google-chrome` on CI runners).
- Route and MCP tests (`worker/test/api.test.ts`, `mcp.test.ts`) run the real app in process via `worker/test/harness.ts`: a bun:sqlite store behind the same `callStore` the DO uses, the real account SQL and migrations on bun:sqlite (`worker/test/d1.ts`), an in-memory blob store and fixed test tokens. `s.app` is signed in as the demo library's owner (`owner/demo`), `s.anon` has no session, `s.stranger()` makes a second account. MCP tests drive it with the SDK's own client.
- Tenancy (`worker/test/tenancy.test.ts`) walks every registered `{owner}/{lib}` route as a stranger and expects 404. A new library route needs nothing extra to be covered, but must go through `authorizeLibrary`.
- MCP tool descriptions and `INSTRUCTIONS` in `worker/src/mcp/server.ts` carry the agent workflow; keep them in step with `skills/okf/SKILL.md`.
- `worker/test/oauth.test.ts` drives the OAuth flow as an MCP client would: discovery, DCR, consent (dev sign-in), token with PKCE, MCP calls, revocation.
- The DO write transaction must stay synchronous (no awaits); hash with `okf/hash.ts`, not WebCrypto.

## Cloudflare
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set in the cloud environment; cf (and wrangler) read them automatically.
- Remote resources: Worker `tempra` on `app.tempra.dev` (custom domain; `workers.dev` is off), D1 `tempra-accounts` (id in `cloudflare.config.ts`), R2 bucket `tempra-blobs`, KV `tempra-oauth`. Do not create or delete remote resources without asking.
- Tokens and libraries are managed at `/tokens` and `/` (or `/api/v1/tokens` and `/api/v1/libraries` with a `human:` token). `bun run seed --remote` (from `worker/`) still creates a library and token directly in the deployed D1.
- KV `tempra-oauth` (binding `OAUTH_KV`) holds OAuth clients and grants. The UI signs people in by email link only (Access was removed at the A4 cut-over); `SIGNUP` (a config var: `invite` in production and staging) decides who may create an account, and `bun run admin invite` manages the list. Local dev uses `DEV_SIGNIN=1` and `SIGNUP=open` from `worker/.dev.vars` (copy `worker/.dev.vars.sample`): sign-in links show on the page for localhost.
- `cloudflare.config.ts` is a function of `--mode`: production by default, `staging` for a separate Worker (`tempra-staging` on `staging.tempra.dev`) with its own D1 `tempra-accounts-staging`, R2 `tempra-blobs-staging` and KV `tempra-oauth-staging`, and `preview` for PR N (`previewDeployment`: `tempra-pr-N` on `pr-N.tempra.dev` with `-pr-N` resources, ids from `TEMPRA_PR`, `TEMPRA_PREVIEW_D1_ID`, `TEMPRA_PREVIEW_KV_ID`; no cron; metering to `tempra_usage_preview`). Scripts pick the mode from `TEMPRA_MODE`. With no mode (`cf dev`, `cf workers types`, a bare dry run) no custom domain is attached; `bun run deploy` defaults to `--mode production`.
- Mail goes through Cloudflare Email Service: the `EMAIL` binding is added only when `mailFrom` is set for a deployment in `cloudflare.config.ts`, which needs a sending domain onboarded in Cloudflare. Production sends from `noreply@mail.tempra.dev` (`mail.tempra.dev` is onboarded); local dev with `DEV_SIGNIN=1` still shows links on the page instead of mailing them. `OPERATOR_EMAIL` (a Worker secret, so the address stays out of the repo) receives the daily digest.
- Rate limits are `WRITE_LIMITER` (60 writes a minute per account) and `REQUEST_LIMITER` (600 requests a minute per token or app); metering writes to the Analytics Engine dataset `tempra_usage`; storage per library is `LIBRARY_STORAGE_MB`.
- The landing page is the Worker `tempra-site` on `tempra.dev` and `www.tempra.dev` (www redirects to the apex). Cloudflare Workers Builds, connected to this repository with root directory `site`, deploys it: `main` runs `wrangler deploy`, other branches run `wrangler preview`, which posts a Preview URL and one per commit on the PR. It does not go through the app's preview/staging/production jobs.
- Naming: the product is Tempra (repository `cldixon/tempra`, `tempra.dev`); OKF names only the file format. The former `okf-service` Workers and their resources were moved and deleted (v2 spec: Move to tempra.dev). Don't introduce `okf-tool`/`okf-service` names.
- `worker/` is the deployable project and must stay self-contained: its own `package.json` with every dependency, nothing imported from outside `worker/` at build time except the `@tempra/design` and `@tempra/app` workspace packages, and `@tempra/editor` inside the app (CI's standalone job builds `worker/` with `design/`, `editor/` and `app/` alone; `bun install` builds the app's bundle). The Worker may import `@tempra/editor`'s DOM-free entry, never `@tempra/editor/view`. `site/` takes the same package as `file:../design`, so Workers Builds must watch `design/*` as well as `site/*`. `cloudflare.config.ts` must not import Worker code (scripts import it under bun).

## CI
`.github/workflows/ci.yml` runs on PRs and pushes to `main`: `bun run check`, `bun run gate` (cf dev, sample-bundle round-trip, UI pages, the SPA and its reader in Chromium, MCP smoke), and a standalone build of `worker/` copied with `design/`, `editor/` and `app/` (`cf deploy --dry-run`). All must pass before merging.

CD (tempra-dev: `delivery/ci-cd.md`) runs after those three, each stage off until its repository variable is `on`:
- `PREVIEWS`: the `preview` job brings up PR N's preview and comments its URL; `preview-cleanup.yml` tears it down when the PR closes and sweeps leftovers nightly.
- `STAGING_DEPLOYS`: every push to `main` deploys staging and checks it (`/healthz`, MCP smoke with secret `STAGING_MCP_TOKEN` if set).
- `PRODUCTION_DEPLOYS`: then production, after approval in the GitHub Environment `production` (configure its required reviewer before turning this on).
- Each push to `main` runs on its own (TEMPRA-18): a run waiting for approval never blocks the next, and deploy jobs deploy only the tip of `main` (a superseded commit skips itself).

The `site/ builds` job checks, tests and builds the landing page; its previews and deploys come from Workers Builds.

Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `PREVIEW_EMAIL` (the operator, seeded as each preview's account), optional `STAGING_MCP_TOKEN`, `PRODUCTION_MCP_TOKEN` (read-only smoke).
