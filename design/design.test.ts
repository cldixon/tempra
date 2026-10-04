import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generate } from "./build";
import { css, hash, href } from "./dist/tempra";

test("dist/ is up to date with src/ (run `bun run build` in design/)", () => {
  const fresh = generate();
  expect(readFileSync(join(import.meta.dir, "dist", "tempra.css"), "utf8")).toBe(fresh.css);
  expect(readFileSync(join(import.meta.dir, "dist", "tempra.ts"), "utf8")).toBe(fresh.ts);
});

test("the stylesheet carries tokens, base and prose, and a hashed URL", () => {
  expect(css).toContain("--tempra-color-text");
  expect(css).toContain("light-dark(");
  expect(css).toContain(".prose");
  expect(hash).toMatch(/^[0-9a-f]{12}$/);
  expect(href).toBe(`/_design/tempra.${hash}.css`);
});
