import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { LedgerEvent, LedgerRequest } from "./src/activity";
import { actorView } from "./src/agents";
import { StatusPills } from "./src/concept/Byline";
import { forYouCards, type InboxItem, type InboxPage } from "./src/inbox";
import type { Needs } from "./src/needs";
import { fateOf, typeName } from "./src/pages/File";
import {
  EmptyLibrary,
  ForYou,
  HomeFoot,
  inboxHref,
  recentlyChanged,
  SinceLine,
  sinceYouLooked,
} from "./src/pages/Home";
import type { OutlineFile } from "./src/Tree";
import { Urls } from "./src/urls";
import { type Place, phoneName } from "./src/Workspace";

const urls = new Urls("cl_dixon", "tempra-dev");
const me = "human:cl_dixon";
const agents = {
  a1: {
    person: "cl_dixon",
    agent: { id: "a1", name: "Claude Code", platform: null, client: null },
    actor: "claude-code/dev",
    requests: 1,
    last_ts: "2026-10-19T10:00:00Z",
  },
};
const view = (actor: string, by?: { person: string; agent?: string } | null) =>
  actorView(actor, by, agents, me);
const hour = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const needs = (over: Partial<Needs> = {}): Needs => ({
  seq: 40,
  replies: [],
  verify: { total: 0, items: [], next_offset: null },
  unverified: { total: 0 },
  stale: [],
  housekeeping: { lint: 0, structure: 0, broken_link: 0, total: 0 },
  count: 0,
  ...over,
});

