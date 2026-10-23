import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generate } from "./build";
import { css, fonts, hash, href } from "./dist/tempra";

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

test("every font the stylesheets name exists: in the package for the site, served for the app", () => {
  const site = readFileSync(join(import.meta.dir, "dist", "tempra.css"), "utf8");
  for (const [, file] of site.matchAll(/url\("\.\.\/fonts\/([^"]+)"\)/g)) {
    expect(readFileSync(join(import.meta.dir, "fonts", file as string)).byteLength).toBeGreaterThan(
      0,
    );
  }
  const served = [...css.matchAll(/url\("\/_design\/([^"]+)"\)/g)].map((m) => m[1] as string);
  expect(served.length).toBeGreaterThan(0);
  expect(served.sort()).toEqual(Object.keys(fonts).sort());
  expect(css).not.toContain("../fonts/");
});
