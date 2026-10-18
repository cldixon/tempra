import { describe, expect, test } from "bun:test";
import { locate, type QuoteSelector, selectorAt } from "./src/anchor";
import { reconcile } from "./src/reconcile";
import { docText, quoteText } from "./src/text";
import { parseMarkdown, toMarkdown } from "./src/tree";

describe("quote anchors", () => {
  const md = "Margin is revenue minus cost.\n\nLater, margin is reported monthly. margin is";
  const doc = reconcile(null, parseMarkdown(md));
  const text = docText(doc);
  const at = text.text.indexOf("margin is reported");

  test("a selector finds its own text again, in the block it started in", () => {
    const sel = selectorAt(text, at, at + 9);
    expect(sel.block).toBe((doc.children[1] as { id?: string }).id ?? null);
    expect(sel.offset).toBe(7);
    expect(locate(text, sel)).toEqual({ from: at, to: at + 9 });
  });

  test("an agent's edit before it keeps it on its block", () => {
    const sel = selectorAt(text, at, at + 9);
    const next = reconcile(doc, parseMarkdown(`A new opening paragraph.\n\n${toMarkdown(doc)}`));
    const t = docText(next);
    expect(locate(t, sel)?.from).toBe(t.text.indexOf("margin is reported"));
  });

  test("with no context, the nearest repeat to where it was in its block", () => {
    const end = text.text.length - 9;
    const sel: QuoteSelector = { ...selectorAt(text, end, end + 9), prefix: "", suffix: "" };
    expect(locate(text, sel)?.from).toBe(end);
  });

  test("a repeated table cell is found in its own cell, not the table's first (TEMPRA-101)", () => {
    const table = "| a | b |\n| - | - |\n| x | NULLABLE |\n| y | NULLABLE |\n| z | NULLABLE |";
    const t0 = docText(reconcile(null, parseMarkdown(table)));
    const third = t0.text.lastIndexOf("NULLABLE");
    // With no context to tell the cells apart, only the hint does.
    const sel: QuoteSelector = { ...selectorAt(t0, third + 2, third + 6), prefix: "", suffix: "" };
    expect(sel.block).toBe(t0.blocks[0]?.block ?? null);
    expect(locate(t0, sel)?.from).toBe(third + 2);
    // A paragraph written above the table: its context still finds the third cell.
    const prev = reconcile(null, parseMarkdown(table));
    const t1 = docText(reconcile(prev, parseMarkdown(`Intro.\n\n${toMarkdown(prev)}`)));
    const sel1 = selectorAt(docText(prev), third + 2, third + 6);
    expect(locate(t1, sel1)?.from).toBe(t1.text.lastIndexOf("NULLABLE") + 2);
  });

  test("a quote that is gone is outdated", () => {
    const sel = selectorAt(text, 10, 28);
    expect(locate(docText(parseMarkdown("Margin is net sales less COGS.")), sel)).toBeNull();
  });

  test("an agent's markdown quote reads as the text", () => {
    expect(quoteText("**revenue** minus [cost](/c.md)")).toBe("revenue minus cost");
  });
});
