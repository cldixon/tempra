import Anthropic from "@anthropic-ai/sdk";
import type { LibraryRef } from "../accounts";
import { agentId, agentName, tokenAgent } from "../agents";
import type { Deps } from "../app";
import type { TokenInfo } from "../auth";
import { type LibraryClient, putBlob } from "../client";
import type { McpContext } from "../mcp/server";
import { postComment } from "../notify";
import { OkfError } from "../store/errors";
import type { ImportFile, RequestContext } from "../store/store";
import { type AgentClient, SPIKE_INSTANCE } from "./agent-client";
import { agentComment } from "./comment";
import { LocalMcp, type McpTool } from "./local-mcp";
import {
  AGENT_ACTOR,
  AGENT_TOOLS,
  type Arm,
  addUsage,
  costOf,
  EFFORT,
  GATEWAY_ID,
  MAX_ITEM_INPUT_TOKENS,
  MAX_ITEM_USD,
  MAX_OUTPUT_TOKENS,
  MAX_TURNS,
  type ModelSpec,
  modelSpec,
  NO_USAGE,
  type Usage,
} from "./models";
import { itemPrompt, SYSTEM_PROMPT } from "./prompt";
import type { Copy, ItemOutcome } from "./state";
import type { TaskItem, TaskSet } from "./tasks";

/**
 * A run of the spike (TEMPRA-67): one arm, one model, one batch of the task set, on that arm and
 * model's own copy of the base library. The Workflow (workflow.ts) calls these one step at a
 * time; they are free of Worker APIs, so bun tests drive them with fakes.
 */
export interface RunParams {
  base: LibraryRef & { ownerId: string };
  run: number;
  arm: Arm;
  model: string;
  batch: number;
}

/** The Messages API as the spike uses it: Claude through AI Gateway (Arm A). */
export type AnthropicLike = { messages: Pick<Anthropic["messages"], "create"> };

