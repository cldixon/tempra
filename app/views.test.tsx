import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { actorView } from "./src/agents";
import type { Needs } from "./src/needs";
import { fateOf, typeName } from "./src/pages/File";
import { FolderBody, type FolderView } from "./src/pages/Folder";
import {
  EmptyLibrary,
  ForYou,
  forYouCards,
  HomeFoot,
  HomeSections,
  inboxHref,
} from "./src/pages/Home";
import { NeedsBody } from "./src/pages/NeedsYou";
import { type OutlineFile, topLevel } from "./src/Tree";
import { day } from "./src/ui";
import { Urls } from "./src/urls";
import { type Place, placeName } from "./src/Workspace";

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

const needsHtml = (n: Needs) =>
  renderToStaticMarkup(<NeedsBody urls={urls} needs={n} view={view} me={me} reload={() => {}} />);

describe("Needs you (take 3)", () => {
  test("nothing to do is one quiet line, and no empty sections", () => {
    const html = needsHtml(needs());
    expect(html).toContain("Nothing needs you right now.");
    expect(html).not.toContain("<section");
    expect(html).not.toContain("housekeeping");
  });

  test("each kind of need is a section with its count and its way to act", () => {
    const html = needsHtml(
      needs({
        replies: [
          {
            thread: "t1",
            path: "app/reader.md",
            title: "Reader",
            quote: "Hover or focus a footnote marker",
            last: {
              actor: "claude-code/dev",
              by: { person: "cl_dixon", agent: "a1" },
              body: "Resolve if that's what you meant.",
              ts: hour(0.2),
              seq: 39,
            },
          },
        ],
        verify: {
          total: 21,
          next_offset: 20,
          items: [
            {
              path: "app/reader.md",
              title: "Reader",
              seq: 38,
              ts: hour(1),
              actor: "claude-code/dev",
              by: { person: "cl_dixon", agent: "a1" },
              verified: { actor: me, seq: 10, ts: "2026-10-05T12:00:00Z" },
              changes: 2,
            },
            {
              path: "app/diagrams.md",
              title: null,
              seq: 30,
              ts: hour(2),
              actor: "claude-code/dev",
              by: null,
              verified: { actor: "human:ann", seq: 12, ts: "2026-10-06T12:00:00Z" },
              changes: 1,
            },
          ],
        },
        stale: [
          {
            path: "v2/limits.md",
            title: "Limits",
            stale_after: "2026-10-24T00:00:00Z",
            stale: "stale_soon",
          },
        ],
        unverified: { total: 48 },
        housekeeping: { lint: 1, structure: 21, broken_link: 0, total: 22 },
      }),
    );
    expect(html).toContain('Waiting on your reply <span class="needs-count">· 1</span>');
    expect(html).toContain(`href="${urls.thread("app/reader.md", "t1")}"`);
    expect(html).toContain("Claude Code");
    expect(html).toContain(" for @cl_dixon");
    expect(html).toContain("Resolve if that&#x27;s what you meant.");
    expect(html).toContain('To verify <span class="needs-count">· 21</span>');
    // A moment, shown on the reader's own calendar.
    expect(html).toContain(`2 changes since you verified on ${day("2026-10-05T12:00:00Z")}`);
    expect(html).toContain(`1 change since @ann verified on ${day("2026-10-06T12:00:00Z")}`);
    // Never verified (TEMPRA-111): one counted line, not rows.
    expect(html).toContain("Not yet verified · 48 concepts.");
    expect(html).not.toContain("Never verified");
    expect(html).toContain(">app/diagrams.md<");
    expect(html).toContain(`href="${urls.review("app/reader.md")}"`);
    expect(html).toContain(">More<");
    expect(html).toContain("Its review date is Oct 24.");
    expect(html).toContain("Ask an agent to review");
    expect(html).not.toContain("Still true");
    expect(html).toContain("22 items (21 structure, 1 lint). You don&#x27;t need to act.");
    expect(html).toContain(`href="${urls.work()}"`);
  });
});

