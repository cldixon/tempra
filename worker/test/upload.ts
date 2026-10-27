/**
 * A file put in as an agent with a shell puts one in (TEMPRA-203: there is no base64): MCP
 * `prepare_upload` with the attachment's facts, then a PUT of the bytes to its `/ul/` URL.
 */
import { expect } from "bun:test";

type Call = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ text: string; isError: boolean }>;

type App = { request(url: string, init?: RequestInit): Response | Promise<Response> };

/** The PUT's answer: the write result as JSON, or the refusal's `{code, message}`. */
export interface Uploaded {
  status: number;
  ok: boolean;
  body: { code?: string; message?: string; hash?: string; path?: string; lint?: unknown[] };
  /** The body as text, for matching a refusal's code as a tool result's text would be. */
  text: string;
}

export async function attachFile(
  app: App,
  call: Call,
  path: string,
  bytes: Uint8Array,
  facts: Record<string, unknown> = {},
): Promise<Uploaded> {
  const r = await call("prepare_upload", { path, ...facts });
  expect(r.isError).toBe(false);
  const url = /'(http\S+\/ul\/\S+)'$/m.exec(r.text)?.[1] ?? "";
  const put = await app.request(url, { method: "PUT", body: bytes });
  const text = await put.text();
  let body: Uploaded["body"] = {};
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: put.status, ok: put.status >= 200 && put.status < 300, body, text };
}