/** Workers AI as the spike uses it (Arm A's open model). */
export interface AiLike {
  run(
    model: string,
    inputs: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
}

export interface SpikeDeps {
  /** A library agent's object by name: a base library's id, or SPIKE_INSTANCE. */
  agent(name: string): AgentClient;
  /** Claude through the AI Gateway; null when the preview has no Anthropic key. */
  anthropic(): Promise<AnthropicLike | null>;
  /** The Managed Agents API (Arm B), straight to Anthropic; null without a key. */
  managedAgents(): Anthropic | null;
  /** Workers AI through the AI Gateway; null when the binding is absent. */
  ai: AiLike | null;
  /** Starts the run's Workflow; answers its instance id. */
  start(params: RunParams): Promise<string>;
  /** The Worker's public origin: Arm B's agent reaches `${origin}/mcp`. */
  origin: string;
  /** Waits between retries and polls; tests make it instant. */
  sleep?(ms: number): Promise<void>;
}

export type RunDeps = Pick<
  Deps,
  | "accounts"
  | "library"
  | "libraryByDoId"
  | "blobs"
  | "maintain"
  | "notifications"
  | "managedAgents"
> & { spike: SpikeDeps };

const sleep = (d: RunDeps, ms: number) =>
  d.spike.sleep ? d.spike.sleep(ms) : new Promise<void>((r) => setTimeout(r, ms));

const spend = (d: RunDeps) => d.spike.agent(SPIKE_INSTANCE);
const agentOf = (d: RunDeps, p: RunParams) => d.spike.agent(p.base.id);

export function spec(model: string): ModelSpec {
  const m = modelSpec(model);
  if (!m) throw new OkfError(400, "bad_model", `No model ${model} in the spike.`);
  return m;
}

// ------------------------------------------------------------------ the task set's bundle

/** Saves the base library as it is now, to import every run's copy from. Answers its hash. */
export async function saveBundle(d: Pick<RunDeps, "blobs">, lib: LibraryClient) {
  const { seq, files } = await lib.exportBundle();
  const out: ImportFile[] = files.flatMap((f): ImportFile[] =>
    f.blob
      ? [{ path: f.path, blob: f.blob }]
      : f.text !== undefined
        ? [{ path: f.path, markdown: f.text }]
        : [],
  );
  const bytes = new TextEncoder().encode(JSON.stringify(out));
  const blob = await putBlob(d.blobs, bytes, "application/json");
  return { seq, bundle: blob.hash };
}

async function loadBundle(d: Pick<RunDeps, "blobs">, hash: string): Promise<ImportFile[]> {
  const obj = await d.blobs.get(hash);
  if (!obj) throw new OkfError(500, "bundle_missing", "The task set's bundle is missing.");
  const text =
    obj.body instanceof Uint8Array
      ? new TextDecoder().decode(obj.body)
      : await new Response(obj.body).text();
  return JSON.parse(text) as ImportFile[];
}

// ------------------------------------------------------------------ copies and tokens

/** The copy's slug: the base's, the arm and the model (hidden from the grading sheet). */
export function copySlug(base: string, arm: Arm, model: string): string {
  const label = spec(model).label.replace(/[^a-z0-9]+/g, "-");
  return `${base}-${arm}-${label}`.slice(0, 63).replace(/-+$/, "");
}

function ownerToken(lib: LibraryRef, ownerId: string): TokenInfo {
  return {
    id: `spike-owner:${lib.id}`,
    actor: `human:${lib.owner}`,
    scope: "write",
    prefix: null,
    mcp_tiers: "all",
    library: lib,
    created_by: ownerId,
    role: "owner",
    person: lib.owner,
  };
}

/** The agent's token on a copy as d1Authenticate would describe it: read scope, comments only. */
export function agentToken(lib: LibraryRef, tokenId: string, ownerId: string): TokenInfo {
  return {
    id: tokenId,
    actor: AGENT_ACTOR,
    scope: "read",
    prefix: null,
    mcp_tiers: "all",
    library: lib,
    created_by: ownerId,
    role: "owner",
    person: lib.owner,
    agent: agentId(ownerId, tokenAgent(AGENT_ACTOR).platform),
  };
}

const ownerCtx = (lib: LibraryRef, ownerId: string, note: string): RequestContext => ({
  actor: `human:${lib.owner}`,
  request_id: crypto.randomUUID(),
  note,
  by: { person: ownerId },
});

const TOKEN_DAYS = 30;

async function mintAgentToken(d: RunDeps, lib: LibraryRef, ownerId: string) {
  return d.accounts.createToken({
    libraryId: lib.id,
    actor: AGENT_ACTOR,
    scope: "read",
    prefix: null,
    expires: new Date(Date.now() + TOKEN_DAYS * 86_400_000).toISOString(),
    mcpTiers: "all",
    createdBy: ownerId,
  });
}

/**
 * The arm and model's copy of the base library, made on its first run: imported from the task
 * set's bundle, maintained once (so its work queue matches), the questions posted by the owner,
 * and a read token for the agent. Safe to repeat: a retried step finds what is already there.
 */
export async function prepareCopy(d: RunDeps, p: RunParams, set: TaskSet): Promise<Copy> {
  const agent = agentOf(d, p);
  const known = await agent.copy(p.arm, p.model);
  if (known) return known;
  const owner = { id: p.base.ownerId, handle: p.base.owner };
  const slug = copySlug(p.base.slug, p.arm, p.model);
  const found = await d.accounts.library(owner.handle, slug);
  const ref: LibraryRef = found
    ? { id: found.id, slug: found.slug, do_id: found.do_id, owner: found.owner }
    : await d.accounts.createLibrary(slug, owner);
  await spend(d).linkCopy(ref.id, p.base.id);
  const lib = await d.libraryByDoId(ref.do_id);
  if (!lib) throw new OkfError(500, "copy_missing", `The copy ${slug} has no storage.`);
  if ((await lib.headSeq()) === 0) {
    const files = await loadBundle(d, set.bundle);
    await lib.import(ownerCtx(ref, owner.id, "Spike copy of the task set"), files, "spike");
    await d.maintain?.(ref.do_id);
  }
  // The questions, as the owner asks them; a retry finds the ones already posted.
  const open = await lib.comments({ status: "all", limit: 200 });
  const threads: Record<string, string> = {};
  for (const q of set.items.filter((i) => i.kind === "question")) {
    const there = open.threads.find((t) => t.path === q.path && t.comments[0]?.body === q.detail);
    if (there) {
      threads[q.n] = there.id;
      continue;
    }
    const r = await postComment(
      d,
      ownerToken(ref, owner.id),
      lib,
      ownerCtx(ref, owner.id, "Spike question"),
      { kind: "open", path: q.path, body: q.detail, anchor: q.quote ? { quote: q.quote } : null },
    );
    threads[q.n] = r.thread.id;
  }
  const copy: Copy = {
    arm: p.arm,
    model: p.model,
    library_id: ref.id,
    owner: ref.owner,
    slug: ref.slug,
    do_id: ref.do_id,
    token_id: null,
    threads,
  };
  await agent.saveCopy(copy);
  return copy;
}

const refOf = (c: Copy): LibraryRef => ({
  id: c.library_id,
  slug: c.slug,
  do_id: c.do_id,
  owner: c.owner,
});

/**
 * Gets a copy ready for a run. Arm A acts in process with the token's identity; Arm B gets a
 * fresh token each run, its secret handed straight to the Anthropic vault (never stored or
 * logged here), and the previous one revoked.
 */
export async function prepareRun(d: RunDeps, p: RunParams, set: TaskSet): Promise<Copy> {
  const copy = await prepareCopy(d, p, set);
  if (p.arm === "a" && copy.token_id) return copy;
  const minted = await mintAgentToken(d, refOf(copy), p.base.ownerId);
  if (p.arm === "b") {
    await setCredential(d, p, minted.secret);
    if (copy.token_id) await d.accounts.revokeToken(copy.token_id, p.base.ownerId).catch(() => {});
  }
  const next = { ...copy, token_id: minted.id };
  await agentOf(d, p).saveCopy(next);
  return next;
}

// ------------------------------------------------------------------ spending

/** What may still be spent on one item: the spike's remainder, at most an item's cap. */
async function itemAllowance(d: RunDeps): Promise<number> {
  return Math.min(await spend(d).remaining(), MAX_ITEM_USD);
}

async function charge(d: RunDeps, p: RunParams, item: number, u: Usage, usd: number, turns = 1) {
  await agentOf(d, p).addUsage(p.run, item, u, usd, turns);
  await spend(d).charge(`run ${p.base.id}#${p.run} item ${item}`, p.model, usd);
}

const MAX_TOOL_RESULT = 40_000;

const clipTool = (s: string) =>
  s.length > MAX_TOOL_RESULT
    ? `${s.slice(0, MAX_TOOL_RESULT)}\n[cut at ${MAX_TOOL_RESULT} characters]`
    : s;

/** The prompt for an item in a copy: which library and, for a question, its thread. */
function promptFor(copy: Copy, item: TaskItem) {
  return itemPrompt(`${copy.owner}/${copy.slug}`, item, copy.threads[item.n]);
}

// ------------------------------------------------------------------ Arm A: our own loop

/** Tempra's MCP tools for the agent on its copy, in process, through the comment gate. */
export function agentMcp(d: RunDeps, copy: Copy, ownerId: string): LocalMcp {
  if (!copy.token_id) throw new OkfError(500, "no_token", "The copy has no agent token.");
  const token = agentToken(refOf(copy), copy.token_id, ownerId);
  const ctx: McpContext = {
    actor: token.actor,
    scope: token.scope,
    tiers: token.mcp_tiers,
    libraries: [token],
    by: { person: ownerId, ...(token.agent ? { agent: token.agent } : {}) },
    open: (t) => d.library(t),
    comment: (t, req, action) => agentComment(d, t, req, action),
    agentNames: async (ids) =>
      new Map((await d.accounts.agents(ids)).map((a) => [a.id, agentName(a)])),
    blobs: d.blobs,
    origin: d.spike.origin,
  };
  return new LocalMcp(ctx);
}

/** Whether a failed model call is worth another try: rate limits, overload, 5xx, the network. */
function retryable(e: unknown): boolean {
  if (e instanceof Anthropic.APIConnectionError) return true;
  if (e instanceof Anthropic.APIError) return e.status === 429 || (e.status ?? 0) >= 500;
  const msg = e instanceof Error ? e.message : String(e);
  return /\b(429|5\d\d)\b|rate|overload|timeout|capacity/i.test(msg);
}

const MAX_ATTEMPTS = 3;

/** Runs one item in our own loop on the arm's model; never throws for a model's failure. */
export async function runItemA(
  d: RunDeps,
  p: RunParams,
  copy: Copy,
  item: TaskItem,
): Promise<ItemOutcome> {
  const started = Date.now();
  const model = spec(p.model);
  const mcp = agentMcp(d, copy, p.base.ownerId);
  const tools = await mcp.tools();
  const prompt = promptFor(copy, item);
  const tally = { retries: 0, failures: 0, turns: 0, usage: NO_USAGE, cost: 0 };
  const done = (o: Partial<ItemOutcome> & Pick<ItemOutcome, "status">): ItemOutcome => ({
    retries: tally.retries,
    failures: tally.failures,
    latency_ms: Date.now() - started,
    ...o,
  });
  /** Calls the model with retries; records what each call spent as it is spent. */
  const call = async <T>(once: () => Promise<{ value: T; usage: Usage }>): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      const left = await itemAllowance(d);
      if (tally.cost >= left)
        throw new OkfError(402, "item_cap", "The item reached its spend cap.");
      const inputSoFar = tally.usage.input + tally.usage.cacheRead + tally.usage.cacheWrite;
      if (inputSoFar >= MAX_ITEM_INPUT_TOKENS) {
        throw new OkfError(402, "item_tokens", "The item reached its input-token cap.");
      }
      try {
        const r = await once();
        const usd = costOf(model, r.usage);
        tally.usage = addUsage(tally.usage, r.usage);
        tally.cost += usd;
        tally.turns++;
        await charge(d, p, item.n, r.usage, usd);
        return r.value;
      } catch (e) {
        tally.failures++;
        if (attempt >= MAX_ATTEMPTS || !retryable(e)) throw e;
        tally.retries++;
        await sleep(d, 2000 * 2 ** (attempt - 1));
      }
    }
  };
  try {
    const final =
      model.provider === "anthropic"
        ? await claudeLoop(d, model, tools, mcp, prompt, call)
        : await workersAiLoop(d, model, tools, mcp, prompt, call);
    return done({ status: "ok", final });
  } catch (e) {
    if (e instanceof OkfError && e.code === "spend_cap") throw e;
    const error = e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e);
    return done({ status: "failed", error: error.slice(0, 500) });
  }
}