describe("the library's home (take 4)", () => {
  const files: OutlineFile[] = [
    { path: "guide.md", kind: "concept", title: "Guide", seq: 1 },
    { path: "decisions/a.md", kind: "concept", title: "A", seq: 5 },
    { path: "decisions/old/b.md", kind: "concept", title: "B", seq: 30 },
    { path: "app/reader.md", kind: "concept", title: "Reader", seq: 6 },
    { path: "app/shot.png", kind: "attachment", seq: 7 },
  ];

  const item = (over: Partial<InboxItem>): InboxItem => ({
    id: "i1",
    kind: "reply",
    library: "cl_dixon/tempra-dev",
    library_title: "Tempra",
    path: "app/reader.md",
    thread: "t1",
    title: null,
    actor: "claude-code/dev",
    who: "Claude Code",
    agent: true,
    excerpt: "Atoms count as one character.",
    count: null,
    due: null,
    invitation: null,
    created: hour(1),
    read_at: null,
    done_at: null,
    actions: ["reply", "resolve"],
    href: "/cl_dixon/tempra-dev/app/reader.md#comments",
    ...over,
  });
  const page = (items: InboxItem[], open = items.length): InboxPage => ({
    items,
    next: null,
    unread: items.length,
    open,
  });

  test("for you here: the library's open Inbox items, one of each kind first, up to three", () => {
    const items = [
      item({}),
      item({ id: "i2", thread: "t2" }),
      item({
        id: "i3",
        kind: "verify",
        path: "app/diagrams.md",
        title: "Diagrams",
        thread: null,
        count: 2,
        actions: ["review", "dismiss"],
        href: "/cl_dixon/tempra-dev/app/diagrams.md?review=1",
      }),
      item({
        id: "i4",
        kind: "stale",
        path: "v2/limits.md",
        title: "Limits",
        thread: null,
        due: "2026-12-24T00:00:00Z",
        actions: ["open", "dismiss"],
        href: "/cl_dixon/tempra-dev/v2/limits.md",
      }),
    ];
    // A reply names its page by path only: the title comes from the tree's outline.
    const titles = { "cl_dixon/tempra-dev app/reader.md": "Reader" };
    const cards = forYouCards(items, titles);
    expect(cards.map((c) => c.kind)).toEqual(["Reply", "To check", "Going stale"]);
    expect(cards[0]?.title).toBe("Claude Code on Reader");
    expect(cards[0]?.detail).toBe("Atoms count as one character.");
    expect(cards[0]?.href).toBe("/cl_dixon/tempra-dev/app/reader.md#thread-t1");
    expect(cards[1]?.title).toBe("Diagrams");
    expect(cards[1]?.detail).toBe("2 edits by Claude Code since you checked");
    expect(cards[2]?.detail).toContain("Dec 24");
    // Without the outline, the page's name stands in, never the raw path.
    expect(forYouCards([item({})])[0]?.title).toBe("Claude Code on reader");
    const html = renderToStaticMarkup(
      <ForYou urls={urls} inbox={page(items, 5)} titles={titles} />,
    );
    expect(html).toContain("For you here");
    expect(html).toContain(`href="${inboxHref(urls)}"`);
    expect(inboxHref(urls)).toBe("/inbox?library=cl_dixon/tempra-dev");
    expect(html).toContain("All 5 in Inbox");
    // Done in the Inbox, gone from the home: nothing open, nothing shown.
    expect(renderToStaticMarkup(<ForYou urls={urls} inbox={page([])} />)).toBe("");
  });

  test("the foot: the agents' housekeeping, to their work queue; absent when none", () => {
    const html = renderToStaticMarkup(
      <HomeFoot
        urls={urls}
        needs={needs({ housekeeping: { lint: 1, structure: 11, broken_link: 0, total: 12 } })}
      />,
    );
    expect(html).toContain("12 housekeeping items for agents");
    expect(html).toContain(`href="${urls.work()}"`);
    expect(renderToStaticMarkup(<HomeFoot urls={urls} needs={needs()} />)).toBe("");
  });

  test("an empty library: the connect steps, waiting with the pulsing dot, Import a bundle", () => {
    const waiting = renderToStaticMarkup(
      <EmptyLibrary urls={urls} access="owner" latest={null} who={null} now={Date.now()} />,
    );
    expect(waiting).toContain("Nothing here yet");
    expect(waiting).toContain("/mcp</code>");
    expect(waiting).toContain('class="change-dot live"');
    expect(waiting).toContain("Waiting for the first write");
    expect(waiting).toContain(`href="${urls.transfer()}"`);
    const written = renderToStaticMarkup(
      <EmptyLibrary
        urls={urls}
        access="owner"
        latest={{
          request_id: "r1",
          ts: new Date().toISOString(),
          actor: "claude-code/dev",
          by: null,
          note: "mcp smoke cleanup",
          events: [],
        }}
        who={view("claude-code/dev")}
        now={Date.now()}
      />,
    );
    expect(written).toContain("Last write by Claude Code, <time");
    expect(written).toContain(">just now</time>: mcp smoke cleanup");
    expect(written).not.toContain("Waiting");
  });

  test("an empty library by role: a writer gets the steps without Import, a reader neither", () => {
    const writer = renderToStaticMarkup(
      <EmptyLibrary urls={urls} access="write" latest={null} who={null} now={Date.now()} />,
    );
    expect(writer).toContain("/mcp</code>");
    expect(writer).not.toContain(urls.transfer());
    expect(writer).toContain(`href="${urls.connect()}"`);
    const reader = renderToStaticMarkup(
      <EmptyLibrary urls={urls} access="read" latest={null} who={null} now={Date.now()} />,
    );
    expect(reader).toContain("Nothing here yet");
    expect(reader).not.toContain("/mcp</code>");
    expect(reader).not.toContain("Add Tempra");
    expect(reader).not.toContain(urls.transfer());
    expect(reader).not.toContain(urls.connect());
  });

  const event = (seq: number, over: Partial<LedgerEvent> = {}): LedgerEvent => ({
    seq,
    ts: hour(1),
    actor: "claude-code/dev",
    op: "put",
    path: `app/p${seq}.md`,
    prev_hash: "h",
    hash: "h2",
    concept_id: `c${seq}`,
    meta: { by: { person: "u1", agent: "a1" } },
    ...over,
  });

  test("since you last looked: pages, files and comments by others, dated by the cursor", () => {
    const events = [
      event(10, { ts: "2026-10-12T12:00:00Z" }),
      event(11),
      event(12, { path: "app/p11.md" }),
      event(13, { path: "app/shot.png" }),
      event(14, { op: "comment" }),
      // The person's own edit in the app is not news to them.
      event(15, { actor: me, path: "app/mine.md", meta: { by: { person: "u1" } } }),
      event(16, { op: "verify" }),
    ];
    const what = sinceYouLooked(events, 10, me);
    expect(what).toMatchObject({ from: events[0]?.ts, pages: 1, files: 1, comments: 1 });
    expect(what.who).toHaveLength(1);
    const html = renderToStaticMarkup(
      <SinceLine
        urls={urls}
        what={what}
        name={(a, by) => view(a, by).name}
        now={Date.parse("2026-10-20T12:00:00Z")}
      />,
    );
    expect(html).toContain(
      "Since Oct 12: Claude Code changed 1 page and 1 file and left 1 comment",
    );
    expect(html).toContain(`href="${urls.activity()}"`);
    // Nothing new (or only the person's own): no line at all.
    const none = sinceYouLooked(events.slice(0, 1), 10, me);
    expect(
      renderToStaticMarkup(<SinceLine urls={urls} what={none} name={() => "x"} now={Date.now()} />),
    ).toBe("");
  });

  test("recently changed: the newest pages still here, each once, with who and when", () => {
    const request = (id: string, events: LedgerEvent[]): LedgerRequest => ({
      request_id: id,
      ts: events.at(-1)?.ts ?? hour(1),
      actor: "claude-code/dev",
      note: null,
      by: { person: "cl_dixon", agent: "a1" },
      events,
    });
    const changed = recentlyChanged(
      [
        request("r3", [event(30, { path: "app/reader.md" }), event(31, { op: "comment" })]),
        request("r2", [event(20, { path: "gone.md" }), event(21, { path: "decisions/a.md" })]),
        request("r1", [event(10, { path: "app/reader.md" })]),
      ],
      files,
    );
    expect(changed.map((c) => [c.path, c.title])).toEqual([
      ["app/reader.md", "Reader"],
      ["decisions/a.md", "A"],
    ]);
  });
});

