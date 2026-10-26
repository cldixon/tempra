import { test } from "bun:test";
import { draw } from "../dom";
import W from "./W.svelte";
test("ws", () => {
  const { host } = draw(W, { items: ["a", "b"], flag: true });
  console.log(JSON.stringify(host.innerHTML.replace(/<!---->|<!--\[-->|<!--\]-->/g, "")));
});
