import { afterAll, describe, expect, test } from "bun:test";
import { createServer, type Socket } from "node:net";
import { isLoopback, localFetch } from "../scripts/local-fetch";

// A bare HTTP/1.1 server that keeps connections alive and counts them.
let connections = 0;
const sockets = new Set<Socket>();
const server = createServer((socket) => {
  connections++;
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  socket.on("error", () => {});
  let buf = "";
  socket.on("data", (d) => {
    buf += d.toString("latin1");
    while (buf.includes("\r\n\r\n")) {
      buf = buf.slice(buf.indexOf("\r\n\r\n") + 4);
      socket.write("HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok");
    }
  });
});
const port = await new Promise<number>((resolve) =>
  server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)),
);
afterAll(() => {
  for (const s of sockets) s.destroy();
  server.close();
});

async function connectionsFor(f: typeof localFetch): Promise<number> {
  const before = connections;
  for (let i = 0; i < 3; i++)
    expect(await (await f(`http://127.0.0.1:${port}/`)).text()).toBe("ok");
  return connections - before;
}

describe("localFetch (TEMPRA-186)", () => {
  test("knows a loopback address", () => {
    expect(isLoopback("http://127.0.0.1:8799/mcp")).toBe(true);
    expect(isLoopback(new URL("http://localhost:8787/healthz"))).toBe(true);
    expect(isLoopback(new Request("http://[::1]:8787/"))).toBe(true);
    expect(isLoopback("https://pr-12.tempra.dev/mcp")).toBe(false);
    expect(isLoopback("not a url")).toBe(false);
  });

  test("never sends on a pooled connection to cf dev", async () => {
    expect(await connectionsFor(localFetch)).toBe(3);
  });

  test("plain fetch would have reused one", async () => {
    expect(await connectionsFor(fetch)).toBe(1);
  });
});
