import { describe, expect, test } from "bun:test";
import { stack } from "./src/comments/layout";

describe("the comment margin's layout", () => {
  test("a thread sits beside its quote when there is room", () => {
    const tops = stack(
      [
        { id: "a", want: 0, height: 40 },
        { id: "b", want: 200, height: 40 },
      ],
      8,
    );
    expect(tops.get("a")).toBe(0);
    expect(tops.get("b")).toBe(200);
  });

  test("a thread that would overlap the one before is pushed down, in order", () => {
    const tops = stack(
      [
        { id: "a", want: 100, height: 120 },
        { id: "b", want: 110, height: 40 },
        { id: "c", want: 120, height: 40 },
        { id: "d", want: 500, height: 40 },
      ],
      10,
    );
    expect(tops.get("a")).toBe(100);
    expect(tops.get("b")).toBe(230);
    expect(tops.get("c")).toBe(280);
    expect(tops.get("d")).toBe(500);
  });
});
