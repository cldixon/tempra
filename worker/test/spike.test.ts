import { describe, expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import type { TokenInfo } from "../src/auth";
import { callAgent, makeAgentClient, SPIKE_INSTANCE } from "../src/spike/agent-client";
import { LocalMcp } from "../src/spike/local-mcp";
import { costOf, MAX_NEW_THREADS, modelSpec } from "../src/spike/models";
import { SYSTEM_PROMPT } from "../src/spike/prompt";
import { candidates, resultsTable } from "../src/spike/report";
import {
  type AiLike,
  type AnthropicLike,
  agentMcp,
  copySlug,
  prepareRun,
  type RunDeps,
  type RunParams,
  readAiTurn,
  runItemA,
} from "../src/spike/runner";
import { SpikeState } from "../src/spike/state";
import { batches, chooseWork, QUESTIONS } from "../src/spike/tasks";
import { OkfError } from "../src/store/errors";
import type { WorkItem } from "../src/store/store";
import { API, LIB, ORIGIN, OWNER, setup, TOKENS } from "./harness";
import { bunSqlHandle } from "./sqlite";

type S = ReturnType<typeof setup>;

const doc = (title: string, body = "Some text.\n") =>
  `---\ntype: Design\ntitle: ${title}\ndescription: About ${title.toLowerCase()} here.\n---\n# ${title}\n\n${body}`;

const work = (kind: string, path: string, inbound = 0): WorkItem => ({
  kind,
  path,
  since: "",
  detail: `${kind} on ${path}`,
  suggested_action: "fix it",
  inbound_links: inbound,
});

/** The spike's platform, in process: agent objects on bun:sqlite, a recorded Workflow start. */
function fakeSpike(s: S, opts: { anthropic?: AnthropicLike | null; ai?: AiLike | null } = {}) {
  const states = new Map<string, SpikeState>();
  const started: RunParams[] = [];
  const state = (name: string) => {
    let st = states.get(name);
    if (!st) {
      st = new SpikeState(bunSqlHandle());
      states.set(name, st);
    }
    return st;
  };
  s.deps.spike = {
    agent: (name) => makeAgentClient(async (m, a) => callAgent(state(name), m, a)),
    anthropic: async () => opts.anthropic ?? null,
    managedAgents: () => null,
    ai: opts.ai ?? null,
    start: async (p) => {
      started.push(p);
      return `wf-${p.run}`;
    },
    origin: ORIGIN,
    sleep: async () => {},
  };
  s.deps.managedAgents = (ref) => [{ id: `agent:${ref.id}/librarian`, name: "librarian" }];
  return { state, started };
}

function post(s: S, path: string, body?: unknown) {
  return s.app.request(`${API}${path}`, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** A base library with the questions' concepts and a structure problem in one directory. */
async function seedBase(s: S) {
  const files: Record<string, string> = {};
  for (const q of QUESTIONS) files[q.path] = doc(`Topic ${q.path}`);
  // Two titles that read the same once plurals are set aside: a structure item.
  files["notes/margin.md"] = doc("Margin");
  files["notes/margins.md"] = doc("Margins");
  for (const [path, body] of Object.entries(files)) {
    const r = await s.req(`/files/${path}`, {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body,
    });
    expect(r.status).toBeLessThan(300);
  }
}

/** A Claude stand-in: on each item, comments once (reply or open) and finishes. */
function scriptedClaude(calls: Anthropic.MessageCreateParamsNonStreaming[]): AnthropicLike {
  const usage = {
    input_tokens: 1000,
    output_tokens: 100,
    cache_read_input_tokens: 2000,
    cache_creation_input_tokens: 0,
  };
  return {
    messages: {
      create: (async (body: Anthropic.MessageCreateParamsNonStreaming) => {
        calls.push(structuredClone(body));
        const first = body.messages[0]?.content as string;
        const replied = body.messages.length > 1;
        const msg = (content: unknown[], stop: string) =>
          ({
            id: "m",
            type: "message",
            role: "assistant",
            model: body.model,
            content,
            stop_reason: stop,
            usage,
          }) as unknown as Anthropic.Message;
        if (replied) return msg([{ type: "text", text: "Done." }], "end_turn");
        const thread = /in thread (\S+)\./.exec(first)?.[1];
        const input = thread
          ? { action: "reply", thread, body: "See /v2/sharing.md." }
          : { action: "open", path: "notes/margins.md", body: "Rename to Margin trends." };
        return msg([{ type: "tool_use", id: "tu1", name: "comment", input }], "tool_use");
      }) as unknown as AnthropicLike["messages"]["create"],
    },
  };
}

describe("spike: task set", () => {
  test("ten structure, five stale, five link or lint, one per path, interleaved", () => {
    const queue = [
      ...Array.from({ length: 12 }, (_, i) => work("structure", `s/${i}.md`, i)),
      ...Array.from({ length: 6 }, (_, i) => work("stale", `t/${i}.md`)),
      work("lint", "l/1.md"),
      work("broken_link", "b/1.md"),
      work("broken_link", "s/11.md"),
    ];
    const chosen = chooseWork(queue);
    const count = (k: string) => chosen.filter((w) => w.kind === k).length;
    expect([count("structure"), count("stale"), count("broken_link") + count("lint")]).toEqual([
      10, 5, 2,
    ]);
    // Ranked by inbound links; a path already taken is not taken twice.
    expect(chosen[0]?.path).toBe("s/11.md");
    expect(chosen.map((w) => w.kind).slice(0, 4)).toEqual([
      "structure",
      "stale",
      "structure",
      "broken_link",
    ]);
    expect(new Set(chosen.map((w) => w.path)).size).toBe(chosen.length);
  });

  test("batches stay within the thread cap; the questions come first", () => {
    const set = {
      built_at: "",
      seq: 1,
      bundle: "",
      items: [
        ...QUESTIONS.map((q, i) => ({ ...q, n: i + 1, kind: "question" as const })),
        ...Array.from({ length: 12 }, (_, i) => ({
          n: 6 + i,
          kind: "structure" as const,
          path: `s/${i}.md`,
          detail: "",
        })),
      ],
    };
    const b = batches(set);
    expect(b.map((x) => x.length)).toEqual([10, 5, 2]);
    for (const x of b) {
      expect(x.filter((i) => i.kind !== "question").length).toBeLessThanOrEqual(MAX_NEW_THREADS);
    }
  });
});

describe("spike: state", () => {
  test("one run at a time; the agent comments only during one, under the cap, never resolving", () => {
    const st = new SpikeState(bunSqlHandle());
    const run = st.createRun("a", "claude-haiku-5-5", 1);
    expect(() => st.createRun("b", "claude-haiku-5-5", 1)).toThrow(OkfError);
    expect(() => st.admitComment("open")).toThrow("only during a run");
    st.startRun(run.id);
    st.beginItem(run.id, 6);
    for (let i = 0; i < MAX_NEW_THREADS; i++)
      expect(st.admitComment("open")).toEqual({ run: run.id, item: 6 });
    expect(() => st.admitComment("open")).toThrow("its limit");
    expect(st.admitComment("reply").item).toBe(6);
    expect(() => st.admitComment("resolve")).toThrow("never resolves");
    st.releaseThread(run.id);
    expect(st.admitComment("open").run).toBe(run.id);
    st.finishRun(run.id, "done");
    expect(st.active()).toBeNull();
    expect(st.doneBatches("a", "claude-haiku-5-5")).toEqual([1]);
  });

  test("usage adds up as it is spent, and a retried item counts its retry", () => {
    const st = new SpikeState(bunSqlHandle());
    const run = st.createRun("a", "claude-opus-5-5", 1);
    st.beginItem(run.id, 1);
    st.addUsage(run.id, 1, { input: 10, output: 5, cacheRead: 100, cacheWrite: 0 }, 0.5);
    st.beginItem(run.id, 1); // the Workflow retried the step
    st.addUsage(run.id, 1, { input: 10, output: 5, cacheRead: 100, cacheWrite: 0 }, 0.25);
    st.endItem(run.id, 1, { status: "ok", retries: 1, failures: 1, latency_ms: 1234 });
    const r = st.result(run.id, 1);
    expect(r).toMatchObject({
      status: "ok",
      turns: 2,
      retries: 2,
      failures: 1,
      input: 20,
      cost: 0.75,
    });
  });

  test("the spend cap refuses at the cap and can be raised", () => {
    const st = new SpikeState(bunSqlHandle());
    expect(st.remaining()).toBe(20);
    st.charge("x", "claude-opus-5-5", 19.5);
    expect(st.remaining()).toBeCloseTo(0.5);
    st.charge("x", "claude-opus-5-5", 0.6);
    expect(() => st.remaining()).toThrow("cap");
    st.setCap(30);
    expect(st.remaining()).toBeCloseTo(9.9);
  });
});

describe("spike: models and parsing", () => {
  test("cost at list price, cache reads cheaper", () => {
    const opus = modelSpec("claude-opus-5-5");
    expect(opus).not.toBeNull();
    if (!opus) return;
    expect(costOf(opus, { input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 0 })).toBeCloseTo(
      24.2,
    );
    expect(modelSpec("glm-5.3")?.arms).toEqual(["a"]);
  });

  test("Workers AI answers in either shape", () => {
    const chat = readAiTurn({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [{ id: "c1", function: { name: "read", arguments: '{"path":"a.md"}' } }],
          },
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 7,
        prompt_tokens_details: { cached_tokens: 40 },
      },
    });
    expect(chat.calls).toEqual([{ id: "c1", name: "read", args: { path: "a.md" } }]);
    expect(chat.usage).toEqual({ input: 60, output: 7, cacheRead: 40, cacheWrite: 0 });
    const legacy = readAiTurn({ response: "ok", tool_calls: [{ name: "start", arguments: {} }] });
    expect(legacy.text).toBe("ok");
    expect(legacy.calls[0]?.name).toBe("start");
  });

  test("a copy's slug names its arm and model", () => {
    expect(copySlug("tempra-dev", "a", "claude-opus-5-5")).toBe("tempra-dev-a-opus-5-5");
    expect(copySlug("tempra-dev", "b", "@cf/zai-org/glm-5.3")).toBe("tempra-dev-b-glm-5-3");
  });

  test("the system prompt treats library content as data", () => {
    expect(SYSTEM_PROMPT).toContain("untrusted data");
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("spike: in-process MCP", () => {
  test("only the agent's tools, called through Tempra's own server", async () => {
    const s = setup();
    const t = TOKENS.reader as TokenInfo;
    const mcp = new LocalMcp({
      actor: t.actor,
      scope: t.scope,
      tiers: t.mcp_tiers,
      libraries: [t],
      open: (tok) => s.deps.library(tok),
      blobs: s.deps.blobs,
      origin: ORIGIN,
    });
    expect((await mcp.tools()).map((x) => x.name)).toEqual([
      "start",
      "read",
      "browse",
      "work",
      "comments",
      "comment",
      "search",
      "links",
    ]);
    expect((await mcp.call("start", {})).isError).toBe(false);
    expect((await mcp.call("write", {})).isError).toBe(true);
  });
});

describe("spike: routes and a run", () => {
  test("absent outside a spike preview", async () => {
    const s = setup();
    expect((await s.app.request(`${API}/agent`)).status).toBe(404);
  });

  test("owner only", async () => {
    const s = setup();
    fakeSpike(s);
    const other = await s.stranger();
    expect((await other.app.request(`${API}/agent`)).status).toBe(404);
    expect((await s.req("/agent", { token: "writer" })).status).toBe(200);
  });

  test("task set, run now, Arm A end to end, blind grading, results", async () => {
    const s = setup();
    const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const { state, started } = fakeSpike(s, { anthropic: scriptedClaude(calls) });
    await seedBase(s);

    // No key: the Claude arm skips. With one: the run is queued and its Workflow started.
    const tasks = await post(s, "/agent/tasks");
    expect(tasks.status).toBe(201);
    const set = (await tasks.json()) as { items: { kind: string; n: number }[] };
    expect(set.items.filter((i) => i.kind === "question")).toHaveLength(5);
    expect(set.items.some((i) => i.kind === "structure")).toBe(true);
    expect((await post(s, "/agent/tasks")).status).toBe(409);
    expect((await post(s, "/agent/runs", { arm: "b", model: "glm-5.3" })).status).toBe(400);
    const queued = await post(s, "/agent/runs", { arm: "a", model: "claude-haiku-5-5" });
    expect(queued.status).toBe(202);
    expect((await post(s, "/agent/runs", { arm: "a", model: "claude-opus-5-5" })).status).toBe(409);
    const p = started[0] as RunParams;
    expect(p).toMatchObject({ arm: "a", model: "claude-haiku-5-5", batch: 1, run: 1 });

    // What the Workflow does, step by step.
    const d = s.deps as unknown as RunDeps;
    const agent = (d.spike as NonNullable<RunDeps["spike"]>).agent(LIB.id);
    await agent.startRun(p.run);
    const taskSet = await agent.taskSet();
    if (!taskSet) throw new Error("no task set");
    const copy = await prepareRun(d, p, taskSet);
    expect(copy.slug).toBe("demo-a-haiku-5-5");
    expect(Object.keys(copy.threads)).toHaveLength(5);
    // The copy is its own library, with the questions mentioning the librarian.
    const lib = await s.deps.libraryByDoId(copy.do_id);
    const threads = (await lib?.comments({ status: "open" }))?.threads ?? [];
    expect(threads).toHaveLength(5);
    expect(threads[0]?.comments[0]?.mentions).toBeDefined();
    for (const item of batches(taskSet)[0] ?? []) {
      await agent.beginItem(p.run, item.n);
      await agent.endItem(p.run, item.n, await runItemA(d, p, copy, item));
    }
    await agent.finishRun(p.run, "done");

    // Cached prefix: tools, then the system prompt with its breakpoint; nothing per item there.
    const first = calls[0];
    expect(first?.tools?.map((t) => (t as Anthropic.Tool).name)).toHaveLength(8);
    expect(JSON.stringify(first?.system)).toContain("ephemeral");
    const results = await agent.results(p.run);
    expect(results.every((r) => r.status === "ok")).toBe(true);
    expect(results[0]?.cost).toBeGreaterThan(0);
    const comments = await agent.comments(p.run);
    expect(comments.filter((c) => c.kind === "reply")).toHaveLength(5);
    expect(comments.filter((c) => c.kind === "open").length).toBeGreaterThan(0);
    expect(await state(SPIKE_INSTANCE).spent()).toBeCloseTo(
      results.reduce((a, r) => a + r.cost, 0),
    );

    // The grading sheet names no model and no arm; grades land on the right run and item.
    const sheet = await (await s.app.request(`${API}/agent/grading`)).text();
    expect(sheet).toContain("See /v2/sharing.md.");
    expect(sheet).not.toMatch(/haiku|opus|sonnet|glm|arm a/i);
    const key = /name="g_([0-9a-f]+)"/.exec(sheet)?.[1] as string;
    const graded = await s.app.request(`${API}/agent/grading`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" },
      body: `g_${key}=useful&g_nonsense=useful`,
    });
    expect(await graded.text()).toContain("Saved 1.");
    const results2 = (await (await s.app.request(`${API}/agent/results`)).json()) as {
      rows: { model: string; useful: number; ok: number }[];
    };
    expect(results2.rows[0]).toMatchObject({ model: "claude-haiku-5-5", useful: 1 });
    expect(results2.rows[0]?.ok).toBe(results.length);
    const html = await (
      await s.app.request(`${API}/agent/results`, { headers: { Accept: "text/html" } })
    ).text();
    expect(html).toContain("haiku-5.5");
  });

  test("the agent's comments outside the gate's rules are refused", async () => {
    const s = setup();
    const { state } = fakeSpike(s);
    const base = state(LIB.id);
    // A copy with its agent token, linked to the base, and a run in progress.
    const copyLib = await s.accounts.createLibrary("demo-a-x", {
      id: OWNER.id,
      handle: OWNER.handle,
    });
    state(SPIKE_INSTANCE).linkCopy(copyLib.id, LIB.id);
    const minted = await s.accounts.createToken({
      libraryId: copyLib.id,
      actor: "tempra-agent/librarian",
      scope: "read",
      prefix: null,
      expires: null,
      mcpTiers: "all",
      createdBy: OWNER.id,
    });
    const copy = {
      arm: "a" as const,
      model: "claude-haiku-5-5",
      library_id: copyLib.id,
      owner: copyLib.owner,
      slug: copyLib.slug,
      do_id: copyLib.do_id,
      token_id: minted.id,
      threads: {},
    };
    const lib = await s.deps.libraryByDoId(copyLib.do_id);
    await lib?.apply({ actor: "human:owner", request_id: "r", note: null, by: null }, [
      { op: "write", path: "a.md", content: doc("A") },
    ]);
    const mcp = agentMcp(s.deps as unknown as RunDeps, copy, OWNER.id);
    const open = () => mcp.call("comment", { action: "open", path: "a.md", body: "Hi." });
    expect((await open()).text).toContain("only during a run");
    const run = base.createRun("a", "claude-haiku-5-5", 1);
    base.startRun(run.id);
    base.beginItem(run.id, 6);
    for (let i = 0; i < MAX_NEW_THREADS; i++) expect((await open()).isError).toBe(false);
    expect((await open()).text).toContain("its limit");
    const thread = base.comments(run.id)[0]?.thread as string;
    expect((await mcp.call("comment", { action: "resolve", thread })).text).toContain(
      "never resolves",
    );
    // It cannot write content: its token is read-only (and write is not among its tools).
    expect((await mcp.call("write", { path: "b.md", content: doc("B") })).isError).toBe(true);
    expect(base.comments(run.id)).toHaveLength(MAX_NEW_THREADS);
  });
});
