import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Text people read meets WCAG AA (4.5:1) in light and dark (TEMPRA-132, X-5): the text and muted
// greys on every surface text sits on. Faint is for icons and rules only, so it is not held to it;
// the focus ring is the text colour, so it has the text's contrast.

const tokens = readFileSync(join(import.meta.dir, "src", "tokens.css"), "utf8");

/** A token's light and dark values, from `--name: light-dark(#light, #dark)`. */
function pair(name: string): [string, string] {
  const m = tokens.match(
    new RegExp(`--tempra-${name}:\\s*light-dark\\((#[0-9a-f]{6}),\\s*(#[0-9a-f]{6})\\)`, "i"),
  );
  if (!m) throw new Error(`no light-dark() colour for --tempra-${name}`);
  return [m[1] as string, m[2] as string];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const surfaces = ["color-bg", "color-ground", "color-hover", "color-selected"];
const scheme = { light: 0, dark: 1 } as const;

describe("text contrast (WCAG AA)", () => {
  test("the contrast formula", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  for (const text of ["color-text", "color-muted"]) {
    for (const surface of surfaces) {
      for (const [mode, i] of Object.entries(scheme)) {
        test(`${text} on ${surface}, ${mode}: at least 4.5:1`, () => {
          expect(contrast(pair(text)[i], pair(surface)[i])).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }

  test("the focus ring is the text colour", () => {
    expect(tokens).toMatch(/--tempra-focus-ring:[^;]*var\(--tempra-color-text\)/);
  });
});
