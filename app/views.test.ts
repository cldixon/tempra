import { describe, expect, test } from "bun:test";
import { parseMarkdown, reconcile } from "@tempra/editor";
import type { Component } from "svelte";
import type { LedgerEvent, LedgerRequest } from "./src/activity";
import { actorView } from "./src/agents";
import type { FileJson, HistoryEvent, Json } from "./src/concept/data";
import StatusPills from "./src/concept/StatusPills.svelte";
import AttachmentImage from "./src/pages/AttachmentImage.svelte";
import { describedAs, figureUse, hostOf, sizeText, versionsOf } from "./src/pages/attachment";
import EmptyLibrary from "./src/pages/EmptyLibrary.svelte";
import FileHistory from "./src/pages/FileHistory.svelte";
import { fateOf, sizeFact, typeName } from "./src/pages/file";
import { recentlyChanged } from "./src/pages/home";
import SourceFact from "./src/pages/SourceFact.svelte";
import UsedIn from "./src/pages/UsedIn.svelte";
import { factsLine } from "./src/reader/lightbox";
import type { ImageFigure } from "./src/reader/prepare";
import type { OutlineFile } from "./src/tree";
import { formatSize } from "./src/ui";
import { Urls } from "./src/urls";
import { draw } from "./test/dom";

/** A component drawn into the DOM, as markup (Svelte's empty comment anchors left out). */
// biome-ignore lint/suspicious/noExplicitAny: any component.
function markup<P extends Record<string, unknown>>(component: Component<P, any, any>, props: P) {
  const { host, destroy } = draw(component, props);
  const html = host.innerHTML.replace(/<!---->/g, "");
  destroy();
  return html;
}

const urls = new Urls("cl_dixon", "tempra-dev");
type ConceptFile = Extract<FileJson, { kind: "concept" }>;
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
    const waiting = markup(EmptyLibrary, {
      urls,
      access: "owner",
      latest: null,
      who: null,
    });
    expect(waiting).toContain("Nothing here yet");
    expect(waiting).toContain("/mcp</code>");
    expect(waiting).toContain('class="change-dot live"');
    expect(waiting).toContain("Waiting for the first write");
    expect(waiting).toContain(`href="${urls.transfer()}"`);
    const written = markup(EmptyLibrary, {
      urls,
      access: "owner",
      latest: {
        request_id: "r1",
        ts: new Date().toISOString(),
        actor: "claude-code/dev",
        by: null,
        note: "mcp smoke cleanup",
        events: [],
      },
      who: view("claude-code/dev"),
    });
    expect(written).toContain("Last write by Claude Code, <time");
    expect(written).toContain(">just now</time>: mcp smoke cleanup");
    expect(written).not.toContain("Waiting");
  });

  test("an empty library by role: a writer gets the steps without Import, a reader neither", () => {
    const writer = markup(EmptyLibrary, {
      urls,
      access: "write",
      latest: null,
      who: null,
    });
    expect(writer).toContain("/mcp</code>");
    expect(writer).not.toContain(urls.transfer());
    expect(writer).toContain(`href="${urls.connect()}"`);
    const reader = markup(EmptyLibrary, {
      urls,
      access: "read",
      latest: null,
      who: null,
    });
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
  const pills = (status: string | null, stale: boolean) => markup(StatusPills, { status, stale });

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
    const html = markup(AttachmentImage, { urls, file, onError: () => {} });
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
    const html = markup(AttachmentImage, { urls, file: legacy, onError: () => {} });
    expect(html).not.toContain("width=");
    expect(html).not.toContain("srcset");
    expect(sizeFact(legacy, null)).toBe("1.2 MB");
    expect(sizeFact(legacy, { w: 30, h: 20 })).toBe("1.2 MB · 30 × 20");
  });
});

