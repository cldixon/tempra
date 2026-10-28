<script lang="ts">
  import { docText, locate, wordDiff } from "@tempra/editor";
  import {
    highlightsOf,
    type Placed,
    panelOrder,
    placeThreads,
    type Thread,
  } from "../comments/data";
  import Reader from "../Reader.svelte";
  import { prepare } from "../reader/prepare";
  import { revealOffset } from "../reader/reading";
  import { clip, localTime, relativeTime } from "../ui";
  import { dirOf, folderName } from "../urls";
  import {
    actedText,
    addressText,
    askText,
    bodyOptions,
    conceptOf,
    nameOf,
    type PageHost,
    type PagePayload,
  } from "./page";

  /**
   * The page panel (tempra-dev: app/page-panel): a page drawn in the chat by the app's reader,
   * with what the agent asks of the person, who wrote it and when, its comment threads, and the
   * person's actions: comment on a passage or the page, reply and resolve, check it in Tempra, ask
   * the agent about a passage in the chat, follow a link to another page in place, open it in
   * Tempra. Inline it shows the head and the page's start; Read the whole page opens it in full
   * (the host's full screen where it has one). The look is @tempra/design's (panel.css, prose.css,
   * reader.css, comments.css).
   */
  let { host }: { host: PageHost } = $props();

  let page = $state.raw<PagePayload | null>(null);
  let failed = $state<string | null>(null);
  /** Pages opened from links, for Back. */
  let trail = $state.raw<PagePayload[]>([]);
  let full = $state(false);
  let fullscreen = $state(false);
  let showChanges = $state(true);
  let commentsOpen = $state(false);
  let active = $state<string | null>(null);
  let busy = $state(false);
  let notice = $state<string | null>(null);
  /** The thread the person just started, offered to the agent to address. */
  let started = $state.raw<Thread | null>(null);
  /** A comment or a question being written: on a passage, or (a comment) on the page. */
  let draft = $state.raw<{
    kind: "comment" | "ask";
    quote: string | null;
    from: number;
    to: number;
  } | null>(null);
  let words = $state("");
  let replies = $state<Record<string, string>>({});

  $effect(() =>
    host.subscribe({
      page: (p) => {
        if (p === null) {
          failed = "This page could not be shown. Ask the agent to show it again.";
          return;
        }
        failed = null;
        page = p;
        commentsOpen = p.threads.some((t) => t.status === "open") && !!p.ask;
      },
      mode: (m) => {
        fullscreen = m === "fullscreen";
        if (fullscreen) full = true;
      },
    }),
  );

  const body = $derived.by(() => {
    if (!page) return null;
    const { options, numbers } = bodyOptions(page);
    return { prepared: prepare(page.concept.doc, options), numbers };
  });
  const prepared = $derived(body?.prepared ?? null);
  const hideFirst = $derived.by(() => {
    const first = prepared?.headings[0];
    const title = page?.concept.title.trim().toLowerCase() ?? "";
    return first?.first === true && first.text.trim().toLowerCase() === title;
  });
  const diff = $derived(
    page?.before && prepared && showChanges
      ? wordDiff(docText(page.before.doc), prepared.text)
      : null,
  );
  const placed = $derived<Placed[]>(
    page && prepared ? placeThreads(page.threads, prepared.text) : [],
  );
  const open = $derived(panelOrder(placed, "open"));
  const resolved = $derived(panelOrder(placed, "resolved"));
  // The passage the agent pointed at, found in the text as a comment's quote is.
  const focus = $derived.by(() => {
    if (!page?.focus || !prepared) return null;
    // The agent copies it from `read`, as markdown: its emphasis and code marks are not text.
    const quote = page.focus.replace(/[*_`]+/g, "").trim();
    return locate(prepared.text, {
      quote,
      prefix: "",
      suffix: "",
      from: 0,
      block: null,
      offset: 0,
    });
  });
  const highlights = $derived.by(() => {
    const marks = highlightsOf(
      placed,
      active,
      draft?.quote ? { quote: draft.quote, from: draft.from, to: draft.to } : null,
    );
    if (focus && !draft) marks.push({ id: "focus", from: focus.from, to: focus.to, active: true });
    return marks;
  });
  // Show the passage the agent pointed at once the page is drawn.
  let shownFocus = "";
  $effect(() => {
    const at = focus;
    const key = page ? `${page.concept.path}@${page.concept.seq}` : "";
    if (!at || shownFocus === key) return;
    shownFocus = key;
    full = true;
    requestAnimationFrame(() => revealOffset(at.from));
  });

  const folders = $derived(page ? dirOf(page.concept.path) : "");
  const author = $derived(
    page?.byline
      ? nameOf(
          page,
          page.byline.actor,
          page.byline.agent ? { person: "", agent: page.byline.agent } : null,
        )
      : null,
  );
  const say = (text: string) => {
    notice = text;
  };

  async function act(args: {
    action: "open" | "reply" | "resolve" | "reopen";
    thread?: string;
    quote?: string | null;
    from?: number;
    body?: string;
  }): Promise<PagePayload | null> {
    const p = page;
    if (!p?.grant || busy) return null;
    busy = true;
    notice = null;
    try {
      const next = await host.act({
        grant: p.grant,
        library: `${p.library.owner}/${p.library.slug}`,
        since: p.before?.seq,
        ...args,
        quote: args.quote ?? undefined,
      });
      page = { ...next, ask: p.ask, focus: p.focus, before: p.before ?? next.before };
      void host.tell(actedText(next, args));
      return next;
    } catch (e) {
      say(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      busy = false;
    }
  }

  function startDraft(kind: "comment" | "ask", range: { from: number; to: number } | null) {
    const text = prepared?.text.text ?? "";
    draft = range
      ? { kind, quote: text.slice(range.from, range.to), from: range.from, to: range.to }
      : { kind, quote: null, from: 0, to: 0 };
    words = "";
    started = null;
    if (kind === "comment") commentsOpen = true;
  }

  async function submitDraft(e: SubmitEvent) {
    e.preventDefault();
    const d = draft;
    const p = page;
    const said = words.trim();
    if (!d || !p || !said) return;
    if (d.kind === "ask") {
      const sent = await host.ask(askText(p, d.quote ?? "", said));
      if (sent) {
        draft = null;
        words = "";
        say("Sent to the chat.");
      } else say("This chat cannot take messages from the panel. Copy the question into the chat.");
      return;
    }
    const before = new Set(p.threads.map((t) => t.id));
    const next = await act({
      action: "open",
      quote: d.quote,
      from: d.quote ? d.from : undefined,
      body: said,
    });
    if (!next) return;
    draft = null;
    words = "";
    started = next.threads.find((t) => !before.has(t.id)) ?? null;
    active = started?.id ?? null;
    say("Comment posted.");
  }

  async function reply(t: Thread, kind: "reply" | "resolve" | "reopen", e?: Event) {
    e?.preventDefault();
    const said = (replies[t.id] ?? "").trim();
    if (kind === "reply" && !said) return;
    const next = await act({ action: kind, thread: t.id, body: said || undefined });
    if (!next) return;
    replies = { ...replies, [t.id]: "" };
    if (kind === "resolve") active = null;
  }

  // Checking stays in the app, where the person is signed in (tempra-dev app/mcp-app-questions, 2):
  // its review mode shows the changes since they last checked it, and Mark as checked.
  function checkInTempra() {
    const p = page;
    if (!p) return;
    void host.openLink(p.review).then((ok) => {
      if (!ok) say(`Check it in your browser: ${p.review}`);
    });
  }

  async function openPage(path: string) {
    const p = page;
    if (!p || busy) return;
    busy = true;
    try {
      const next = await host.open(path, `${p.library.owner}/${p.library.slug}`);
      trail = [...trail, p];
      page = next;
      draft = null;
      started = null;
      active = null;
      full = true;
      window.scrollTo(0, 0);
    } catch (e) {
      say(e instanceof Error ? e.message : String(e));
    } finally {
      busy = false;
    }
  }

  function back() {
    const prev = trail.at(-1);
    if (!prev) return;
    trail = trail.slice(0, -1);
    page = prev;
    draft = null;
    active = null;
  }

  async function readAll() {
    full = true;
    if (host.canFullscreen() && (await host.fullscreen())) fullscreen = true;
  }

  // Links: a section of this page scrolls; another page opens in place; anything else in the
  // person's browser, through the host.
  function follow(e: MouseEvent) {
    const p = page;
    const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (!p || !(a instanceof HTMLAnchorElement) || e.defaultPrevented) return;
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("#")) return;
    e.preventDefault();
    const path = conceptOf(p, a.href);
    if (path && path !== p.concept.path && host.canCall()) void openPage(path);
    else
      void host.openLink(a.href).then((ok) => {
        if (!ok) say(`Open this link in your browser: ${a.href}`);
      });
  }

  function openInTempra() {
    const p = page;
    if (!p) return;
    void host.openLink(p.url).then((ok) => {
      if (!ok) say(`Open the page in your browser: ${p.url}`);
    });
  }
</script>

{#snippet when(ts: string)}<time datetime={ts} title={localTime(ts)}>{relativeTime(ts)}</time>{/snippet}
{#snippet said(c: Thread["comments"][number])}<div class="said"
    ><div class="said-by"><b>{page ? nameOf(page, c.actor, c.by) : c.actor}</b>{" "}{@render when(c.ts)}</div
    ><p class="comment">{c.body}</p></div
  >{/snippet}
{#snippet threadCard(t: Placed)}
  {@const outdated = t.anchor !== null && t.at === null}
  {#if active !== t.id}
    <button
      type="button"
      class={t.status === "open" ? "thread collapsed" : "thread collapsed resolved"}
      aria-expanded="false"
      onclick={() => {
        active = t.id;
        if (t.at) revealOffset(t.at.from);
      }}
      >{#if outdated}<span class="thread-outdated">Outdated</span>{/if}{#if t.anchor}<span class="quote thread-quote">{clip(t.anchor.quote, 120)}</span>{/if}<span
        class="thread-meta"
        >{#if t.comments[0]}<b>{page ? nameOf(page, t.comments[0].actor, t.comments[0].by) : ""}</b><span class="thread-words">{clip(t.comments[0].body, 80)}</span>{/if}{#if t.replies > 0}<span class="thread-replies">{t.replies + 1}</span>{/if}</span
      ></button
    >
  {:else}
    <section class={t.status === "open" ? "thread open" : "thread open resolved"} aria-label="Comment thread"
      >{#if outdated}<span class="thread-outdated">Outdated</span>{/if}{#if t.anchor}<blockquote class="quote thread-quote">{clip(t.anchor.quote, 300)}</blockquote>{/if}{#each t.actions ?? [] as a (a.seq)}{@const c = a.comment ? t.comments.find((x) => x.id === a.comment) : undefined}{#if a.kind === "resolve" || a.kind === "reopen"}<div
            ><p class="said-change">{a.kind === "resolve" ? "Resolved" : "Reopened"} by {page ? nameOf(page, a.actor, a.by) : a.actor}{" "}{@render when(a.ts)}</p
            >{#if c}<p class="comment">{c.body}</p>{/if}</div
          >{:else if c}{@render said(c)}{/if}{/each}{#if page?.viewer.comment && host.canCall()}<form class="reply-form" onsubmit={(e) => reply(t, "reply", e)}
          >{#if t.status === "open"}<label class="visually-hidden" for={`reply-${t.id}`}>Reply</label><textarea
              id={`reply-${t.id}`}
              rows="2"
              placeholder="Reply…"
              value={replies[t.id] ?? ""}
              oninput={(e) => (replies = { ...replies, [t.id]: e.currentTarget.value })}
            ></textarea>{/if}<div class="actions"
            >{#if t.status === "open"}<button type="button" disabled={busy} onclick={() => reply(t, "resolve")}>Resolve</button
              ><button type="submit" class="primary" disabled={busy || !(replies[t.id] ?? "").trim()}>Reply</button
              >{:else}<button type="button" disabled={busy} onclick={() => reply(t, "reopen")}>Reopen</button>{/if}</div
          ></form
        >{/if}</section
    >
  {/if}
{/snippet}

{#if failed}
  <p class="pp-failed">{failed}</p>
{:else if !page || !prepared}
  <p class="muted">Opening the page…</p>
{:else}
  <!-- Links are followed by one listener on the page; each is still a link, reached by the keyboard. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <article class={["page-panel", full && "full", fullscreen && "fullscreen", commentsOpen && "with-comments"]} onclick={follow}>
    <header class="pp-head">
      <p class="pp-where">
        {#if trail.length > 0}<button type="button" class="pp-back" onclick={back}>Back</button>{/if}<span
          >{page.library.owner}/{page.library.slug}{#if folders}{" · "}{folders.split("/").map(folderName).join(" / ")}{/if}</span
        >
      </p>
      {#if page.ask}<p class="pp-ask"><span class="pp-ask-who">{author && page.byline?.agent ? author : "The agent"} asks</span>{page.ask}</p>{/if}
      <h1 class="pp-title">{page.concept.title}</h1>
      {#if page.concept.description}<p class="pp-description">{page.concept.description}</p>{/if}
      <p class="pp-byline">
        {#if page.byline}<span>{author}{" · edited "}{@render when(page.byline.at)}</span>{/if}{#if page.concept.status && page.concept.status !== "stable"}<span
            class="chip">{page.concept.status[0]?.toUpperCase()}{page.concept.status.slice(1)}</span
          >{/if}{#if page.concept.stale}<span class="chip">Stale</span>{/if}
      </p>
      {#if page.checked}<p class="pp-checked">
          Checked by {nameOf(page, page.checked.actor)}, {@render when(page.checked.at)}{#if page.checked.since > 0}{" · "}{page.checked.since}
            {page.checked.since === 1 ? "change" : "changes"} since{/if}
        </p>{/if}
      <div class="pp-tools" role="toolbar" aria-label="Page">
        <button type="button" aria-pressed={commentsOpen} onclick={() => (commentsOpen = !commentsOpen)}
          >Comments{#if open.length > 0}{" "}<span class="pp-count">{open.length}</span>{/if}</button
        >{#if page.before}<button type="button" aria-pressed={showChanges} onclick={() => (showChanges = !showChanges)}>Changes</button
          >{/if}{#if page.viewer.check && (!page.checked || page.checked.since > 0)}<button type="button" onclick={checkInTempra}
            >{page.checked ? "Review changes in Tempra" : "Check in Tempra"}</button
          >{/if}<button type="button" onclick={openInTempra}>Open in Tempra</button>
      </div>
    </header>

    {#if page.before && showChanges}<p class="pp-changes" role="note">
        Changes {page.before.label}, marked in the text.
      </p>{/if}

    <div class="pp-columns">
      <div class={["pp-page", !full && "clipped"]}>
        <div class="doc">
          <Reader
            {prepared}
            {diff}
            {hideFirst}
            {highlights}
            onMark={(id) => {
              if (!id || id === "focus") return;
              active = id;
              commentsOpen = true;
            }}
            onComment={page.viewer.comment && host.canCall() ? (r) => startDraft("comment", r) : undefined}
            onAsk={host.canAsk() ? (r) => startDraft("ask", r) : undefined}
            figureView={{ title: page.concept.title }}
          />
          {#if page.sources.length > 0}
            <section class="pp-sources prose" aria-labelledby="pp-sources">
              <h2 id="pp-sources">Sources</h2>
              <ol>
                {#each page.sources as s (s.id)}
                  <li id={`src-${s.id}`}>
                    {#if s.resource && /^https?:\/\//.test(s.resource)}<a href={s.resource}>{s.title ?? s.resource}</a
                      >{:else}{s.title ?? s.resource ?? s.id}{/if}
                  </li>
                {/each}
              </ol>
            </section>
          {/if}
        </div>
        {#if !full}<div class="pp-more"><button type="button" onclick={readAll}>Read the whole page</button></div>{/if}
      </div>

      {#if commentsOpen || draft}
        <aside class="pp-side" aria-label="Comments">
          {#if draft}
            <form class="thread open comment-form" onsubmit={submitDraft}
              >{#if draft.quote}<blockquote class="quote thread-quote">{clip(draft.quote, 300)}</blockquote>{/if}<label
                class="visually-hidden"
                for="pp-draft">{draft.kind === "ask" ? "Ask the agent" : "Comment"}</label
              ><textarea
                id="pp-draft"
                rows="3"
                placeholder={draft.kind === "ask" ? "Ask about this passage…" : draft.quote ? "Comment on this…" : "Comment on the page…"}
                bind:value={words}
                onkeydown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    draft = null;
                  }
                }}
                {@attach (el) => el.focus()}
              ></textarea>{#if draft.kind === "ask"}<p class="small muted">Sent to the chat as your message, with the passage.</p>{/if}<div
                class="actions"
                ><button type="button" class="ghost" onclick={() => (draft = null)}>Cancel</button
                ><button class="primary" type="submit" disabled={busy || !words.trim()}
                  >{draft.kind === "ask" ? "Send to chat" : "Comment"}</button
                ></div
              ></form
            >
          {/if}
          {#if commentsOpen}
            {#if started && host.canAsk()}
              <p class="pp-started">
                <button
                  type="button"
                  onclick={async () => {
                    const t = started;
                    if (!page || !t) return;
                    if (await host.ask(addressText(page, t))) {
                      started = null;
                      say("Asked the agent to address it.");
                    }
                  }}>Ask the agent to address it</button
                >
              </p>
            {/if}
            {#if page.viewer.comment && host.canCall() && !draft}
              <div class="new-thread-box">
                <button type="button" class="new-thread" onclick={() => startDraft("comment", null)}>Comment on the page…</button>
                <p class="small muted">Or select text to comment on it</p>
              </div>
            {/if}
            {#each open as t (t.id)}{@render threadCard(t)}{/each}
            {#if open.length === 0}<p class="small muted">No open threads.</p>{/if}
            {#if resolved.length > 0}
              <details class="pp-resolved">
                <summary>Resolved {resolved.length}</summary>
                {#each resolved as t (t.id)}{@render threadCard(t)}{/each}
              </details>
            {/if}
          {/if}
        </aside>
      {/if}
    </div>
    <p class="pp-status small" role="status" aria-live="polite">{notice ?? ""}</p>
  </article>
{/if}
