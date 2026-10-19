import { describe, expect, test } from "bun:test";
import {
  agoWords,
  dayLabel,
  type Entry,
  entryTime,
  groupByDay,
  type LedgerEvent,
  type LedgerRequest,
  momentText,
  toEntry,
  whoWorksHere,
  wordsText,
} from "./src/activity";
import { folderName } from "./src/urls";

// Activity's entry model (app/src/activity.tsx): requests told as sentences, days, times.

let seq = 0;
const ev = (op: string, path: string, extra: Partial<LedgerEvent> = {}): LedgerEvent => {
  seq++;
  return {
    seq,
    ts: "2026-10-19T10:00:00Z",
    actor: "claude-code",
    op,
    path,
    prev_hash: "h0",
    hash: "h1",
    concept_id: `c:${path}`,
    meta: null,
    ...extra,
  };
};

const req = (events: LedgerEvent[], over: Partial<LedgerRequest> = {}): LedgerRequest => ({
  request_id: `r${seq}`,
  ts: events[0]?.ts ?? "",
  actor: "claude-code",
  note: null,
  by: { person: "cl_dixon", agent: "a1" },
  events,
  ...over,
});

const titles = {
  "app/reader.md": "Reader",
  "app/diagrams.md": "Diagrams",
  "decisions/cssom.md": "Diagram styles go through the CSSOM",
  "v2/tenancy.md": "Tenancy",
};

/** The sentence as text, folders as the app names them. */
const text = (e: Entry | null) =>
  (e?.parts ?? [])
    .map((p) => (typeof p === "string" ? p : "folder" in p ? folderName(p.folder) : p.title))
    .join("");

describe("toEntry", () => {
  test("one or two changes are named, with their verbs", () => {
    const e = toEntry(
      req([
        ev("put", "app/diagrams.md", { meta: { words: { added: 412, removed: 96 } } }),
        ev("put", "decisions/cssom.md", { prev_hash: null }),
      ]),
      titles,
    );
    expect(text(e)).toBe("edited Diagrams and added Diagram styles go through the CSSOM");
    expect(e?.named).toBe(true);
    expect(e?.touched[0]?.words).toEqual({ added: 412, removed: 96 });
  });

  test("more than two are counted, with their folders", () => {
    const e = toEntry(
      req([
        ev("put", "app/diagrams.md"),
        ev("put", "app/reader.md"),
        ev("put", "decisions/cssom.md", { prev_hash: null }),
      ]),
      titles,
    );
    expect(text(e)).toBe("changed 3 concepts in App and Decisions");
    expect(e?.named).toBe(false);
    expect(e?.touched.map((t) => t.what)).toEqual(["edited", "edited", "added"]);
  });

  test("the same verb for all keeps it; many folders are counted", () => {
    const e = toEntry(req([ev("put", "a/x.md"), ev("put", "b/y.md"), ev("put", "c/z.md")]), titles);
    expect(text(e)).toBe("edited 3 concepts across 3 folders");
  });

  test("an import", () => {
    const e = toEntry(
      req([
        ev("import", "v2/a.md", { prev_hash: null }),
        ev("import", "v2/b.md", { prev_hash: null }),
        ev("import", "v2/img.png", { prev_hash: null }),
      ]),
      titles,
    );
    expect(text(e)).toBe("imported 3 files in V2");
  });

  test("moves, deletes and several events on one concept", () => {
    const moved = toEntry(
      req([ev("move", "app/reader.md", { meta: { from_path: "old/reader.md" } })]),
      titles,
    );
    expect(text(moved)).toBe("moved Reader");
    expect(moved?.touched[0]?.from).toBe("old/reader.md");
    const gone = toEntry(req([ev("delete", "v2/tenancy.md", { hash: null })]), titles);
    expect(text(gone)).toBe("deleted Tenancy");
    const both = toEntry(
      req([
        ev("put", "app/reader.md", { meta: { words: { added: 3, removed: 1 } } }),
        ev("put", "app/reader.md", { meta: { words: { added: 2, removed: 4 } } }),
      ]),
      titles,
    );
    expect(both?.touched).toHaveLength(1);
    expect(both?.touched[0]?.words).toEqual({ added: 5, removed: 5 });
  });

  test("comments and verifications are entries too", () => {
    const thread = (kind: string, body?: string) =>
      ev("comment", "app/reader.md", { meta: { comment: { kind, thread: "t1", body } } });
    const reply = toEntry(
      req([thread("reply", "Cards now show the number."), thread("resolve")]),
      titles,
    );
    expect(text(reply)).toBe("replied on Reader and resolved it");
    expect(reply?.quote).toBe("Cards now show the number.");
    expect(text(toEntry(req([thread("open", "Why?")]), titles))).toBe("opened a thread on Reader");
    const verified = toEntry(
      req(
        [
          ev("verify", "app/reader.md"),
          ev("verify", "v2/tenancy.md"),
          ev("verify", "app/diagrams.md"),
        ],
        { actor: "human:cl_dixon", by: { person: "cl_dixon" } },
      ),
      titles,
    );
    expect(text(verified)).toBe("verified Reader and 2 more");
  });

  test("a note wins over a comment; hiding comments drops a comment-only request", () => {
    const r = req(
      [
        ev("put", "app/reader.md"),
        ev("comment", "app/reader.md", {
          meta: { comment: { kind: "reply", thread: "t", body: "Done" } },
        }),
      ],
      { note: "Mermaid fences drawn by Pele" },
    );
    const e = toEntry(r, titles);
    expect(text(e)).toBe("edited Reader and replied on Reader");
    expect(e?.quote).toBe("Mermaid fences drawn by Pele");
    expect(text(toEntry(r, titles, { hideComments: true }))).toBe("edited Reader");
    const only = req([
      ev("comment", "app/reader.md", { meta: { comment: { kind: "reply", thread: "t" } } }),
    ]);
    expect(toEntry(only, titles, { hideComments: true })).toBeNull();
  });

  test("an unknown title falls back to the file's name", () => {
    expect(text(toEntry(req([ev("put", "notes/plan.md")]), {}))).toBe("edited plan");
  });
});

