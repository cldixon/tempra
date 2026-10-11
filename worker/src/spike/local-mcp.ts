import { handleMcp, type McpContext } from "../mcp/server";
import { OkfError } from "../store/errors";
import { AGENT_TOOLS } from "./models";

/**
 * Tempra's own MCP server, called in process (Arm A): the same tools, descriptions and results an
 * agent gets over /mcp (Arm B), without a network hop. Only the commenting agent's tools are
 * listed or callable.
 */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolOutcome {
  text: string;
  isError: boolean;
}

const ALLOWED = new Set<string>(AGENT_TOOLS);

export class LocalMcp {
  private id = 0;

  constructor(private readonly ctx: McpContext) {}

  private async rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const req = new Request("https://tempra.local/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
    });
    const res = await handleMcp(req, this.ctx);
    const body = (await res.json().catch(() => null)) as {
      result?: T;
      error?: { code: number; message: string };
    } | null;
    if (!body || body.error || body.result === undefined) {
      throw new OkfError(
        502,
        "mcp_failed",
        `MCP ${method} failed: ${body?.error?.message ?? `HTTP ${res.status}`}`,
      );
    }
    return body.result;
  }

  /** The agent's tools, in AGENT_TOOLS order so the cached prefix never moves. */
  async tools(): Promise<McpTool[]> {
    const r = await this.rpc<{ tools: McpTool[] }>("tools/list", {});
    const byName = new Map(r.tools.map((t) => [t.name, t]));
    return AGENT_TOOLS.flatMap((n) => {
      const t = byName.get(n);
      return t
        ? [{ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema }]
        : [];
    });
  }

  async call(name: string, args: unknown): Promise<ToolOutcome> {
    if (!ALLOWED.has(name)) return { text: `No tool named ${name}.`, isError: true };
    const r = await this.rpc<{ content?: { type: string; text?: string }[]; isError?: boolean }>(
      "tools/call",
      { name, arguments: args && typeof args === "object" ? args : {} },
    );
    const text = (r.content ?? [])
      .map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type}]`))
      .join("\n");
    return { text, isError: !!r.isError };
  }
}
