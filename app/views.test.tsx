import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { LedgerEvent, LedgerRequest } from "./src/activity";
import { actorView } from "./src/agents";
import { StatusPills } from "./src/concept/Byline";
import { AttachmentImage, fateOf, sizeFact, typeName } from "./src/pages/File";
import { EmptyLibrary, recentlyChanged } from "./src/pages/Home";
import type { OutlineFile } from "./src/Tree";
import { Urls } from "./src/urls";

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

describe("the library's home (take 4)", () => {
  const files: OutlineFile[] = [
    { path: "guide.md", kind: "concept", title: "Guide", seq: 1 },
    { path: "decisions/a.md", kind: "concept", title: "A", seq: 5 },
    { path: "decisions/old/b.md", kind: "concept", title: "B", seq: 30 },
    { path: "app/reader.md", kind: "concept", title: "Reader", seq: 6 },
    { path: "app/shot.png", kind: "attachment", seq: 7 },
  ];

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

describe("an attachment's image (TEMPRA-162)", () => {
  const file = {
    kind: "attachment" as const,
    path: "app/shot.png",
    seq: 7,
    size: 1_258_291,
    media: "image/png",
    hash: "a".repeat(64),
    width: 2400,
    height: 1500,
  };

  test("from the image route, its size known before it loads; Size says it", () => {
    const html = renderToStaticMarkup(
      <AttachmentImage urls={urls} file={file} onError={() => {}} />,
    );
    expect(html).toContain(`src="/cl_dixon/tempra-dev/-/image/${file.hash}"`);
    expect(html).toContain('width="2400"');
    expect(html).toContain('height="1500"');
    expect(html).toContain('class="image-loading"');
    expect(html).toContain(`/-/image/${file.hash}?w=1920 1920w`);
    expect(html).toContain('sizes="(max-width: 900px) 100vw, 70vw"');
    expect(html).not.toContain('loading="lazy"');
    expect(sizeFact(file, null)).toBe("1.2 MB · 2400 × 1500");
  });

  test("an image from before, not yet sized: the original, the size once drawn", () => {
    const legacy = { ...file, width: null, height: null };
    const html = renderToStaticMarkup(
      <AttachmentImage urls={urls} file={legacy} onError={() => {}} />,
    );
    expect(html).not.toContain("width=");
    expect(html).not.toContain("srcset");
    expect(sizeFact(legacy, null)).toBe("1.2 MB");
    expect(sizeFact(legacy, { w: 30, h: 20 })).toBe("1.2 MB · 30 × 20");
  });
});