const folder: FolderView = {
  seq: 50,
  dir: "decisions",
  folders: [{ path: "decisions/old-ones", concepts: 3, newest_ts: hour(30) }],
  concepts: [
    {
      path: "decisions/a.md",
      title: "Agents act for a person",
      description: "An outside agent always acts for one person.",
      seq: 10,
      ts: hour(48),
      actor: me,
      by: { person: "cl_dixon" },
      verified: true,
      comments: 2,
    },
    {
      path: "decisions/z.md",
      title: "Diagram styles go through the CSSOM",
      description: null,
      seq: 40,
      ts: hour(2),
      actor: "claude-code/dev",
      by: { person: "cl_dixon", agent: "a1" },
      verified: false,
      comments: 0,
    },
  ],
  counts: { concepts: 2, unverified: 1, newest: { path: "decisions/z.md", ts: hour(2) } },
};

describe("a folder (take 4)", () => {
  const html = renderToStaticMarkup(
    <FolderBody
      urls={urls}
      dir="decisions"
      view={folder}
      seen={20}
      live={(p) => (p === "decisions/z.md" ? "Claude Code for @cl_dixon" : null)}
    />,
  );

  test("its name, then subfolders with counts, then concepts by title, each a link", () => {
    expect(html).toContain(`<h1 class="view-title">Decisions</h1>`);
    const sub = html.indexOf("Old ones");
    const a = html.indexOf("Agents act for a person");
    const z = html.indexOf("Diagram styles");
    expect(sub).toBeGreaterThan(-1);
    expect(sub).toBeLessThan(a);
    expect(a).toBeLessThan(z);
    expect(html).toContain(`href="${urls.tree("decisions/old-ones")}"`);
    expect(html).toContain(`href="${urls.file("decisions/a.md")}"`);
    expect(html).toContain("3 pages");
    expect(html).toContain("An outside agent always acts for one person.");
  });

  test("the dot: solid for changed since the cursor, pulsing while an agent writes", () => {
    // a.md (seq 10) is older than the cursor: no dot. z.md is being written now.
    expect(html.match(/change-dot/g)?.length).toBe(1);
    expect(html).toContain('class="change-dot live"');
    expect(html).toContain("Claude Code for @cl_dixon is editing");
    const changed = renderToStaticMarkup(
      <FolderBody urls={urls} dir="decisions" view={folder} seen={20} />,
    );
    expect(changed).toContain('class="change-dot warm"');
    expect(changed).not.toContain("is editing");
  });

  test("nothing else: no author, threads, trust or sort; index.md linked for agents", () => {
    expect(html).not.toContain("folder-threads");
    expect(html).not.toContain("verified");
    expect(html).not.toContain("aria-pressed");
    expect(html).not.toContain("You · ");
    expect(html).toContain(`href="${urls.raw("decisions/index.md")}"`);
  });
});

