import { describe, expect, test } from "bun:test";
import { runMaintenance } from "../src/maintain";
import { bookmarkError, checkRestoreTime, prepareRestore } from "../src/recovery";
import { LibraryStore } from "../src/store/store";
import { readTar } from "../src/util/tar";
import { fakeRecovery, memoryBucket, setup } from "./harness";
import { bunSqlHandle } from "./sqlite";

type S = ReturnType<typeof setup>;
const LIB = "/owner/demo";
const ORIGIN = "http://localhost";
const md = (body: string) => `---\ntype: Note\n---\n${body}`;
const ctx = () => ({ actor: "claude-code/test", request_id: crypto.randomUUID() });

async function put(s: S, path: string, content: string) {
  const r = await s.req(`/files/${path}`, {
    method: "PUT",
    headers: { "Content-Type": "text/markdown" },
    body: content,
  });
  expect(r.status).toBeLessThan(300);
}

/** A restore as the Recovery page asks for it: the API, with the session, from this site. */
function post(s: S, body: Record<string, string>, origin = ORIGIN) {
  return s.app.request(`/api/v1/libraries/owner/demo/restore`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const minutesAgo = (n: number) =>
  new Date(Date.now() - n * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");

describe("point-in-time restore (spec: Backups and recovery)", () => {
  test("the requested time must be a past instant inside the 30-day window", () => {
    const now = new Date("2026-09-30T18:00:00Z");
    expect(checkRestoreTime("2026-09-30T17:00:00Z", now)).toEqual(new Date("2026-09-30T17:00:00Z"));
    expect(checkRestoreTime("2026-09-30T19:00:00+02:00", now)).toBeInstanceOf(Date);
    expect(checkRestoreTime("2026-09-30", now)).toContain("full ISO 8601 datetime");
    expect(checkRestoreTime("2026-09-30T19:00:00Z", now)).toContain("in the past");
    expect(checkRestoreTime("2026-08-01T00:00:00Z", now)).toContain("30 days");
    // Recoverable history trails live writes by about a minute.
    expect(checkRestoreTime("2026-09-30T17:59:00Z", now)).toContain("at least 2 minutes old");
    expect(checkRestoreTime("2026-09-30T17:58:00Z", now)).toBeInstanceOf(Date);
  });

  test("the storage's PITR errors become clear answers", () => {
    expect(bookmarkError("Requested time is before this database existed.")).toMatchObject({
      status: 400,
      code: "before_history",
    });
    expect(bookmarkError("This database has no history.")).toMatchObject({
      status: 409,
      code: "no_history",
    });
    expect(
      bookmarkError(
        "This Durable Object's storage back-end does not implement point-in-time recovery.",
      ),
    ).toMatchObject({ status: 501, code: "no_pitr" });
  });

  test("a restore exports first, arms the bookmark and records itself in R2", async () => {
    const store = new LibraryStore(bunSqlHandle());
    const bucket = memoryBucket();
    const recovery = fakeRecovery();
    store.apply(ctx(), [{ op: "write", path: "a.md", content: md("A\n") }]);
    const now = new Date("2026-09-30T18:02:11Z");
    const out = await prepareRestore({
      store,
      bucket,
      recovery,
      libraryId: "lib-x",
      target: { to: "2026-09-30T17:00:00Z" },
      actor: "human:owner",
      now,
    });
    if (!out.ok) throw new Error(out.message);
    const { id } = out.record;
    expect(id).toMatch(/^20260930T180211000Z-[0-9a-f]{4}$/);
    const suffix = id.slice(-4);
    expect(out).toMatchObject({
      ok: true,
      record: {
        kind: "restore",
        to: "2026-09-30T17:00:00Z",
        actor: "human:owner",
        seq_before: 1,
        export: `exports/lib-x/2026-09-30-pre-restore-180211000-${suffix}/`,
        bookmark: "bookmark@2026-09-30T17:00:00.000Z",
      },
    });
    expect(recovery.armed).toEqual(["bookmark@2026-09-30T17:00:00.000Z"]);
    const folder = `exports/lib-x/2026-09-30-pre-restore-180211000-${suffix}/`;
    const tar = readTar(bucket.objects.get(`${folder}bundle.tar`) as Uint8Array);
    expect(tar.map((f) => f.path)).toContain("a.md");
    expect(bucket.objects.has(`${folder}ledger.jsonl`)).toBe(true);
    const manifest = JSON.parse(
      new TextDecoder().decode(bucket.objects.get(`${folder}manifest.json`)),
    );
    expect(manifest).toMatchObject({ kind: "pre-restore", seq: 1 });
    expect(bucket.objects.has(`restores/lib-x/${id}.json`)).toBe(true);

    // The nightly export still sorts after a same-day pre-restore folder, so it counts as newest.
    const nightly = await runMaintenance({
      store,
      bucket,
      libraryId: "lib-x",
      now,
      retentionDays: 0,
    });
    expect(nightly.deleted).toEqual([]);
  });

  test("two restores in the same millisecond get their own records and folders", async () => {
    const store = new LibraryStore(bunSqlHandle());
    const bucket = memoryBucket();
    const now = new Date("2026-09-30T18:02:11.042Z");
    const run = () =>
      prepareRestore({
        store,
        bucket,
        recovery: fakeRecovery(),
        libraryId: "lib-x",
        target: { to: "2026-09-30T17:00:00Z" },
        actor: "human:owner",
        now,
      });
    const [a, b] = [await run(), await run()];
    if (!a.ok || !b.ok) throw new Error("restore refused");
    expect(a.record.id).not.toBe(b.record.id);
    expect(a.record.export).not.toBe(b.record.export);
    const records = [...bucket.objects.keys()].filter((k) => k.startsWith("restores/"));
    expect(records).toHaveLength(2);
  });

  test("without point-in-time recovery, nothing is written", async () => {
    const store = new LibraryStore(bunSqlHandle());
    const bucket = memoryBucket();
    const out = await prepareRestore({
      store,
      bucket,
      recovery: fakeRecovery({ unsupported: true }),
      libraryId: "lib-x",
      target: { to: new Date(Date.now() - 5 * 60_000).toISOString() },
      actor: "human:owner",
      now: new Date(),
    });
    expect(out).toMatchObject({ ok: false, status: 501, code: "no_pitr" });
    expect(bucket.objects.size).toBe(0);
  });

  test("the Recovery page: restore, list, undo, from the signed-in person", async () => {
    const s = setup();
    await put(s, "a.md", md("A\n"));
    const pageRes = await s.app.request(`${LIB}/-/recovery`);
    expect(pageRes.status).toBe(200);
    expect(await pageRes.text()).toContain('<div id="root"></div>');
    // Recent requests help pick a time; the page reads them from the API.
    expect(
      await (await s.app.request("/api/v1/libraries/owner/demo/requests?limit=10")).text(),
    ).toContain("claude-code/test");
    // A stranger does not see the library.
    const stranger = await s.stranger();
    expect((await stranger.app.request(`${LIB}/-/recovery`)).status).toBe(404);

    // Cross-origin posts are refused.
    expect((await post(s, { to: minutesAgo(5) }, "https://evil.example")).status).toBe(403);
    expect(s.pitr.armed).toEqual([]);

    const to = minutesAgo(5);
    const ok = await post(s, { to });
    expect(ok.status).toBe(201);
    const record = (await ok.json()) as { id: string; to: string; actor: string; export: string };
    expect(record).toMatchObject({ to, actor: "human:owner" });
    expect(s.pitr.armed).toEqual([`bookmark@${to.replace("Z", ".000Z")}`]);
    expect(record.id).toMatch(/^\d{8}T\d{9}Z-[0-9a-f]{4}$/);

    // The pre-restore export downloads like a nightly one, and is listed with them.
    const folder = /(\d{4}-\d{2}-\d{2}-pre-restore-\d{9}-[0-9a-f]{4})\/?$/.exec(record.export)?.[1];
    expect(folder).toBeDefined();
    const dl = await s.app.request(`${LIB}/-/exports/${folder}/bundle.tar`);
    expect(dl.status).toBe(200);
    const exports = (await (
      await s.app.request("/api/v1/libraries/owner/demo/exports")
    ).json()) as {
      exports: { date: string }[];
    };
    expect(exports.exports.map((e) => e.date)).toContain(folder as string);
    const listed = (await (
      await s.app.request("/api/v1/libraries/owner/demo/restores")
    ).json()) as {
      restores: { id: string }[];
    };
    expect(listed.restores.map((r) => r.id)).toEqual([record.id]);

    // A time outside the window is refused with the reason.
    const old = await post(s, { to: "2020-01-01T00:00:00Z" });
    expect(old.status).toBe(400);
    expect(await old.text()).toContain("30 days");

    // Undo arms the bookmark the restore returned.
    const undo = await post(s, { undo: record.id });
    expect(undo.status).toBe(201);
    expect(await undo.json()).toMatchObject({
      kind: "undo",
      undoes: record.id,
      actor: "human:owner",
    });
    expect(s.pitr.armed[1]).toMatch(/^undo@/);

    const missing = await post(s, { undo: "20200101T000000000Z" });
    expect(missing.status).toBe(404);
  });

  test("REST: human-only restore and listing, bookmarks kept server-side", async () => {
    const s = setup();
    await put(s, "a.md", md("A\n"));
    const json = (token: string, body: unknown) =>
      s.req("/restore", {
        method: "POST",
        token,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    expect(
      (await json("writer", { to: new Date(Date.now() - 5 * 60_000).toISOString() })).status,
    ).toBe(403);
    expect((await json("human", {})).status).toBe(400);
    expect((await json("human", { to: "2020-01-01T00:00:00Z" })).status).toBe(400);

    const to = new Date(Date.now() - 5 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const res = await json("human", { to });
    expect(res.status).toBe(201);
    const record = (await res.json()) as Record<string, unknown>;
    expect(record).toMatchObject({ kind: "restore", to, actor: "human:owner", seq_before: 1 });
    expect(record.bookmark).toBeUndefined();
    expect(record.undo_bookmark).toBeUndefined();

    const list = (await (await s.req("/restores", { token: "human" })).json()) as {
      restores: Record<string, unknown>[];
    };
    expect(list.restores.map((r) => r.id)).toEqual([record.id]);
    expect(list.restores[0]?.undo_bookmark).toBeUndefined();

    const undo = await json("human", { undo: record.id });
    expect(undo.status).toBe(201);
    const undone = (await undo.json()) as Record<string, unknown>;
    expect(undone).toMatchObject({ kind: "undo", undoes: record.id });
    // Even within the same millisecond, the undo gets its own record and export folder.
    expect(undone.id).not.toBe(record.id);
    expect(undone.export).not.toBe(record.export);
    expect(
      ((await (await s.req("/restores", { token: "human" })).json()) as { restores: unknown[] })
        .restores,
    ).toHaveLength(2);
    expect((await json("human", { undo: "nope" })).status).toBe(404);
  });
});
