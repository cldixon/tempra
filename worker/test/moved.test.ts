import { describe, expect, mock, test } from "bun:test";

mock.module("cloudflare:workers", () => ({ DurableObject: class {} }));
const { default: moved } = await import("../src/moved");

describe("the former Worker after the move (v2 spec: Move to tempra.dev)", () => {
  test("every request goes to the same path on the new host", () => {
    const res = moved.fetch(new Request("https://old.example/app/sign-in?next=%2Fapp"), {
      MOVED_TO: "https://app.tempra.dev",
    });
    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("https://app.tempra.dev/app/sign-in?next=%2Fapp");
  });
});