type Call = <T>(once: () => Promise<{ value: T; usage: Usage }>) => Promise<T>;

async function claudeLoop(
  d: RunDeps,
  model: ModelSpec,
  mcpTools: McpTool[],
  mcp: LocalMcp,
  prompt: string,
  call: Call,
): Promise<string> {
  const client = await d.spike.anthropic();
  if (!client) throw new OkfError(503, "no_key", "No Anthropic key on this preview.");
  // Tools then system render first: one breakpoint on the system prompt caches both, and the
  // request-level breakpoint caches the item's conversation as it grows.
  const tools: Anthropic.Tool[] = mcpTools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await call(async () => {
      const r = await client.messages.create({
        model: model.id,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools,
        messages,
        output_config: { effort: EFFORT },
        cache_control: { type: "ephemeral" },
      });
      const u = r.usage;
      return {
        value: r,
        usage: {
          input: u.input_tokens,
          output: u.output_tokens,
          cacheRead: u.cache_read_input_tokens ?? 0,
          cacheWrite: u.cache_creation_input_tokens ?? 0,
        },
      };
    });
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason === "refusal") {
      // Recorded as a failure with its category, to judge whether fallbacks matter here.
      const category = res.stop_details?.category ?? "none";
      throw new OkfError(422, "refusal", `The model refused (stop_details.category: ${category}).`);
    }
    if (res.stop_reason !== "tool_use") {
      return res.content
        .flatMap((b) => (b.type === "text" ? [b.text] : []))
        .join("\n")
        .trim();
    }
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const b of res.content) {
      if (b.type !== "tool_use") continue;
      const out = await mcp.call(b.name, b.input);
      results.push({
        type: "tool_result",
        tool_use_id: b.id,
        content: clipTool(out.text),
        ...(out.isError ? { is_error: true } : {}),
      });
    }
    messages.push({ role: "user", content: results });
  }
  throw new OkfError(422, "max_turns", `The item took more than ${MAX_TURNS} turns.`);
}

