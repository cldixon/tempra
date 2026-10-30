/**
 * The comment boxes' keys (TEMPRA-223): Enter sends, Shift+Enter is a new line, an input method's
 * Enter is its own, an empty box sends nothing, and while the @ list is open Enter takes the name.
 */
import { describe, expect, test } from "bun:test";
import { flushSync } from "svelte";
import { composing, sendsComment } from "./src/mentions";
import CommentBoxFixture from "./test/CommentBoxFixture.svelte";
import { draw } from "./test/dom";

const key = (init: KeyboardEventInit & { keyCode?: number }) => {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  if (init.keyCode !== undefined) Object.defineProperty(e, "keyCode", { value: init.keyCode });
  return e;
};

/** A box as a comment form draws it, with what it sent. */
function box() {
  const sent: string[] = [];
  const passed: string[] = [];
  const drawn = draw(CommentBoxFixture, { sent, passed });
  const area = drawn.host.querySelector("textarea") as HTMLTextAreaElement;
  const value = () => drawn.host.querySelector("output")?.textContent ?? "";
  /** Types text as a person does: the value, the caret at its end, then input. */
  const type = (text: string) => {
    area.value = text;
    area.setSelectionRange(text.length, text.length);
    area.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
  };
  const press = (init: KeyboardEventInit & { keyCode?: number }) => {
    const e = key(init);
    area.dispatchEvent(e);
    flushSync();
    return e;
  };
  return { area, sent, passed, type, press, value, destroy: drawn.destroy };
}

describe("which keys send a comment", () => {
  test("Enter, Ctrl+Enter and Cmd+Enter send; Shift+Enter and an IME's Enter do not", () => {
    const k = (init: Partial<KeyboardEvent>) =>
      ({
        key: "Enter",
        shiftKey: false,
        isComposing: false,
        keyCode: 13,
        ...init,
      }) as KeyboardEvent;
    expect(sendsComment(k({}))).toBe(true);
    expect(sendsComment(k({ ctrlKey: true }))).toBe(true);
    expect(sendsComment(k({ metaKey: true }))).toBe(true);
    expect(sendsComment(k({ shiftKey: true }))).toBe(false);
    expect(sendsComment(k({ isComposing: true }))).toBe(false);
    expect(sendsComment(k({ keyCode: 229 }))).toBe(false);
    expect(sendsComment(k({ key: "a" }))).toBe(false);
    expect(composing(k({ keyCode: 229 }))).toBe(true);
  });
});

describe("a comment box", () => {
  test("Enter sends what is written, and the key goes no further", () => {
    const b = box();
    b.type("Looks right to me");
    const e = b.press({ key: "Enter" });
    expect(e.defaultPrevented).toBe(true);
    expect(b.sent).toEqual(["Looks right to me"]);
    expect(b.passed).toEqual([]);
    b.destroy();
  });

  test("Shift+Enter is a new line: nothing is sent and the key is the textarea's", () => {
    const b = box();
    b.type("First line");
    const e = b.press({ key: "Enter", shiftKey: true });
    expect(e.defaultPrevented).toBe(false);
    expect(b.sent).toEqual([]);
    b.destroy();
  });

  test("an input method's Enter, mid-composition, sends nothing", () => {
    const b = box();
    b.type("にほんご");
    expect(b.press({ key: "Enter", isComposing: true }).defaultPrevented).toBe(false);
    expect(b.press({ key: "Enter", keyCode: 229 }).defaultPrevented).toBe(false);
    expect(b.sent).toEqual([]);
    b.destroy();
  });

  test("an empty box, or one of spaces, sends nothing", () => {
    const b = box();
    b.press({ key: "Enter" });
    b.type("   \n ");
    b.press({ key: "Enter" });
    expect(b.sent).toEqual([]);
    b.destroy();
  });

  test("Ctrl+Enter sends too", () => {
    const b = box();
    b.type("Agreed");
    b.press({ key: "Enter", ctrlKey: true });
    expect(b.sent).toEqual(["Agreed"]);
    b.destroy();
  });

  test("with the @ list open, Enter takes the highlighted name and sends nothing", () => {
    const b = box();
    b.type("Ask @an");
    const list = b.area.parentElement?.querySelector("[role=listbox]");
    expect(list).not.toBeNull();
    b.press({ key: "ArrowDown" });
    const e = b.press({ key: "Enter" });
    expect(e.defaultPrevented).toBe(true);
    expect(b.sent).toEqual([]);
    expect(b.value()).toBe("Ask @anton ");
    // The list closed: the next Enter sends.
    b.press({ key: "Enter" });
    expect(b.sent).toEqual(["Ask @anton "]);
    b.destroy();
  });

  test("Escape still reaches the form (it drops a draft)", () => {
    const b = box();
    b.type("Draft");
    b.press({ key: "Escape" });
    expect(b.passed).toEqual(["Escape"]);
    b.destroy();
  });
});
