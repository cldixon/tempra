import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { d1BlobRefs } from "../src/blobrefs";
import { healthDigest, healthRow, writeHealth } from "../src/library-health";
import { runMaintenance } from "../src/maintain";
import { healthLines } from "../src/mcp/server";
import { sha256Hex } from "../src/okf/hash";
import {
  checkStructure,
  DESCRIPTION_MAX,
  descriptionIssues,
  LARGE_DIRECTORY,
  type StructureEntry,
  titleKey,
} from "../src/okf/structure";
import { type ImportFile, LibraryStore } from "../src/store/store";
import { digestText, sweep } from "../src/sweep";
import { bunD1 } from "./d1";
import { BUNDLES, loadBundle, text } from "./fixtures";
import { memoryBucket } from "./harness";
import { bunSqlHandle } from "./sqlite";

const ctx = (actor = "claude-code/test") => ({ actor, request_id: crypto.randomUUID() });
const md = (title: string, description: string | null, body = "x\n") =>
  `---\ntype: Metric\nstatus: stable\ntitle: ${title}\n${description === null ? "" : `description: ${description}\n`}---\n${body}`;
const T0 = Date.parse("2026-10-01T00:00:00Z");

function newStore(db = new Database(":memory:")) {
  return new LibraryStore(bunSqlHandle(db), { now: () => new Date(T0) });
}

const structure = (s: LibraryStore, path?: string) =>
  s
    .work({ kind: "structure", path, limit: 500 })
    .items.map((i) => `${i.path}: ${i.detail}`)
    .sort();
const codes = (s: LibraryStore) =>
  s
    .work({ kind: "structure", limit: 500 })
    .items.map((i) => [i.path, i.detail])
    .sort();
const hash = (s: LibraryStore, path: string) => {
  const v = s.read(path);
  if (v.kind !== "concept") throw new Error(path);
  return v.hash;
};
const write = (s: LibraryStore, path: string, content: string) => {
  let v: string | undefined;
  try {
    v = hash(s, path);
  } catch {
    v = undefined;
  }
  return s.apply(ctx(), [{ op: "write", path, content, ...(v ? { if_match: v } : {}) }]);
};

describe("structure checks (TEMPRA-64)", () => {
  test("a description: too long for an index line, or only the title again", () => {
    expect(descriptionIssues("Revenue", "Recognized revenue for a period.")).toEqual([]);
    expect(descriptionIssues("Revenue", null)).toEqual([]); // lint's missing_description
    expect(
      descriptionIssues("Revenue", "x".repeat(DESCRIPTION_MAX + 1)).map((i) => i.code),
    ).toEqual(["long_description"]);
    expect(descriptionIssues("Gross Margin", "Gross margins.").map((i) => i.code)).toEqual([
      "description_repeats_title",
    ]);
    expect(descriptionIssues("Gross Margin", "The margin.").map((i) => i.code)).toEqual([
      "description_repeats_title",
    ]);
    expect(descriptionIssues("Gross Margin", "Margin after COGS.")).toEqual([]);
  });

  test("titles that read the same: case, accents, punctuation, plurals and articles aside", () => {
    expect(titleKey("The Orders")).toBe(titleKey("order"));
    expect(titleKey("Café — Sales")).toBe(titleKey("cafe sales"));
    expect(titleKey("Posts Tag Wiki")).not.toBe(titleKey("Posts Tag Wiki Excerpt"));
    expect(titleKey("Class")).toBe("class");
  });

  test("directories: no concepts, a single nested concept, too many, duplicates, orphans", () => {
    const e = (path: string, extra: Partial<StructureEntry> = {}): StructureEntry => ({
      path,
      kind: path.endsWith(".md") ? "concept" : "attachment",
      concept_id: path,
      title: path,
      description: "Said.",
      inbound: 1,
      ...extra,
    });
    const big = Array.from({ length: LARGE_DIRECTORY + 1 }, (_, i) => e(`big/c${i}.md`));
    const found = checkStructure(
      [
        e("files/a.py"),
        e("top/one.md"),
        e("top/nested/one.md"),
        e("dup/a.md", { title: "Orders" }),
        e("dup/b.md", { title: "orders" }),
        e("lonely/a.md", { inbound: 0 }),
        e("lonely/b.md"),
        ...big,
      ],
      null,
      60,
    );
    const at = (k: string) => (found.get(k) ?? []).map((i) => i.code);
    expect(at("dir:files")).toEqual(["no_concepts"]);
    expect(at("dir:top")).toEqual([]); // one concept, but a subdirectory and only one level down
    expect(at("dir:top/nested")).toEqual(["single_concept"]);
    expect(at("dir:dup")).toEqual(["duplicate_titles"]);
    expect(found.get("dir:dup")?.[0]?.paths).toEqual(["dup/a.md", "dup/b.md"]);
    expect(at("dir:lonely")).toEqual(["orphans"]);
    expect(at("dir:big")).toEqual(["large_directory"]);
    expect(at("dir:")).toEqual([]);
    // One concept alone in a library has nothing to be linked from.
    expect(checkStructure([e("a.md", { inbound: 0 })], null, 1).size).toBe(0);
  });

  test("Google's sample bundles are not flooded: four findings across the four", () => {
    const found: string[] = [];
    for (const b of BUNDLES) {
      const s = newStore();
      const files: ImportFile[] = loadBundle(b).map((f) =>
        f.path.endsWith(".md")
          ? { path: f.path, markdown: text(f.bytes) }
          : { path: f.path, blob: { hash: sha256Hex(f.bytes), size: f.bytes.length, media: null } },
      );
      s.import(ctx("human:importer"), files, `fixtures/${b}`);
      found.push(...s.work({ kind: "structure" }).items.map((i) => `${b}/${i.path}`));
      // The daily run agrees with what the import's own refresh found.
      expect(s.maintainStructure().became).toEqual([]);
    }
    expect(found.sort()).toEqual([
      "acme_retail/attesters/index.md",
      "acme_retail/skills/index.md",
      "crypto_bitcoin/references/metrics/index.md",
      "ga4/datasets/index.md",
    ]);
  });
});