/** A Workers AI chat completion, in either response shape the catalog's models answer with. */
export interface AiTurn {
  text: string;
  calls: { id: string; name: string; args: unknown }[];
  usage: Usage;
  raw: Record<string, unknown> | null;
}

function parseArgs(a: unknown): unknown {
  if (typeof a !== "string") return a ?? {};
  try {
    return JSON.parse(a);
  } catch {
    return {};
  }
}

export function readAiTurn(res: unknown): AiTurn {
  const r = (res ?? {}) as Record<string, unknown>;
  const usage = (r.usage ?? {}) as {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const u: Usage = {
    input: Math.max((usage.prompt_tokens ?? 0) - cached, 0),
    output: usage.completion_tokens ?? 0,
    cacheRead: cached,
    cacheWrite: 0,
  };
  const choices = r.choices as { message?: Record<string, unknown> }[] | undefined;
  if (Array.isArray(choices)) {
    const m = choices[0]?.message ?? {};
    const calls = (
      (m.tool_calls ?? []) as {
        id?: string;
        function?: { name?: string; arguments?: unknown };
      }[]
    ).map((c, i) => ({
      id: c.id ?? `call_${i}`,
      name: c.function?.name ?? "",
      args: parseArgs(c.function?.arguments),
    }));
    return { text: typeof m.content === "string" ? m.content : "", calls, usage: u, raw: m };
  }
  const calls = ((r.tool_calls ?? []) as { id?: string; name?: string; arguments?: unknown }[]).map(
    (c, i) => ({ id: c.id ?? `call_${i}`, name: c.name ?? "", args: parseArgs(c.arguments) }),
  );
  return { text: typeof r.response === "string" ? r.response : "", calls, usage: u, raw: null };
}

async function workersAiLoop(
  d: RunDeps,
  model: ModelSpec,
  mcpTools: McpTool[],
  mcp: LocalMcp,
  prompt: string,
  call: Call,
): Promise<string> {
  const ai = d.spike.ai;
  if (!ai) throw new OkfError(503, "no_ai", "No Workers AI binding on this preview.");
  const tools = mcpTools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
  const messages: Record<string, unknown>[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await call(async () => {
      const raw = await ai.run(
        model.id,
        { messages, tools, max_tokens: MAX_OUTPUT_TOKENS, reasoning_effort: "high" },
        { gateway: { id: GATEWAY_ID } },
      );
      const t = readAiTurn(raw);
      return { value: t, usage: t.usage };
    });
    if (res.calls.length === 0) return res.text.trim();
    messages.push({
      role: "assistant",
      content: res.text,
      tool_calls: res.calls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: JSON.stringify(c.args) },
      })),
    });
    for (const c of res.calls) {
      const out = await mcp.call(c.name, c.args);
      messages.push({ role: "tool", tool_call_id: c.id, content: clipTool(out.text) });
    }
  }
  throw new OkfError(422, "max_turns", `The item took more than ${MAX_TURNS} turns.`);
}

