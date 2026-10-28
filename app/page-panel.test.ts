/**
 * The page panel (tempra-dev app/page-panel), drawn with a fake host: the page as the reader
 * draws it, the agent's ask, its threads, links followed in place, and what it sends as
 * `page_act`, to the chat and to the model's context.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { parseMarkdown } from "@tempra/editor";
import { flushSync } from "svelte";
import type { Thread } from "./src/comments/data";
import PagePanel from "./src/panels/PagePanel.svelte";
import {
  type ActArgs,
  actedText,
  askText,
  conceptOf,
  nameOf,
  type PageHost,
  type PagePayload,
  pageFrom,
} from "./src/panels/page";
import { draw, settle } from "./test/dom";

const THREAD: Thread = {
  id: "th1",
  path: "metrics/margin.md",
  status: "open",
  actor: "claude-ai/connector",
  created_seq: 3,
  last_seq: 3,
  resolved_by: null,
  replies: 0,
  anchor: {
    quote: "revenue minus cost",
    prefix: "",
    suffix: "",
    from: 10,
    block: null,
    offset: 0,
    seq: 3,
  },
  comments: [
    {
      id: "c1",
      actor: "claude-ai/connector",
      by: { person: "u1", agent: "a1" },
      body: "Which cost?",
      ts: "2026-10-28T01:00:00Z",
      seq: 3,
    },
  ],
  actions: [
    {
      kind: "open",
      actor: "claude-ai/connector",
      by: { person: "u1", agent: "a1" },
      ts: "2026-10-28T01:00:00Z",
      seq: 3,
      comment: "c1",
    },
  ],
};

function payload(over: Partial<PagePayload> = {}): PagePayload {
  return {
    v: 1,
    origin: "https://pr-1.tempra.dev",
    library: { owner: "ann", slug: "notes" },
    url: "https://pr-1.tempra.dev/ann/notes/metrics/margin.md",
    review: "https://pr-1.tempra.dev/ann/notes/metrics/margin.md?review=1",
    viewer: { id: "u1", handle: "ann", comment: true, check: true },
    grant: "g.sig",
    ask: "Does this match what we agreed?",
    focus: null,
    concept: {
      path: "metrics/margin.md",
      seq: 4,
      hash: "h",
      title: "Margin",
      description: "Gross margin.",
      status: "draft",
      type: "Metric",
      stale: false,
      doc: parseMarkdown(
        "# Margin\n\nMargin is revenue minus cost. See [costs](/metrics/costs.md) and [the web](https://example.com).\n",
      ),
      images: {},
    },
    head: 4,
    sources: [],
    broken: [],
    byline: { actor: "claude-ai/connector", agent: "a1", at: "2026-10-28T01:00:00Z" },
    checked: null,
    before: null,
    threads: [THREAD],
    names: { a1: "Claude for @ann" },
    ...over,
  };
}

function fakeHost(opts: { calls?: boolean; message?: boolean } = {}) {
  const acts: ActArgs[] = [];
  const asked: string[] = [];
  const told: string[] = [];
  const opened: string[] = [];
  const links: string[] = [];
  let on: Parameters<PageHost["subscribe"]>[0] | null = null;
  const host: PageHost = {
    subscribe(l) {
      on = l;
      return () => {
        on = null;
      };
    },
    canCall: () => opts.calls ?? true,
    act: async (args) => {
      acts.push(args);
      const threads =
        args.action === "open"
          ? [
              ...payload().threads,
              {
                ...THREAD,
                id: "th2",
                actor: "human:ann",
                comments: [
                  { ...THREAD.comments[0], id: "c2", actor: "human:ann", body: args.body },
                ],
                actions: [],
              } as Thread,
            ]
          : payload().threads;
      return payload({ threads, ask: null });
    },
    open: async (path) => {
      opened.push(path);
      return payload({
        concept: { ...payload().concept, path, title: "Costs", doc: parseMarkdown("Costs.\n") },
        ask: null,
      });
    },
    canAsk: () => opts.message ?? true,
    ask: async (text) => {
      asked.push(text);
      return true;
    },
    tell: async (text) => {
      told.push(text);
    },
    openLink: async (url) => {
      links.push(url);
      return true;
    },
    canFullscreen: () => false,
    fullscreen: async () => false,
  };
  const give = (p: PagePayload | null) => {
    on?.page(p);
    flushSync();
  };
  return { host, give, acts, asked, told, opened, links };
}

const button = (root: HTMLElement, name: string) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(name));

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("the page panel", () => {
  test("pageFrom takes a show result's page and nothing else", () => {
    expect(pageFrom({ structuredContent: { page: payload() } })?.concept.title).toBe("Margin");
    expect(pageFrom({ structuredContent: { upload: {} } })).toBeNull();
    expect(pageFrom({ structuredContent: { page: { v: 2 } } })).toBeNull();
    expect(pageFrom(null)).toBeNull();
  });

  test("names people as the app does", () => {
    const p = payload();
    expect(nameOf(p, "human:ann")).toBe("You");
    expect(nameOf(p, "human:bo")).toBe("@bo");
    expect(nameOf(p, "claude-ai/connector", { person: "u1", agent: "a1" })).toBe("Claude for @ann");
    expect(nameOf(p, "claude-code/laptop")).toBe("Claude Code");
    // Words typed in the chat's panel are the person's: "You", or "@bo, in Claude".
    const chat = { person: "u1", agent: "a1", surface: "chat" as const };
    expect(nameOf(p, "claude-ai/connector", chat)).toBe("You");
    const bo = { person: "u2", agent: "a2", surface: "chat" as const };
    expect(nameOf({ ...p, names: { a2: "Claude for @bo" } }, "claude-ai/connector", bo)).toBe(
      "@bo, in Claude",
    );
  });

  test("links to pages of the library open in place; others are not pages", () => {
    const p = payload();
    expect(conceptOf(p, "https://pr-1.tempra.dev/ann/notes/metrics/costs.md")).toBe(
      "metrics/costs.md",
    );
    expect(conceptOf(p, "https://pr-1.tempra.dev/ann/notes/metrics/")).toBeNull();
    expect(conceptOf(p, "https://example.com/x.md")).toBeNull();
  });

  test("draws the page, the ask, the byline and the comments, with the reader", async () => {
    const h = fakeHost();
    const d = draw(PagePanel, { host: h.host });
    cleanup = d.destroy;
    expect(d.host.textContent).toContain("Opening the page");
    h.give(payload());
    await settle();
    const root = d.host;
    expect(root.querySelector(".pp-title")?.textContent).toBe("Margin");
    expect(root.querySelector(".pp-ask")?.textContent).toContain("Does this match");
    expect(root.querySelector(".pp-byline")?.textContent).toContain("Claude for @ann · edited");
    expect(root.querySelector(".pp-byline .chip")?.textContent).toBe("Draft");
    // The body is the app's reader: textblocks at their offsets, the repeated title hidden.
    expect(root.querySelector(".doc .body > .prose [data-text]")).not.toBeNull();
    expect(root.querySelector(".prose")?.textContent).toContain("Margin is revenue minus cost.");
    // With an ask and an open thread, the comments open beside it.
    expect(root.querySelector(".pp-side")?.textContent).toContain("Which cost?");
    expect(button(root, "Comments")?.textContent).toContain("1");
    // Checking stays in Tempra: the panel opens the page's review there.
    button(root, "Check in Tempra")?.click();
    await settle();
    expect(h.links).toEqual(["https://pr-1.tempra.dev/ann/notes/metrics/margin.md?review=1"]);
  });

  test("a comment on the page goes out as page_act, and the agent is told", async () => {
    const h = fakeHost();
    const d = draw(PagePanel, { host: h.host });
    cleanup = d.destroy;
    h.give(payload());
    await settle();
    button(d.host, "Comment on the page")?.click();
    flushSync();
    const box = d.host.querySelector<HTMLTextAreaElement>("#pp-draft");
    expect(box).not.toBeNull();
    if (!box) return;
    box.value = "Add the cost of goods.";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    box.form?.requestSubmit();
    await settle();
    await settle();
    expect(h.acts).toEqual([
      {
        grant: "g.sig",
        library: "ann/notes",
        since: undefined,
        action: "open",
        quote: undefined,
        from: undefined,
        body: "Add the cost of goods.",
      },
    ]);
    expect(h.told[0]).toContain('the person commented on "Margin"');
    expect(d.host.querySelector(".pp-status")?.textContent).toBe("Comment posted.");
    // The new thread can be handed to the agent in the chat.
    button(d.host, "Ask the agent to address it")?.click();
    await settle();
    expect(h.asked[0]).toContain("Please address my comment");
  });

  test("a library link opens the page in place, Back returns; the web opens outside", async () => {
    const h = fakeHost();
    const d = draw(PagePanel, { host: h.host });
    cleanup = d.destroy;
    h.give(payload());
    await settle();
    const costs = d.host.querySelector<HTMLAnchorElement>('a[href$="/metrics/costs.md"]');
    costs?.click();
    await settle();
    expect(h.opened).toEqual(["metrics/costs.md"]);
    expect(d.host.querySelector(".pp-title")?.textContent).toBe("Costs");
    button(d.host, "Back")?.click();
    flushSync();
    expect(d.host.querySelector(".pp-title")?.textContent).toBe("Margin");
    d.host.querySelector<HTMLAnchorElement>('a[href="https://example.com"]')?.click();
    await settle();
    expect(h.links).toEqual(["https://example.com/"]);
  });

  test("a host without tool calls shows the page to read, with no comment controls", async () => {
    const h = fakeHost({ calls: false });
    const d = draw(PagePanel, { host: h.host });
    cleanup = d.destroy;
    h.give(payload());
    await settle();
    expect(d.host.querySelector(".prose")).not.toBeNull();
    expect(button(d.host, "Comment on the page")).toBeUndefined();
    expect(button(d.host, "Reply")).toBeUndefined();
  });

  test("what it says to the chat names the page and the passage", () => {
    const p = payload();
    expect(askText(p, "revenue  minus\ncost", "Which cost?")).toBe(
      'About this passage in "Margin" (ann/notes, metrics/margin.md):\n\n> revenue minus cost\n\nWhich cost?',
    );
    expect(actedText(p, { action: "open", quote: "revenue", body: "Which?" })).toContain(
      'the person commented on "Margin" (ann/notes, metrics/margin.md) on the passage "revenue": Which?',
    );
  });
});
