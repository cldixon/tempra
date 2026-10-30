/**
 * Scripted agents (no model behind them): MCP clients that drive a library exactly as an agent
 * would, each with its own token and actor, every call timed; and a feed watcher that records
 * when each write reaches a connected client. Scenarios (scenarios.ts) use these to test the
 * app with several agents at once, and to measure it.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface AgentSpec {
  /** The bearer token; its actor is the agent's identity in the ledger. */
  token: string;
  /** A label for logs, e.g. "agent-1". */
  name: string;
}

export interface CallResult {
  ok: boolean;
  text: string;
  ms: number;
  /** For writes: the ledger sequence and hash the result names. */
  seq: number | null;
  hash: string | null;
  /** Refused by a rate limit (HTTP 429) rather than by the tool. */
  limited: boolean;
  /** When the attempt that answered began (performance.now()), after any rate-limit waits. */
  startedAt: number;
}

/** One timed MCP call, for the report. */
export interface CallRecord {
  agent: string;
  tool: string;
  ok: boolean;
  ms: number;
  /** When the call returned (ms since the run started). */
  at: number;
  seq: number | null;
  limited: boolean;
}

/** An MCP client acting as one agent, on one library. */
export class Agent {
  private client: Client | null = null;

  constructor(
    readonly spec: AgentSpec,
    private url: string,
    private library: string,
    private record: (r: CallRecord) => void,
    private started: number,
    /** On a rate limit, wait and retry (as a well-behaved agent would) instead of failing. */
    private patient = false,
  ) {}

  get name() {
    return this.spec.name;
  }

  async connect() {
    const transport = new StreamableHTTPClientTransport(new URL("/mcp", this.url), {
      requestInit: { headers: { Authorization: `Bearer ${this.spec.token}` } },
    });
    this.client = new Client({ name: `tempra-agents/${this.spec.name}`, version: "1.0.0" });
    await this.client.connect(transport);
  }

  async close() {
    await this.client?.close();
  }

  /**
   * Calls a tool; never throws for a tool error, which comes back as `ok: false`, nor for a
   * rate limit (`limited`). A patient agent waits out a rate limit (5 s, doubling to 60 s) and
   * tries again; each refused attempt is still recorded.
   */
  async call(tool: string, args: Record<string, unknown> = {}): Promise<CallResult> {
    let wait = 5000;
    for (;;) {
      const r = await this.attempt(tool, args);
      if (!r.limited || !this.patient || wait > 60_000) return r;
      await sleep(wait);
      wait *= 2;
    }
  }

  private async attempt(tool: string, args: Record<string, unknown>): Promise<CallResult> {
    if (!this.client) throw new Error(`${this.name} is not connected`);
    const t0 = performance.now();
    let result: CallResult;
    try {
      const r = await this.client.callTool({
        name: tool,
        arguments: { library: this.library, ...args },
      });
      const text = (r.content as { text?: string }[]).map((c) => c.text ?? "").join("\n");
      const seq = Number(/seq (\d+)/.exec(text)?.[1] ?? Number.NaN);
      result = {
        ok: !r.isError,
        text,
        ms: performance.now() - t0,
        seq: Number.isFinite(seq) ? seq : null,
        hash: /hash:? ([0-9a-f]{64})/.exec(text)?.[1] ?? null,
        limited: false,
        startedAt: t0,
      };
    } catch (e) {
      // HTTP errors (a rate limit above all) come back from the transport as exceptions.
      const code = (e as { code?: unknown }).code;
      if (code !== 429) throw e;
      result = {
        ok: false,
        text: String(e),
        ms: performance.now() - t0,
        seq: null,
        hash: null,
        limited: true,
        startedAt: t0,
      };
    }
    const { ms } = result;
    this.record({
      agent: this.name,
      tool,
      ok: result.ok,
      ms,
      at: performance.now() - this.started,
      seq: result.seq,
      limited: result.limited,
    });
    return result;
  }

  /** The current hash of a file, from `read`. */
  async hashOf(path: string): Promise<string> {
    const r = await this.call("read", { path });
    const hash = /hash: ([0-9a-f]{64})/.exec(r.text)?.[1];
    if (!r.ok || !hash)
      throw new Error(`${this.name} could not read ${path}: ${r.text.slice(0, 200)}`);
    return hash;
  }
}

/**
 * A client on the library's change feed (GET …/feed): when each event arrived. With it, a
 * write's delivery time is "event received" minus "write returned".
 */
export class FeedWatch {
  private socket: WebSocket | null = null;
  /** Arrival time (performance.now()) by ledger sequence. */
  readonly arrived = new Map<number, number>();
  private waiters: { seq: number; resolve: () => void }[] = [];

  constructor(
    private url: string,
    private owner: string,
    private slug: string,
    private token: string,
  ) {}

  open(): Promise<void> {
    const url = new URL(`/api/v1/libraries/${this.owner}/${this.slug}/feed`, this.url);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    // Bun's WebSocket takes headers, so the watcher authenticates like an agent.
    const ws = new WebSocket(url.toString(), {
      headers: { Authorization: `Bearer ${this.token}` },
    } as unknown as string[]);
    this.socket = ws;
    return new Promise((resolve, reject) => {
      ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data)) as
          | { type: "hello"; head: number }
          | { type: "events"; events: { seq: number }[] }
          | { type: "presence" };
        if (m.type === "hello") return resolve();
        // Agents' presence (TEMPRA-219) carries no events.
        if (m.type !== "events") return;
        const now = performance.now();
        for (const ev of m.events) if (!this.arrived.has(ev.seq)) this.arrived.set(ev.seq, now);
        this.waiters = this.waiters.filter((w) => {
          if (!this.arrived.has(w.seq)) return true;
          w.resolve();
          return false;
        });
      };
      ws.onerror = () => reject(new Error("the feed did not open"));
    });
  }

  /** Resolves when the event with this sequence has arrived, or after `ms`. */
  waitFor(seq: number, ms = 5000): Promise<boolean> {
    if (this.arrived.has(seq)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      this.waiters.push({
        seq,
        resolve: () => {
          clearTimeout(timer);
          resolve(true);
        },
      });
    });
  }

  close() {
    this.socket?.close(1000, "done");
  }
}

/** Percentiles of a list of milliseconds. */
export function summarize(values: number[]) {
  const v = [...values].sort((a, b) => a - b);
  const at = (p: number) => v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))] ?? 0;
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    n: v.length,
    p50: round(at(50)),
    p95: round(at(95)),
    max: round(v[v.length - 1] ?? 0),
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