describe("the library's home (take 4)", () => {
  const files: OutlineFile[] = [
    { path: "guide.md", kind: "concept", title: "Guide", seq: 1 },
    { path: "decisions/a.md", kind: "concept", title: "A", seq: 5 },
    { path: "decisions/old/b.md", kind: "concept", title: "B", seq: 30 },
    { path: "app/reader.md", kind: "concept", title: "Reader", seq: 6 },
    { path: "app/shot.png", kind: "attachment", seq: 7 },
  ];

  test("the top level: folders first with their concepts at any depth, then files", () => {
    expect(topLevel(files).map(({ entry, count }) => [entry.path, count])).toEqual([
      ["app", 1],
      ["decisions", 2],
      ["guide.md", 0],
    ]);
  });

  test("sections: every top-level folder in the tree's order, its count, the solid dot", () => {
    const html = renderToStaticMarkup(<HomeSections urls={urls} files={files} seen={10} />);
    const app = html.indexOf(`href="${urls.tree("app")}"`);
    const decisions = html.indexOf(`href="${urls.tree("decisions")}"`);
    expect(app).toBeGreaterThan(-1);
    expect(app).toBeLessThan(decisions);
    expect(html).not.toContain("guide.md");
    expect(html).toContain('<span class="home-section-name">Decisions</span>');
    expect(html).toContain('<span class="home-section-count">2</span>');
    // Only decisions changed after the cursor (b.md at seq 30).
    expect(html.match(/change-dot warm/g)?.length).toBe(1);
    expect(html.indexOf("change-dot")).toBeGreaterThan(decisions);
    expect(
      renderToStaticMarkup(<HomeSections urls={urls} files={files} seen={null} />),
    ).not.toContain("change-dot");
  });

  test("a library with no folders yet lists its pages instead", () => {
    const html = renderToStaticMarkup(
      <HomeSections
        urls={urls}
        files={[{ path: "start-here.md", kind: "concept", title: "Start here", seq: 1 }]}
        seen={null}
      />,
    );
    expect(html).toContain(">Pages</h2>");
    expect(html).toContain(`href="${urls.file("start-here.md")}"`);
    expect(html).toContain(">Start here</span>");
    expect(renderToStaticMarkup(<HomeSections urls={urls} files={[]} seen={null} />)).toBe("");
  });

  const reply = {
    thread: "t1",
    path: "app/reader.md",
    title: "Reader",
    quote: null,
    last: {
      actor: "claude-code/dev",
      by: { person: "cl_dixon", agent: "a1" },
      body: "Atoms count as one character.",
      ts: hour(1),
      seq: 31,
    },
  };

  test("for you here: one card of each kind first, up to three, and All n in Inbox", () => {
    const n = needs({
      replies: [reply, { ...reply, thread: "t2" }],
      verify: {
        total: 2,
        items: [
          {
            path: "app/diagrams.md",
            title: "Diagrams",
            seq: 20,
            ts: hour(2),
            actor: "claude-code/dev",
            by: null,
            verified: { actor: me, seq: 10, ts: hour(30) },
            changes: 2,
          },
          {
            path: "app/reader.md",
            title: "Reader",
            seq: 21,
            ts: hour(3),
            actor: "claude-code/dev",
            by: null,
            verified: { actor: me, seq: 10, ts: hour(30) },
            changes: 1,
          },
        ],
        next_offset: null,
      },
      stale: [
        {
          path: "v2/limits.md",
          title: "Limits",
          stale_after: "2026-10-24T00:00:00Z",
          stale: "stale_soon",
        },
      ],
      count: 5,
    });
    const cards = forYouCards(urls, n, view);
    expect(cards.map((c) => c.kind)).toEqual(["Reply", "To verify", "Going stale"]);
    expect(cards[0]?.title).toBe("Claude Code on Reader");
    expect(cards[0]?.href).toBe(urls.thread("app/reader.md", "t1"));
    expect(cards[1]?.title).toBe("2 changed pages");
    expect(cards[1]?.detail).toBe("Diagrams and Reader");
    expect(cards[2]?.detail).toBe("Oct 24");
    const html = renderToStaticMarkup(<ForYou urls={urls} needs={n} view={view} />);
    expect(html).toContain("For you here");
    expect(html).toContain(`href="${inboxHref(urls)}"`);
    expect(inboxHref(urls)).toBe("/inbox?library=cl_dixon/tempra-dev");
    expect(html).toContain("All 5 in Inbox");
    expect(renderToStaticMarkup(<ForYou urls={urls} needs={needs()} view={view} />)).toBe("");
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
      <EmptyLibrary urls={urls} latest={null} who={null} now={Date.now()} />,
    );
    expect(waiting).toContain("Nothing here yet");
    expect(waiting).toContain("/mcp</code>");
    expect(waiting).toContain('class="change-dot live"');
    expect(waiting).toContain("Waiting for the first write");
    expect(waiting).toContain(`href="${urls.transfer()}"`);
    const written = renderToStaticMarkup(
      <EmptyLibrary
        urls={urls}
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
    expect(written).toContain("Last write by claude-code/dev, just now: mcp smoke cleanup");
    expect(written).not.toContain("Waiting");
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
  test("the top bar names the page under the library", () => {
    const at = (p: Partial<Place>) => placeName({ file: null, dir: null, view: null, ...p });
    expect(at({ view: "home" })).toBe("Home");
    expect(at({ view: "needs" })).toBe("Needs you");
    expect(at({ view: "activity" })).toBe("Activity");
    expect(at({ view: "transfer" })).toBe("Import & export");
    expect(at({ dir: "app/style-guide" })).toBe("Style guide");
    expect(at({ file: "decisions/margins-not-panels.md" })).toBe("Decisions");
    expect(at({ file: "guide.md" })).toBeNull();
  });
});