describe("times", () => {
  const now = new Date(2026, 9, 19, 15, 0).getTime();
  const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString();

  test("days", () => {
    expect(dayLabel(at(19, 9), now)).toBe("Today");
    expect(dayLabel(at(18, 23), now)).toBe("Yesterday");
    expect(dayLabel(at(12, 9), now)).toBe("Oct 12");
    expect(dayLabel(new Date(2025, 9, 12).toISOString(), now)).toBe("Oct 12, 2025");
  });

  test("grouping keeps order and splits by day", () => {
    const days = groupByDay(
      [{ ts: at(19, 14) }, { ts: at(19, 9) }, { ts: at(18, 18) }, { ts: at(12, 9) }],
      now,
    );
    expect(days.map((d) => [d.label, d.items.length])).toEqual([
      ["Today", 2],
      ["Yesterday", 1],
      ["Oct 12", 1],
    ]);
  });

  test("an entry's time", () => {
    expect(entryTime(at(19, 13), now)).toBe("2 h");
    expect(entryTime(at(18, 18, 40), now)).toBe("18:40");
    expect(entryTime(at(18, 18, 40), now, true)).toBe("yesterday");
    expect(entryTime(at(12, 9), now, true)).toBe("Oct 12");
    expect(momentText(at(18, 18, 40), now)).toBe("yesterday, 18:40");
  });

  test("ago in words", () => {
    expect(agoWords(at(19, 13), now)).toBe("2 hours ago");
    expect(agoWords(at(19, 14, 59), now)).toBe("1 minute ago");
    expect(agoWords(new Date(now - 10_000).toISOString(), now)).toBe("just now");
    expect(agoWords(at(16, 15), now)).toBe("3 days ago");
    expect(agoWords(new Date(2026, 7, 1).toISOString(), now)).toBe("on Aug 1");
  });
});

test("who works here", () => {
  expect(whoWorksHere(true, 0, 2)).toBe("You and 2 agents");
  expect(whoWorksHere(true, 1, 3)).toBe("You, 1 other person and 3 agents");
  expect(whoWorksHere(false, 2, 0)).toBe("2 people");
  expect(whoWorksHere(true, 0, 0)).toBe("You");
});

test("words changed", () => {
  expect(wordsText({ added: 38, removed: 12 })).toBe("+38 −12 words");
  expect(wordsText({ added: 0, removed: 0 })).toBeNull();
  expect(wordsText(null)).toBeNull();
});