describe("the image's page (TEMPRA-170)", () => {
  const concept = (path: string, md: string, sources: Json[] = []): ConceptFile => ({
    kind: "concept",
    path,
    seq: 3,
    hash: "h",
    doc: reconcile(null, parseMarkdown(md)),
    frontmatter: { type: "Design", title: "T", sources },
    lint: [],
    trust_tier: "unverified",
    stale: false,
  });
  const source = {
    via: "url" as const,
    url: "https://www.example.com/fig.png",
    final_url: "https://cdn.example.org/fig.png",
    fetched_at: "2026-10-25T10:00:00Z",
  };

  test("the figures a page shows the file as, and the source entry citing it", () => {
    const page = concept(
      "app/media.md",
      [
        "![A diagram](/app/other.png)",
        "",
        "```mermaid",
        "flowchart LR",
        "  A --> B",
        "```",
        "",
        '![Three tiers](fig.png "The service")',
        "",
        "Text with ![inline](/app/fig.png) in it.",
      ].join("\n"),
      [
        { id: "x", title: "Other", resource: "https://example.com/else" },
        { id: "v", title: "Vendor diagram", resource: "https://cdn.example.org/fig.png" },
      ],
    );
    expect(figureUse("app/fig.png", page, source)).toEqual({
      path: "app/media.md",
      figures: [{ n: 3, caption: "The service", alt: "Three tiers" }],
      cites: "Vendor diagram",
    });
    // An uploaded file is cited by its own path.
    const own = concept("a.md", "![x](/app/fig.png)", [{ id: "s", resource: "/app/fig.png" }]);
    expect(figureUse("app/fig.png", own, null).cites).toBe("/app/fig.png");
    expect(figureUse("app/fig.png", concept("b.md", "No figures."), source)).toEqual({
      path: "b.md",
      figures: [],
      cites: null,
    });
  });

  test("the description, else the first figure's alt text, marked", () => {
    const uses = [
      { path: "a.md", figures: [{ n: 1, caption: null, alt: " " }], cites: null },
      { path: "b.md", figures: [{ n: 2, caption: "C", alt: "Two boxes" }], cites: null },
    ];
    expect(describedAs("Its own.", uses)).toEqual({ text: "Its own.", fromAlt: false });
    expect(describedAs(null, uses)).toEqual({ text: "Two boxes", fromAlt: true });
    expect(describedAs(null, [])).toBeNull();
    expect(describedAs(undefined, null)).toBeNull();
  });

  const fileEv = (
    seq: number,
    op: string,
    hash: string | null,
    prev: string | null,
    file?: HistoryEvent["file"],
  ): HistoryEvent => ({
    seq,
    ts: hour(10 - seq),
    actor: "claude-code/dev",
    op,
    path: "app/fig.png",
    hash,
    prev_hash: prev,
    meta: { by: { person: "cl_dixon", agent: "a1" } },
    ...(file ? { file } : {}),
  });

  test("every version newest first, the one on screen current", () => {
    const events = [
      fileEv(1, "put", "a", null, { size: 1000, media: "image/png", width: 6, height: 4 }),
      fileEv(2, "comment", null, null),
      fileEv(3, "put", "a", "a", { size: 1000, media: "image/png", width: 6, height: 4 }),
      fileEv(4, "move", "a", "a"),
      fileEv(5, "put", "b", "a", {
        size: 1_250_000,
        media: "image/png",
        width: 2400,
        height: 1500,
      }),
    ];
    const head = versionsOf(events, Number.MAX_SAFE_INTEGER);
    expect(head.map((v) => [v.seq, v.what, v.current])).toEqual([
      [5, "Replaced", true],
      [3, "Details changed", false],
      [1, "Added", false],
    ]);
    expect(sizeText(head[0]?.size ?? null, head[0]?.width, head[0]?.height)).toBe(
      "1.2 MB · 2400 × 1500",
    );
    expect(sizeText(1000, null, null)).toBe(formatSize(1000));
    // Pinned to an earlier sequence: that version is current.
    expect(versionsOf(events, 4).find((v) => v.current)?.seq).toBe(3);
  });

  test("File history draws who, when, size and a Download per version", () => {
    const versions = versionsOf(
      [
        fileEv(1, "put", "a", null, { size: 1000, media: "image/png", width: 6, height: 4 }),
        fileEv(5, "put", "b", "a", { size: 2048, media: "image/png", width: 30, height: 20 }),
      ],
      Number.MAX_SAFE_INTEGER,
    );
    const html = markup(FileHistory, { urls, path: "app/fig.png", versions, name: view });
    expect(html).toContain("File history");
    expect(html.match(/<li/g)?.length).toBe(2);
    expect(html).toContain('<span class="chip">Current</span>');
    expect(html.match(/Current/g)?.length).toBe(1);
    expect(html).toContain("Replaced by <span");
    expect(html).toContain("Added by <span");
    expect(html).toContain("<b>Claude Code</b>");
    expect(html).not.toContain("claude-code/dev");
    expect(html).toContain(`${formatSize(2048)} · 30 × 20`);
    expect(html).toContain('href="/cl_dixon/tempra-dev/-/download/app/fig.png?at=5"');
    expect(html).toContain('href="/cl_dixon/tempra-dev/-/download/app/fig.png?at=1"');
  });

  test("Source: from a host with its fetch, redirect and citation; else who uploaded it", () => {
    const titles = new Map([["app/media.md", "Images and media"]]);
    const uses = [{ path: "app/media.md", figures: [], cites: "Vendor diagram" }];
    const fetched = markup(SourceFact, { urls, source, version: null, uses, titles, name: view });
    expect(fetched).toContain('From <a href="https://www.example.com/fig.png"');
    expect(fetched).toContain(">example.com</a>");
    expect(fetched).toContain("fetched <time");
    expect(fetched).toContain(">cdn.example.org</a>");
    expect(fetched).toContain(
      'Cited in <a href="/cl_dixon/tempra-dev/app/media.md">Images and media</a>',
    );
    expect(fetched).toContain("Vendor diagram");
    const [v] = versionsOf([fileEv(1, "put", "a", null)], Number.MAX_SAFE_INTEGER);
    const uploaded = markup(SourceFact, {
      urls,
      source: null,
      version: v ?? null,
      uses: [],
      titles,
      name: view,
    });
    expect(uploaded).toContain("Uploaded by <span");
    expect(uploaded).toContain("<b>Claude Code</b>");
    expect(uploaded).not.toContain("Cited");
  });

  test("Used in: each page with the figures it appears as", () => {
    const html = markup(UsedIn, {
      urls,
      paths: ["app/media.md", "b.md"],
      uses: [
        {
          path: "app/media.md",
          figures: [{ n: 3, caption: "The service", alt: "" }],
          cites: null,
        },
      ],
      titles: new Map([["app/media.md", "Images and media"]]),
    });
    expect(html).toContain(">Images and media</a>");
    expect(html).toContain("Figure 3. The service");
    expect(html).toContain(">b.md</a>");
    expect(markup(UsedIn, { urls, paths: [], uses: [], titles: new Map() })).toContain(
      "No page links it",
    );
  });

  test("the full-screen view's quiet line names the host and the description", () => {
    const fig = { path: "app/fig.png", url: "/app/fig.png" } as ImageFigure;
    expect(
      factsLine(fig, {
        size: 2048,
        host: hostOf(source.url),
        by: "Claude Code for @cl_dixon",
        description: "Three tiers.",
      }),
    ).toBe(
      `fig.png · ${formatSize(2048)} · from example.com · added by Claude Code for @cl_dixon · Three tiers.`,
    );
    expect(factsLine(fig, null)).toBe("fig.png");
  });
});
