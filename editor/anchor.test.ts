import { describe, expect, test } from "bun:test";
import { locate, selectorAt } from "./src/anchor";

describe("quote anchors", () => {
  const body = "Margin is revenue minus cost. Later, margin is reported monthly. margin is";

  test("a selector finds its own text again", () => {
    const from = body.indexOf("margin is reported");
    const sel = selectorAt(body, from, from + 9);
    expect(locate(body, sel)).toEqual({ from, to: from + 9 });
  });

  test("context picks the right repeat after text moves", () => {
    const from = body.indexOf("margin is reported");
    const sel = selectorAt(body, from, from + 9);
    const edited = `A new opening sentence. ${body}`;
    const found = locate(edited, sel);
    expect(found?.from).toBe(edited.indexOf("margin is reported"));
  });

  test("with no context, the nearest repeat to where it was", () => {
    const sel = { quote: "margin is", prefix: "", suffix: "", from: body.length - 9 };
    expect(locate(body, sel)?.from).toBe(body.length - 9);
  });

  test("a quote that is gone is outdated", () => {
    const sel = selectorAt(body, 10, 28);
    expect(locate("Margin is net sales less COGS.", sel)).toBeNull();
  });
});
