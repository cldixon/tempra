import type {
  BetaContentBlock,
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { MODEL } from "./agent";
import type { ModelClient } from "./turn";

/**
 * A stand-in for Claude (TEMPRA-222), for local dev and the gate only (`AGENT_MODEL=fake` with
 * `DEV_SIGNIN=1` in worker/.dev.vars): no network, a fixed script over the real tools. It reads
 * the thread's page (or browses the root, on a library thread), then replies once: a request when the ask
 * says "request", "new page" or "rewrite", otherwise an answer naming what it read; then it ends.
 * Each call waits `delayMs`, so "Tempra is replying…" shows.
 */
export function fakeModel(delayMs = 1200): ModelClient {
  return {
    async create(params: MessageCreateParamsNonStreaming): Promise<BetaMessage> {
      await new Promise((r) => setTimeout(r, delayMs));
      const first = params.messages[0];
      const prompt = typeof first?.content === "string" ? first.content : "";
      const thread = /The thread: ([0-9a-f-]{36})/.exec(prompt)?.[1] ?? "";
      const path = /<page path="([^"]+)">/.exec(prompt)?.[1] ?? null;
      const ask = /\[the comment to answer\]>\n([\s\S]*?)\n<\/comment>/.exec(prompt)?.[1] ?? "";
      const step = params.messages.filter((m) => m.role === "assistant").length;
      const use = (name: string, input: Record<string, unknown>): BetaContentBlock =>
        ({ type: "tool_use", id: `toolu_fake_${step}`, name, input }) as BetaContentBlock;
      let content: BetaContentBlock[];
      let stop: BetaMessage["stop_reason"] = "tool_use";
      if (step === 0) {
        content = [path ? use("read", { path }) : use("browse", {})];
      } else if (step === 1) {
        const request = /\brequest\b|new page|rewrite/i.test(ask);
        content = [
          use("comment", {
            action: "reply",
            thread,
            body: request
              ? "That is more than a quick answer, so I have marked this thread a request for your agents."
              : `A stand-in answer (no model in local dev): I read ${path ?? "the library's start page"}.`,
            ...(request ? { kind: "request" } : {}),
          }),
        ];
      } else {
        content = [{ type: "text", text: "Done.", citations: null } as BetaContentBlock];
        stop = "end_turn";
      }
      return {
        id: `msg_fake_${step}`,
        type: "message",
        role: "assistant",
        model: MODEL,
        content,
        stop_reason: stop,
        stop_sequence: null,
        usage: { input_tokens: 1000, output_tokens: 60 },
      } as unknown as BetaMessage;
    },
  };
}
