import { describe, expect, test } from "bun:test";
import { callLine, rpcLine, SLOW_MS, worthLogging } from "../src/timing";

/* Where a Library DO call's time goes (TEMPRA-190): which calls are logged, and what a line says. */

describe("the Library DO's timing lines", () => {
  test("the first call after a start, and any slow call", () => {
    expect(worthLogging(true, 3)).toBe(true);
    expect(worthLogging(false, SLOW_MS)).toBe(false);
    expect(worthLogging(false, SLOW_MS + 1)).toBe(true);
  });

  test("the object's line: the steps, and the library's size", () => {
    const line = callLine(
      {
        library: "lib-1",
        method: "page",
        cold: true,
        sinceStartMs: 0,
        alarmMs: 40,
        callMs: 12,
        totalMs: 52,
      },
      { files: 210, dbBytes: 4_194_304 },
    );
    expect(JSON.parse(line)).toEqual({
      do_call: "page",
      library: "lib-1",
      cold: true,
      since_start_ms: 0,
      alarm_ms: 40,
      call_ms: 12,
      total_ms: 52,
      files: 210,
      db_bytes: 4_194_304,
    });
  });

  test("the Worker's line only for a slow round trip", () => {
    expect(rpcLine("page", "lib-1", SLOW_MS)).toBeNull();
    expect(JSON.parse(rpcLine("page", "lib-1", 900) ?? "")).toEqual({
      do_rpc: "page",
      library: "lib-1",
      ms: 900,
    });
  });
});
