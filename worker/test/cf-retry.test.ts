import { describe, expect, test } from "bun:test";
import { retryDelayMs, transientCfError } from "../scripts/cf-retry";

describe("cf retries (TEMPRA-52)", () => {
  test("the PR 48 teardown error, and other passing failures, are transient", () => {
    // What `cf r2 buckets list` printed when the PR 48 preview teardown stopped.
    expect(transientCfError("┌ Error\n│ An unexpected error occurred\n│\n│ timeout\n└\n")).toBe(
      true,
    );
    for (const out of [
      "request to https://api.cloudflare.com/client/v4/accounts failed, reason: ETIMEDOUT",
      "Error: read ECONNRESET",
      "fetch failed",
      "socket hang up",
      "getaddrinfo EAI_AGAIN api.cloudflare.com",
      "API returned 503 Service Unavailable",
      "502 Bad Gateway",
      "429 Too Many Requests",
      "The operation timed out",
    ]) {
      expect([out, transientCfError(out)]).toEqual([out, true]);
    }
  });

  test("a call that was itself wrong is not retried", () => {
    for (const out of [
      "Authentication error [code: 10000]",
      "403 Forbidden",
      "The database tempra-accounts-pr-48 does not exist",
      "bucket not found",
      "Unknown argument: --frobnicate",
      "A bucket with that name already exists",
      "404 Not Found, after a timeout",
      "",
    ]) {
      expect([out, transientCfError(out)]).toEqual([out, false]);
    }
  });

  test("waits grow and stay bounded", () => {
    expect([1, 2, 3, 9].map(retryDelayMs)).toEqual([2000, 4000, 8000, 8000]);
  });
});