describe("the structure process (TEMPRA-64)", () => {
  test("writes keep the directories they touch current; the daily run catches the rest", () => {
    const s = newStore();
    s.apply(ctx(), [
      { op: "write", path: "m/a.md", content: md("A", null) },
      { op: "write", path: "m/b.md", content: md("B", "About b.", "See [a](/m/a.md).\n") },
      { op: "write", path: "n/c.md", content: md("C", "About c.", "See [b](/m/b.md).\n") },
    ]);
    expect(structure(s)).toEqual([
      "m/index.md: 1 concept of 2 has no description, so the index shows a bare title: /m/a.md.",
      "n/index.md: 1 concept of 1 has no links in from other concepts, only the index: /n/c.md.",
    ]);
    const item = s.work({ kind: "structure", path: "m/index.md" }).items[0];
    expect(item?.suggested_action).toContain("one-line description");

    // A description written: the directory's flag goes with the write, no run needed.
    write(s, "m/a.md", md("A", "About a."));
    expect(structure(s)).toEqual([
      "n/index.md: 1 concept of 1 has no links in from other concepts, only the index: /n/c.md.",
    ]);

    // A link from elsewhere ends an orphan at once (the link's target directory is refreshed).
    write(s, "m/a.md", md("A", "About a.", "Back to [c](/n/c.md).\n"));
    expect(structure(s)).toEqual([]);

    // Removing the only link in leaves n/c.md with none: found by the daily run, not the write.
    write(s, "m/a.md", md("A", "About a."));
    expect(structure(s)).toEqual([]);
    const run = s.maintainStructure();
    expect(run).toMatchObject({ skipped: false, concepts: 0, directories: 1 });
    expect(run.became).toEqual(["n/index.md"]);
    expect(structure(s)).toHaveLength(1);

    // Nothing written since: the next run skips on its cursor.
    expect(s.maintainStructure()).toMatchObject({ skipped: true, became: [], directories: 1 });
    expect(s.stats().maintainers.structure).toMatchObject({
      kind: "process",
      lag: 0,
      directories: 1,
      codes: { orphans: 1 },
    });
  });

  test("a concept's own flag shows on its page; moves and deletes take flags with them", () => {
    const s = newStore();
    s.apply(ctx(), [
      { op: "write", path: "a/b/x.md", content: md("Orders", "x".repeat(DESCRIPTION_MAX + 5)) },
      { op: "write", path: "a/y.md", content: md("Y", "About y.", "[x](/a/b/x.md)\n") },
      { op: "write", path: "z.md", content: md("Z", "About z.", "[y](/a/y.md)\n") },
    ]);
    expect(s.work({ path: "a/b/x.md" }).items.map((i) => [i.kind, i.detail])).toEqual([
      [
        "structure",
        `The description is ${DESCRIPTION_MAX + 5} characters; an index line fits 200.`,
      ],
    ]);
    expect(structure(s)).toContain("a/b/index.md: The directory holds a single concept.");

    // Moved up beside y.md: a/b is gone, and so are its flags; the concept's own flag follows.
    s.apply(ctx(), [{ op: "move", path: "a/b/x.md", to: "a/x.md" }]);
    expect(structure(s).filter((l) => l.startsWith("a/b/"))).toEqual([]);
    expect(s.work({ kind: "structure", path: "a/x.md" }).total).toBe(1);

    // A second concept with a title that reads the same, in the same directory.
    write(s, "a/orders.md", md("The orders", "Every order.", "[x](/a/x.md)\n"));
    expect(structure(s).find((l) => l.startsWith("a/index.md"))).toContain(
      "Titles that read the same: /a/orders.md and /a/x.md.",
    );

    s.apply(ctx(), [{ op: "delete", path: "a/x.md", if_match: hash(s, "a/x.md") }]);
    expect(s.work({ kind: "structure", path: "a/x.md" }).total).toBe(0);
    expect(structure(s).filter((l) => l.includes("same"))).toEqual([]);
  });

  test("a library from before the process gets a first run when it opens", () => {
    const db = new Database(":memory:");
    newStore(db).apply(ctx(), [{ op: "write", path: "m/a.md", content: md("A", null) }]);
    db.run("DELETE FROM flags WHERE kind = 'structure'");
    db.run("DELETE FROM meta WHERE key = 'structure'");
    expect(codes(newStore(db))).toEqual([
      [
        "m/index.md",
        "1 concept of 1 has no description, so the index shows a bare title: /m/a.md.",
      ],
    ]);
  });
});

