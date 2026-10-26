import { test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { flushSync, mount, unmount } from "svelte";
import Body from "./src/reader/Body.svelte";
import { openFigureContext } from "./src/reader/open-figure";
import { cases } from "/tmp/claude-0/-home-user-tempra/db7937eb-1e2a-5df9-ace6-8c4c6c012147/scratchpad/cases.ts";
test("compare", () => {
  const ref = JSON.parse(readFileSync("/tmp/claude-0/-home-user-tempra/db7937eb-1e2a-5df9-ace6-8c4c6c012147/scratchpad/ref.json", "utf8"));
  const norm = (h: string) => h.replace(/<!--[\s\S]*?-->/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "<svg/>").replace(/ checked=""/g, "").replace(/&quot;/g, '"').replace(/ readonly=""/g, "").replace(/data-block="[^"]*"/g, "data-block").replace(/(aria-labelledby|id)="[^"]*_[^"]*"/g, "$1");
  const canon = (h: string) => { const d = document.createElement("div"); d.innerHTML = h; const walk = (n: Element) => { const attrs = [...n.attributes].map((a) => [a.name, a.value]).filter(([k]) => k !== "style"); for (const [k] of attrs) n.removeAttribute(k); for (const a of [...n.attributes]) n.removeAttribute(a.name); attrs.sort((x, y) => x[0] < y[0] ? -1 : 1); for (const [k, v] of attrs) n.setAttribute(k, v); for (const c of n.children) walk(c); }; for (const c of d.children) walk(c); return d.innerHTML; };
  let same = 0; const diffs: string[] = [];
  for (const c of cases()) {
    const host = document.createElement("div"); document.body.append(host);
    const i = mount(Body, { target: host, props: { prepared: c.p, diff: c.diff, hideFirst: c.hideFirst }, context: c.open ? openFigureContext(() => {}) : undefined });
    flushSync();
    const a = canon(norm(host.innerHTML)); unmount(i); host.remove();
    const tmp = document.createElement("div"); tmp.innerHTML = ref[c.name]; const b = canon(norm(tmp.innerHTML));
    if (a === b) same++; else diffs.push(c.name + "\n@@A\n" + a + "\n@@B\n" + b);
  }
  writeFileSync("/tmp/claude-0/-home-user-tempra/db7937eb-1e2a-5df9-ace6-8c4c6c012147/scratchpad/diffs.txt", diffs.join("\n\n=====\n\n"));
  console.log("same", same, "diff", diffs.length);
});