// ------------------------------------------------------------------ Arm B: Claude Managed Agents

function cmaClient(d: RunDeps): Anthropic {
  const c = d.spike.managedAgents();
  if (!c) throw new OkfError(503, "no_key", "No Anthropic key on this preview.");
  return c;
}

/**
 * The Managed Agents resources, made once per base library and reused: a cloud environment that
 * may reach MCP servers and nothing else, a vault for the agent's token, and the agent itself
 * (the shared system prompt, Tempra's MCP server with only the commenting tools, no sandbox
 * tools). Each run's sessions pick the model with an override.
 */
export async function ensureManagedAgent(
  d: RunDeps,
  p: RunParams,
): Promise<Record<string, string>> {
  const agent = agentOf(d, p);
  const client = cmaClient(d);
  let ids = await agent.cma();
  const host = new URL(d.spike.origin).host;
  if (!ids.environment) {
    const env = await client.beta.environments.create({
      name: `tempra-spike-${host}-${p.base.id}`.slice(0, 120),
      config: {
        type: "cloud",
        networking: { type: "limited", allow_mcp_servers: true, allow_package_managers: false },
      },
    });
    await agent.setCma({ environment: env.id });
  }
  ids = await agent.cma();
  if (!ids.vault) {
    const vault = await client.beta.vaults.create({ display_name: `Tempra spike ${host}` });
    await agent.setCma({ vault: vault.id });
  }
  ids = await agent.cma();
  if (!ids.agent) {
    const created = await client.beta.agents.create({
      name: `Tempra librarian (spike, ${host})`,
      model: { id: "claude-sonnet-5-5", effort: EFFORT },
      system: SYSTEM_PROMPT,
      mcp_servers: [{ type: "url", name: "tempra", url: `${d.spike.origin}/mcp` }],
      tools: [
        {
          type: "mcp_toolset",
          mcp_server_name: "tempra",
          default_config: { enabled: false, permission_policy: { type: "always_allow" } },
          configs: AGENT_TOOLS.map((name) => ({
            name,
            enabled: true,
            permission_policy: { type: "always_allow" as const },
          })),
        },
      ],
    });
    await agent.setCma({ agent: created.id, agent_version: String(created.version) });
  }
  return agent.cma();
}

