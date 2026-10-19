import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { actorView } from "./src/agents";
import type { Needs } from "./src/needs";
import { FolderBody, type FolderView } from "./src/pages/Folder";
import { WaysIn } from "./src/pages/Home";
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
              verified: null,
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
    expect(html).toContain("Never verified");
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

describe("a folder (take 3)", () => {
  const html = renderToStaticMarkup(
    <FolderBody urls={urls} dir="decisions" view={folder} actor={view} />,
  );

  test("its name and one line of counts", () => {
    expect(html).toContain(`<h1 class="view-title">Decisions</h1>`);
    expect(html).toContain("2 concepts · 1 not verified · newest change 2 h ago");
  });

  test("subfolders first, then concepts, newest first, each a link", () => {
    const sub = html.indexOf("Old ones");
    const newest = html.indexOf("Diagram styles");
    const older = html.indexOf("Agents act for a person");
    expect(sub).toBeGreaterThan(-1);
    expect(sub).toBeLessThan(newest);
    expect(newest).toBeLessThan(older);
    expect(html).toContain(`href="${urls.tree("decisions/old-ones")}"`);
    expect(html).toContain(`href="${urls.file("decisions/a.md")}"`);
    expect(html).toContain("3 concepts");
  });

  test("who wrote each, open threads when there are any, and trust as a dot", () => {
    expect(html).toContain("You · ");
    expect(html).toContain("Claude Code · 2 h");
    expect(html.match(/class="folder-threads"/g)?.length).toBe(1);
    expect(html).toContain('class="folder-dot verified" title="Verified"');
    expect(html).toContain('class="folder-dot" title="Not verified"');
    expect(html).toContain('aria-pressed="true">Recent');
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

  const files: OutlineFile[] = [
    { path: "guide.md", kind: "concept", title: "Guide" },
    { path: "decisions/a.md", kind: "concept", title: "A" },
    { path: "decisions/old/b.md", kind: "concept", title: "B" },
    { path: "app/reader.md", kind: "concept", title: "Reader" },
    { path: "app/shot.png", kind: "attachment" },
  ];

  test("the library's top level: folders first with their concepts at any depth, then files", () => {
    expect(topLevel(files).map(({ entry, count }) => [entry.path, count])).toEqual([
      ["app", 1],
      ["decisions", 2],
      ["guide.md", 0],
    ]);
  });

  test("the home's ways in: Needs you, Activity, then the top level as links", () => {
    const html = renderToStaticMarkup(<WaysIn urls={urls} files={files} />);
    const needsAt = html.indexOf(`href="${urls.needs()}"`);
    const activityAt = html.indexOf(`href="${urls.activity()}"`);
    const folderAt = html.indexOf(`href="${urls.tree("decisions")}"`);
    expect(needsAt).toBeGreaterThan(-1);
    expect(needsAt).toBeLessThan(activityAt);
    expect(activityAt).toBeLessThan(folderAt);
    // Home is where the person is: no row for it here.
    expect(html).not.toContain(">Home<");
    expect(html).toContain('>Decisions</span><span class="nav-count">2</span>');
    expect(html).toContain(`href="${urls.file("guide.md")}"`);
    expect(html).toContain(">Guide</span>");
  });

  test("before the outline arrives, and in an empty library, one quiet line", () => {
    expect(renderToStaticMarkup(<WaysIn urls={urls} files={null} />)).toContain("Loading…");
    expect(renderToStaticMarkup(<WaysIn urls={urls} files={[]} />)).toContain("No files yet.");
  });
});