describe("an attachment and Not found (take 4)", () => {
  test("a file's type in words", () => {
    expect(typeName("image/png", "a.png")).toBe("PNG image");
    expect(typeName("image/svg+xml", "a.svg")).toBe("SVG image");
    expect(typeName("application/pdf", "a.pdf")).toBe("PDF document");
    expect(typeName(null, "a.csv")).toBe("CSV file");
    expect(typeName(null, "README")).toBe("File");
  });

  const ev = (
    seq: number,
    op: string,
    path: string,
    meta: Record<string, string> | null = null,
  ) => ({
    seq,
    ts: hour(48 - seq),
    actor: "claude-code/dev",
    op,
    path,
    hash: null,
    meta,
  });

  test("what became of a path: moved (to where it is now), deleted, or nothing known", () => {
    const moved = fateOf("decisions/x.md", {
      path: "delivery/x.md",
      events: [
        ev(1, "put", "decisions/x.md"),
        ev(2, "move", "delivery/x.md", { from_path: "decisions/x.md" }),
      ],
    });
    expect(moved).toMatchObject({ kind: "moved", to: "delivery/x.md", actor: "claude-code/dev" });
    const deleted = fateOf("a.md", {
      path: "a.md",
      events: [ev(1, "put", "a.md"), ev(2, "delete", "a.md")],
    });
    expect(deleted?.kind).toBe("deleted");
    expect(fateOf("a.md", { path: "a.md", events: [ev(1, "put", "a.md")] })).toBeNull();
  });
});

describe("entering a library on a phone (TEMPRA-107)", () => {
  test("the top bar names where the person is", () => {
    const at = (p: Partial<Place>) =>
      phoneName({ file: null, dir: null, view: null, ...p }, "Tempra dev");
    expect(at({ view: "home" })).toBe("Tempra dev");
    expect(at({ view: "work" })).toBe("For agents");
    expect(at({ view: "activity" })).toBe("Activity");
    expect(at({ view: "transfer" })).toBe("Import & export");
    expect(at({ file: "decisions/margins-not-panels.md" })).toBe("margins-not-panels.md");
  });
});

describe("a page's status pills (TEMPRA-139)", () => {
  const pills = (status: string | null, stale: boolean) =>
    renderToStaticMarkup(<StatusPills status={status} stale={stale} />);

  test("a status that is not stable, in its own word, and stale", () => {
    expect(pills("draft", false)).toBe(
      '<span class="byline-pills"><span class="chip">Draft</span></span>',
    );
    expect(pills("deprecated", true)).toContain('<span class="chip">Deprecated</span>');
    expect(pills("deprecated", true)).toContain('<span class="chip">Stale</span>');
  });

  test("nothing in the normal state", () => {
    expect(pills("stable", false)).toBe("");
    expect(pills(null, false)).toBe("");
    expect(pills(" Stable ", false)).toBe("");
  });
});
