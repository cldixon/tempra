import { describe, expect, test } from "bun:test";
import { OkfError } from "../src/store/errors";
import { LibraryStore, type RequestContext } from "../src/store/store";
import { API, setup } from "./harness";
import { bunSqlHandle } from "./sqlite";

let n = 0;
const ctx = (actor: string, person?: string, agent?: string): RequestContext => ({
  actor,
  request_id: `req-${++n}`,
  by: person ? (agent ? { person, agent } : { person }) : null,
});
const ana = () => ctx("human:ana", "u_ana");
const agent = () => ctx("claude-code/ana", "u_ana", "a_ana");

function newStore() {
  let t = Date.parse("2026-10-05T12:00:00Z");
  return new LibraryStore(bunSqlHandle(), {
    now: () => {
      t += 1000;
      return new Date(t);
    },
  });
}

const doc = (title: string, fm = "", body = "Revenue minus cost.") =>
  `---\ntype: Metric\ntitle: ${title}\ndescription: About ${title}.\n${fm}---\n# ${title}\n\n${body}\n`;

function write(s: LibraryStore, c: RequestContext, path: string, content = doc(path)) {
  const if_match = s.concepts().items.find((i) => i.path === path)?.hash ?? null;
  return s.apply(c, [{ op: "write", path, content, if_match }]);
}

function seeded() {
  const s = newStore();
  write(s, agent(), "metrics/margin.md", doc("Margin"));
  write(s, agent(), "metrics/churn.md", doc("Churn", "stale_after: 2026-10-01T00:00:00Z\n"));
  write(s, agent(), "metrics/finance/revenue.md", doc("Revenue"));
  write(s, agent(), "metrics/finance/deep/cost.md", doc("Cost"));
  s.apply(agent(), [
    {
      op: "attach",
      path: "metrics/chart.png",
      blob: { hash: "a".repeat(64), size: 3, media: null },
    },
    {
      op: "attach",
      path: "metrics/img/logo.png",
      blob: { hash: "b".repeat(64), size: 3, media: null },
    },
  ]);
  write(s, agent(), "about.md", doc("About"));
  return s;
}

describe("the folder view", () => {
  test("subfolders with their counts, the folder's concepts and counts over them", () => {
    const s = seeded();
    s.verify(ana(), "metrics/margin.md");
    // Ana wrote the current version of churn herself, after an agent's.
    write(
      s,
      ana(),
      "metrics/churn.md",
      doc("Churn", "stale_after: 2026-10-01T00:00:00Z\n", "New."),
    );
    s.comment(ana(), { kind: "open", path: "metrics/churn.md", body: "Source?" });

    const f = s.folder("metrics");
    expect(f.dir).toBe("metrics");
    expect(f.seq).toBe(s.headSeq());
    const revenue = s.history("metrics/finance/revenue.md").events[0]?.ts;
    const cost = s.history("metrics/finance/deep/cost.md").events[0]?.ts;
    expect(f.folders).toEqual([
      { path: "metrics/finance", concepts: 2, newest_ts: cost ?? "" },
      { path: "metrics/img", concepts: 0, newest_ts: null },
    ]);
    expect(revenue && cost && revenue < cost).toBe(true);
    expect(f.concepts.map((c) => c.path)).toEqual(["metrics/churn.md", "metrics/margin.md"]);
    const [churn, margin] = f.concepts;
    expect(churn).toMatchObject({
      title: "Churn",
      description: "About Churn.",
      actor: "human:ana",
      by: { person: "u_ana" },
      verified: false,
      comments: 1,
      stale: "stale",
    });
    expect(margin).toMatchObject({
      title: "Margin",
      actor: "claude-code/ana",
      by: { person: "u_ana", agent: "a_ana" },
      verified: true,
      comments: 0,
    });
    expect(margin && "stale" in margin).toBe(false);
    // The version on screen: the verify after it is not a change.
    const put = s.history("metrics/margin.md").events.find((e) => e.op === "put");
    expect(margin?.ts).toBe(put?.ts ?? "");
    expect(margin?.seq).toBeGreaterThan(put?.seq ?? 0);
    expect(f.counts).toEqual({
      concepts: 2,
      unverified: 1,
      newest: { path: "metrics/churn.md", ts: churn?.ts ?? "" },
    });
  });

  test("the root, a folder of folders only, and a folder that does not exist", () => {
    const s = seeded();
    const root = s.folder("");
    expect(root.dir).toBe("");
    expect(root.folders).toEqual([expect.objectContaining({ path: "metrics", concepts: 4 })]);
    expect(root.concepts.map((c) => c.path)).toEqual(["about.md"]);
    expect(s.folder("/metrics/finance/").concepts.map((c) => c.path)).toEqual([
      "metrics/finance/revenue.md",
    ]);
    const img = s.folder("metrics/img");
    expect(img.concepts).toEqual([]);
    expect(img.counts).toEqual({ concepts: 0, unverified: 0, newest: null });
    for (const missing of ["nope", "metrics/margin.md", "metrics/fin", "../etc"]) {
      expect(() => s.folder(missing)).toThrow(OkfError);
    }
    const empty = newStore().folder("");
    expect(empty).toMatchObject({ seq: 0, folders: [], concepts: [], counts: { concepts: 0 } });
  });

  test("a move keeps who wrote the version on screen", () => {
    const s = seeded();
    s.apply(ana(), [{ op: "move", path: "metrics/margin.md", to: "metrics/finance/margin.md" }]);
    const moved = s.folder("metrics/finance").concepts.find((c) => c.path.endsWith("margin.md"));
    expect(moved).toMatchObject({ actor: "claude-code/ana", title: "Margin" });
  });
});

describe("GET /folder", () => {
  test("one request for a folder; 404 for none, and for a stranger", async () => {
    const s = setup();
    const put = await s.req("/files/notes/a.md", {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: doc("A"),
    });
    expect(put.status).toBeLessThan(300);
    const r = await s.app.request(`${API}/folder?dir=notes`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      dir: "notes",
      folders: [],
      concepts: [{ path: "notes/a.md", title: "A", actor: "claude-code/test", by: null }],
      counts: { concepts: 1, unverified: 1 },
    });
    const root = (await (await s.app.request(`${API}/folder`)).json()) as {
      folders: { path: string; concepts: number }[];
    };
    expect(root.folders).toMatchObject([{ path: "notes", concepts: 1 }]);
    const missing = await s.app.request(`${API}/folder?dir=nope`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "not_found" });
    const other = await s.stranger();
    expect((await other.app.request(`${API}/folder?dir=notes`)).status).toBe(404);
  });
});
