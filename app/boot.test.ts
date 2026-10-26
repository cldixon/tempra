import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { api } from "./src/api";
import { bootKey, readBoot, takeBoot } from "./src/boot";

/** A document whose shell carries `data` as the boot block, as the Worker writes it. */
function shell(data: Record<string, unknown>) {
  const window = new Window();
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  window.document.body.innerHTML = `<script type="application/json" id="tempra-boot">${json}</script><div id="root"></div>`;
  return window.document as unknown as Document;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("the first page's data from the shell (TEMPRA-175)", () => {
  test("keys match the Worker's: the path and the query sorted by name", () => {
    // worker/test/boot.test.ts holds the Worker's bootKey to the same cases.
    expect(bootKey("/api/v1/x?b=2&a=1")).toBe("/api/v1/x?a=1&b=2");
    expect(bootKey("/api/v1/x")).toBe("/api/v1/x");
    expect(bootKey("http://localhost/api/v1/x?path=a%2Fb.md")).toBe("/api/v1/x?path=a%2Fb.md");
  });

  test("each answer is taken once, by however its query was built; the block leaves the page", () => {
    const doc = shell({ "/api/v1/x?a=1&b=2": { n: 1, s: "</script>" } });
    readBoot(doc, 60_000);
    expect(doc.getElementById("tempra-boot")).toBeNull();
    expect(takeBoot("/api/v1/x?b=2&a=1")).toEqual({ data: { n: 1, s: "</script>" } });
    expect(takeBoot("/api/v1/x?a=1&b=2")).toBeNull();
    expect(takeBoot("/api/v1/other")).toBeNull();
  });

  test("what the page does not ask for soon after loading is dropped", async () => {
    readBoot(shell({ "/api/v1/late": 1 }), 10);
    await new Promise((r) => setTimeout(r, 30));
    expect(takeBoot("/api/v1/late")).toBeNull();
  });

  test("api() answers a GET from it without the network, once; a write always goes out", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return new Response(JSON.stringify({ from: "network" }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    readBoot(shell({ "/api/v1/me": { from: "shell" }, "/api/v1/post": { from: "shell" } }), 60_000);
    expect(await api<unknown>("/api/v1/me")).toEqual({ from: "shell" });
    expect(calls).toEqual([]);
    expect(await api<unknown>("/api/v1/me")).toEqual({ from: "network" });
    expect(await api<unknown>("/api/v1/post", { method: "POST", body: "{}" })).toEqual({
      from: "network",
    });
    expect(calls).toEqual(["GET /api/v1/me", "POST /api/v1/post"]);
  });
});
