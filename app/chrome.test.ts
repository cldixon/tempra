import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { flushSync, tick } from "svelte";
import { draw } from "./test/dom";
import MenuFixture from "./test/MenuFixture.svelte";

/*
 * The shared chrome every page leans on (Menu.svelte, Portal.svelte): the menu's keys and how it
 * closes (TEMPRA-133, F-16), and a portal drawing straight into its target. The gate's keyboard
 * pass drives them in Chromium; these pin the rules.
 */

// happy-dom lays nothing out; the menu takes the choices it can see, so here every element is
// shown (and only here: bun runs every test file in one process).
const rects = Element.prototype.getClientRects;
beforeAll(() => {
  Element.prototype.getClientRects = () => [{}] as unknown as DOMRectList;
});
afterAll(() => {
  Element.prototype.getClientRects = rects;
});

function setup() {
  const target = document.createElement("div");
  document.body.append(target);
  const d = draw(MenuFixture, { target });
  const button = d.host.querySelector<HTMLButtonElement>("button.menu-button");
  if (!button) throw new Error("no menu button");
  const list = () => d.host.querySelector(".menu-list");
  /** A choice in the open list. */
  const choice = (selector: string) => {
    const el = list()?.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`no ${selector} in the menu`);
    return el;
  };
  const key = (el: Element, k: string) =>
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  return { ...d, target, button, list, choice, key };
}

describe("Menu", () => {
  test("its button names it and says whether it is open", () => {
    const m = setup();
    expect(m.button.getAttribute("aria-label")).toBe("Things");
    expect(m.button.getAttribute("aria-expanded")).toBe("false");
    m.button.click();
    flushSync();
    expect(m.button.getAttribute("aria-expanded")).toBe("true");
    expect(m.list()?.id).toBe(m.button.getAttribute("aria-controls") ?? "");
    m.destroy();
  });

  test("Down on the button opens it at the first choice; Up, Down, Home and End move", async () => {
    const m = setup();
    m.button.focus();
    m.key(m.button, "ArrowDown");
    await tick();
    flushSync();
    const choices = () => [...(m.list()?.querySelectorAll<HTMLElement>("a, button") ?? [])];
    expect(document.activeElement).toBe(choices()[0]);
    m.key(document.activeElement as Element, "ArrowDown");
    expect(document.activeElement).toBe(choices()[1]);
    m.key(document.activeElement as Element, "End");
    expect(document.activeElement).toBe(choices()[2]);
    m.key(document.activeElement as Element, "ArrowDown");
    expect(document.activeElement).toBe(choices()[0]);
    m.key(document.activeElement as Element, "ArrowUp");
    expect(document.activeElement).toBe(choices()[2]);
    m.key(document.activeElement as Element, "Home");
    expect(document.activeElement).toBe(choices()[0]);
    m.destroy();
  });

  test("Escape closes it and gives the focus back to its button", () => {
    const m = setup();
    m.button.click();
    flushSync();
    m.choice("a").focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    flushSync();
    expect(m.list()).toBeNull();
    expect(document.activeElement).toBe(m.button);
    m.destroy();
  });

  test("a choice closes it, unless it is marked to stay", () => {
    const m = setup();
    m.button.click();
    flushSync();
    m.choice("[data-stay]").click();
    flushSync();
    expect(m.list()).not.toBeNull();
    m.choice("button:not([data-stay])").click();
    flushSync();
    expect(m.list()).toBeNull();
    m.destroy();
  });

  test("a press outside closes it", () => {
    const m = setup();
    m.button.click();
    flushSync();
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    flushSync();
    expect(m.list()).toBeNull();
    m.destroy();
  });
});

describe("Portal", () => {
  test("draws straight into its target, with no wrapper, and leaves with its page", () => {
    const m = setup();
    expect(m.target.firstElementChild?.className).toBe("portaled");
    expect(m.host.querySelector(".portaled")).toBeNull();
    m.destroy();
    expect(m.target.querySelector(".portaled")).toBeNull();
  });
});