/** Puts the run's token in the vault as the MCP server's bearer credential. */
async function setCredential(d: RunDeps, p: RunParams, secret: string) {
  const ids = await ensureManagedAgent(d, p);
  const client = cmaClient(d);
  if (ids.credential) {
    await client.beta.vaults.credentials.update(ids.credential, {
      vault_id: ids.vault as string,
      auth: { type: "static_bearer", token: secret },
    });
    return;
  }
  const cred = await client.beta.vaults.credentials.create(ids.vault as string, {
    display_name: "Tempra MCP (spike agent token)",
    auth: { type: "static_bearer", mcp_server_url: `${d.spike.origin}/mcp`, token: secret },
  });
  await agentOf(d, p).setCma({ credential: cred.id });
}

/** Starts the item's session: the agent at the run's model, capped at the item's allowance. */
export async function startItemB(
  d: RunDeps,
  p: RunParams,
  copy: Copy,
  item: TaskItem,
): Promise<string> {
  const ids = await ensureManagedAgent(d, p);
  const cents = Math.max(1, Math.floor((await itemAllowance(d)) * 100));
  const s = await cmaClient(d).beta.sessions.create({
    agent: {
      type: "agent_with_overrides",
      id: ids.agent as string,
      model: { id: spec(p.model).id, effort: EFFORT },
    },
    environment_id: ids.environment as string,
    vault_ids: [ids.vault as string],
    budget: { type: "limit", max_list_cost: { amount: String(cents), currency: "USD" } },
    title: `Spike run ${p.run}, item ${item.n}`,
    metadata: { run: String(p.run), item: String(item.n), base: p.base.id },
    initial_events: [
      { type: "user.message", content: [{ type: "text", text: promptFor(copy, item) }] },
    ],
  });
  return s.id;
}

/** Waits up to `ms` for the session to stop working; true once it has. */
export async function waitItemB(d: RunDeps, session: string, ms: number): Promise<boolean> {
  const client = cmaClient(d);
  const until = Date.now() + ms;
  for (;;) {
    const s = await client.beta.sessions.retrieve(session);
    if (s.status === "idle" || s.status === "terminated") return true;
    if (Date.now() >= until) return false;
    await sleep(d, 3000);
  }
}

/** Reads what the session did and spent, records it, and archives the session. */
export async function finishItemB(
  d: RunDeps,
  p: RunParams,
  item: TaskItem,
  session: string,
  startedAt: number,
  timedOut = false,
): Promise<ItemOutcome> {
  const client = cmaClient(d);
  if (timedOut)
    await client.beta.sessions.events
      .send(session, { events: [{ type: "user.interrupt" }] })
      .catch(() => {});
  const s = await client.beta.sessions.retrieve(session);
  let failures = 0;
  let retries = 0;
  let turns = 0;
  let final = "";
  let stop = "";
  let n = 0;
  for await (const e of client.beta.sessions.events.list(session, { limit: 100 })) {
    if (++n > 1000) break;
    const ev = e as unknown as {
      type: string;
      content?: { type: string; text?: string }[];
      stop_reason?: { type?: string };
    };
    if (ev.type === "session.error") failures++;
    else if (ev.type === "session.status_rescheduled") retries++;
    else if (ev.type === "span.model_request_end") turns++;
    else if (ev.type === "agent.message") {
      final = (ev.content ?? [])
        .flatMap((b) => (b.type === "text" ? [b.text ?? ""] : []))
        .join("\n");
    } else if (ev.type === "session.status_idle") stop = ev.stop_reason?.type ?? stop;
  }
  const u = s.usage ?? {};
  const usage: Usage = {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite:
      (u.cache_creation?.ephemeral_5m_input_tokens ?? 0) +
      (u.cache_creation?.ephemeral_1h_input_tokens ?? 0),
  };
  // List cost as the platform priced it (model tokens and session runtime), in cents.
  const usd = Number(u.list_cost?.amount ?? 0) / 100 || costOf(spec(p.model), usage);
  await charge(d, p, item.n, usage, usd, turns);
  await client.beta.sessions.archive(session).catch(() => {});
  const failed = timedOut || s.status === "terminated" || stop === "budget_reached";
  return {
    status: failed ? "failed" : "ok",
    retries,
    failures,
    latency_ms: Date.now() - startedAt,
    session,
    final: final.trim(),
    error: timedOut
      ? "timed out"
      : failed
        ? `session ${s.status}${stop ? ` (${stop})` : ""}`
        : null,
  };
}