describe("the health summary (TEMPRA-66)", () => {
  test("the daily pass keeps counts by kind and the newest unverified changes in meta", async () => {
    const s = newStore();
    s.apply(ctx(), [
      { op: "write", path: "a.md", content: md("A", "About a.", "[gone](/gone.md)\n") },
      { op: "write", path: "b.md", content: md("B", null, "[a](/a.md)\n") },
    ]);
    // Before any run, it is worked out when asked.
    expect(s.stats().maintainers.health.last_run).toBeNull();
    expect(s.health().counts).toMatchObject({ broken_link: 1, lint: 1 });

    const res = await runMaintenance({
      store: s,
      bucket: memoryBucket(),
      libraryId: "lib-h",
      now: new Date(T0),
    });
    expect(res.structure.skipped).toBe(false);
    expect(res.health).toEqual({
      at: "2026-10-01T00:00:00Z",
      seq: 2,
      counts: {
        stale: 0,
        stale_soon: 0,
        broken_link: 1,
        lint: 1,
        structure: 1,
        comment: 0,
        external_image: 0,
      },
      unverified: {
        total: 2,
        newest: [
          { path: "b.md", seq: 2, ts: "2026-10-01T00:00:00Z", actor: "claude-code/test" },
          { path: "a.md", seq: 1, ts: "2026-10-01T00:00:00Z", actor: "claude-code/test" },
        ],
      },
    });
    expect(s.stats().maintainers.health.last_run).toBe("2026-10-01T00:00:00Z");

    // Read back as kept, not worked out again, until the next pass.
    s.verify(ctx("human:ann"), "b.md");
    expect(s.health().unverified.total).toBe(2);
    expect(s.summary().health).toEqual(res.health);
    expect(s.maintainHealth().unverified.newest.map((c) => c.path)).toEqual(["a.md"]);

    expect(healthLines(s.health())).toEqual([
      "Health (checked 2026-10-01T00:00:00Z): broken links 1 · lint 1 · structure 1",
      "Unverified: 1 concept changed since anyone last verified them; newest a.md (claude-code/test, 2026-10-01T00:00:00Z)",
    ]);
  });

  test("the operator digest lists libraries with open work, the most first", async () => {
    const health = (lint: number, structure: number) => ({
      at: "2026-10-01T03:00:00Z",
      seq: 1,
      counts: { stale: 0, stale_soon: 2, broken_link: 0, lint, structure, comment: 0 },
      unverified: { total: 0, newest: [] },
    });
    const libs: Record<string, ReturnType<typeof health>> = {
      quiet: health(0, 0),
      some: health(1, 0),
      most: health(2, 3),
    };
    // Each library's pass writes its own health row (TEMPRA-92); the digest reads only those.
    const { d1, db } = bunD1();
    db.run(
      "INSERT INTO users (id, email, actor, handle, created) VALUES ('u', 'u@x', 'human:o', 'o', '')",
    );
    const now = new Date("2026-10-01T04:30:00Z");
    for (const [id, h] of Object.entries(libs)) {
      db.run(
        "INSERT INTO libraries (id, slug, owner, visibility, created, do_id) VALUES (?, ?, 'u', 'private', '', ?)",
        [id, id, id],
      );
      const row = healthRow({
        export: { lag: 0, last_run: "2026-10-01T03:00:00Z" },
        bytes: 0,
        limitBytes: 1e9,
        counts: h.counts,
        nextRun: "2026-10-02T03:00:00Z",
        now,
      });
      await writeHealth(d1, id, row, now);
    }
    const r = await sweep({
      health: (t) => healthDigest(d1, t),
      refs: d1BlobRefs(d1),
      queue: { send: async () => {}, sendBatch: async () => {} },
      bucket: { delete: async () => {} },
      now,
    });
    expect(r.health.map((h) => h.path)).toEqual(["o/most", "o/some"]);
    expect(digestText(r)).toContain(
      "Library health (open work):\n- o/most: stale soon 2 · lint 2 · structure 3\n- o/some: stale soon 2 · lint 1\n",
    );
  });
});
