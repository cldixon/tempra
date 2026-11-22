import { describe, expect, test } from "bun:test";
import { fenceAttr, resolvePalette, SVG_MAX_SOURCE, sanitizeSvg } from "./src/svg";

const ok = (src: string, idPrefix?: string) => {
  const r = sanitizeSvg(src, { idPrefix });
  if (!r.ok) throw new Error(`did not parse: ${r.message}`);
  return r;
};

describe("SVG fences (TEMPRA-206)", () => {
  test("a plain drawing comes back standing alone, sized by its viewBox", () => {
    const r = ok(
      '<svg width="120" height="40"><title>Two boxes</title><rect x="1" y="1" width="50" height="38" fill="currentColor"/><text x="60" y="25">A &amp; B</text></svg>',
    );
    expect(r.svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><title>Two boxes</title><rect x="1" y="1" width="50" height="38" fill="currentColor"/><text x="60" y="25">A &amp; B</text></svg>',
    );
    expect(r.removed).toEqual([]);
    expect(r.title).toBe("Two boxes");
    // Sanitizing is stable: its own output comes back unchanged.
    expect(ok(r.svg).svg).toBe(r.svg);
  });

  test("an XML declaration, a doctype, comments and editors' attributes are dropped quietly", () => {
    const r = ok(
      '<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n<!-- made by hand --><svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="x" inkscape:version="1" viewBox="0 0 2 2"><metadata>x</metadata><sodipodi:namedview/><circle r="1"/></svg>',
    );
    expect(r.svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2" width="2" height="2"><circle r="1"/></svg>',
    );
    expect(r.removed).toEqual([]);
  });

  test("what runs, loads or links is removed and named", () => {
    const r = ok(
      [
        '<svg viewBox="0 0 10 10" onload="alert(1)">',
        "<script>alert(1)</script>",
        "<style>rect{fill:red}</style>",
        '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>',
        '<image href="https://example.com/x.png"/>',
        '<animate attributeName="href" to="javascript:alert(1)"/>',
        '<a href="https://example.com"><rect width="1" height="1" onclick="x()"/></a>',
        '<use href="https://example.com/s.svg#a"/>',
        '<rect fill="url(https://example.com/p.svg#g)" style="fill:url(http://x/y);stroke:black"/>',
        '<path d="M0 0" style="background:expression(alert(1))"/>',
        "<blink>x</blink>",
        "</svg>",
      ].join(""),
    );
    expect(r.svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"><rect width="1" height="1"/><rect style="stroke:black"/><path d="M0 0"/></svg>',
    );
    expect(r.removed.sort()).toEqual(
      [
        "<style> elements (use attributes)",
        "animation",
        "event handlers",
        "foreignObject",
        "images",
        "links (their contents are kept)",
        "references outside the SVG",
        "scripts",
        "unknown elements (<blink>)",
        "unsafe styles",
      ].sort(),
    );
    for (const bad of ["script", "onload", "onclick", "example.com", "javascript", "expression"]) {
      expect(r.svg).not.toContain(bad);
    }
  });

  test("styles that could load without url() are dropped", () => {
    const r = ok(
      '<svg><rect style="mask-image:image-set(&quot;https://x/a.png&quot; 1x);fill:\\75rl(x);stroke:red" data-x="see https://x"/></svg>',
    );
    expect(r.svg).toBe('<svg xmlns="http://www.w3.org/2000/svg"><rect style="stroke:red"/></svg>');
  });

  test("javascript: is caught however it is spelt", () => {
    const r = ok(
      '<svg><use href="  java&#x09;script:alert(1)"/><text fill="JaVaScRiPt:x">t</text></svg>',
    );
    expect(r.svg).toBe('<svg xmlns="http://www.w3.org/2000/svg"><text>t</text></svg>');
  });

  test("internal references keep working, prefixed with the figure's ids", () => {
    const r = ok(
      '<svg><defs><linearGradient id="g"><stop offset="0"/></linearGradient><path id="p" d="M0 0"/></defs><rect fill="url(#g)" style="stroke:url(&quot;#g&quot;)"/><use xlink:href="#p"/><text><textPath href="#p">x</textPath></text></svg>',
      "f3-",
    );
    expect(r.svg).toContain('<linearGradient id="f3-g">');
    expect(r.svg).toContain('fill="url(#f3-g)"');
    expect(r.svg).toContain('style="stroke:url(#f3-g)"');
    expect(r.svg).toContain('<use href="#f3-p"/>');
    expect(r.svg).toContain('<textPath href="#f3-p">');
    expect(r.removed).toEqual([]);
  });

  test("an author's font-family stays, as an attribute or a style (TEMPRA-216)", () => {
    const r = ok(
      '<svg viewBox="0 0 10 10" font-family="Georgia, serif"><text>a</text><text font-family="Menlo">b</text><text style="font-family:&quot;Inter&quot;, sans-serif">c</text></svg>',
    );
    expect(r.svg).toContain(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" font-family="Georgia, serif" width="10" height="10">',
    );
    expect(r.svg).toContain('<text font-family="Menlo">b</text>');
    expect(r.svg).toContain("font-family:");
    expect(r.removed).toEqual([]);
  });

  test("what does not parse says where", () => {
    const cases: [string, string, number, number][] = [
      ["<svg><rect></svg>", "</svg> closes <rect>", 1, 12],
      ["<svg>\n  <rect width=10/>\n</svg>", "width's value must be quoted", 2, 15],
      ['<svg><rect x="1" x="2"/></svg>', "x is given twice", 1, 20],
      ["<svg><text>AT&T</text></svg>", '"&" must start an entity such as &amp;', 1, 14],
      [
        "<svg><text>&bogus;</text></svg>",
        "unknown entity &bogus; (write the character itself)",
        1,
        12,
      ],
      [
        "<svg><text>&constructor;</text></svg>",
        "unknown entity &constructor; (write the character itself)",
        1,
        12,
      ],
      ["<svg>", "<svg> is not closed", 1, 6],
      ["<html></html>", "the top element is <html>, not <svg>", 1, 1],
      ["", "no <svg> element", 1, 1],
      ["hello <svg/>", "text outside the <svg> element", 1, 1],
      ["<svg/><svg/>", "a second top-level element", 1, 7],
      ['<!DOCTYPE svg [<!ENTITY a "b">]><svg/>', "a DOCTYPE with declarations is not read", 1, 1],
    ];
    for (const [src, message, line, column] of cases) {
      expect({ src, ...sanitizeSvg(src) }).toEqual({ src, ok: false, message, line, column });
    }
    const big = sanitizeSvg(`<svg>${" ".repeat(SVG_MAX_SOURCE)}</svg>`);
    expect(big).toMatchObject({ ok: false, line: 0 });
  });

  test("HTML's common entities read as their characters (TEMPRA-315)", () => {
    const r = ok(
      "<svg><text>a&nbsp;b &mdash; c &rarr; d&hellip; 3&times;4 &le; 20&deg; &ldquo;q&rdquo; &alpha;&#x2192;</text></svg>",
    );
    expect(r.svg).toContain(
      "<text>a\u00a0b \u2014 c \u2192 d\u2026 3\u00d74 \u2264 20\u00b0 \u201cq\u201d \u03b1\u2192</text>",
    );
    expect(ok(r.svg).svg).toBe(r.svg);
  });

  test("a drawing is its viewBox's size, one unit a pixel, unless it gives its own (TEMPRA-315)", () => {
    expect(ok('<svg viewBox="0 0 300 120"/>').svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120" width="300" height="120"/>',
    );
    expect(ok('<svg viewBox="-10,-10 640,180"/>').svg).toContain('width="640" height="180"');
    expect(ok('<svg viewBox="0 0 300 120" width="100%"/>').svg).not.toContain('height="120"');
    expect(ok('<svg viewBox="0 0 0 0"/>').svg).not.toContain("width=");
    expect(ok("<svg/>").svg).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>');
  });

  test("classes go quietly: no stylesheet reaches a fence (TEMPRA-315)", () => {
    const r = ok('<svg><rect class="box accent" width="2" height="2"/></svg>');
    expect(r.svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/></svg>',
    );
    expect(r.removed).toEqual([]);
  });

  test("the palette's names stay; another var() goes, or becomes its fallback (TEMPRA-315)", () => {
    const r = ok(
      [
        '<svg><rect fill="var(--accent)" stroke="var( --ink , #000)"/>',
        '<rect style="fill:var(--series-3);stroke:var(--tempra-color-agent)"/>',
        '<rect fill="var(--brand, #336699)"/>',
        '<rect fill="var(--x)" stroke="black"/></svg>',
      ].join(""),
    );
    expect(r.svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="var(--accent)" stroke="var(--ink)"/><rect style="fill:var(--series-3)"/><rect fill="#336699"/><rect stroke="black"/></svg>',
    );
    expect(r.unknownVars.sort()).toEqual(["--brand", "--tempra-color-agent", "--x"]);
    expect(r.removed).toEqual([]);
  });

  test("fixed paint colours are noted for the colour lint, nothing else (TEMPRA-315)", () => {
    const r = ok(
      [
        '<svg color="#222"><rect fill="#000" stroke="none"/><text fill="currentColor" style="fill:WHITE">t</text>',
        '<linearGradient id="g"><stop stop-color="rgb(10, 20, 30)"/></linearGradient>',
        '<rect fill="url(#g)" stroke="var(--muted)" width="#fff"/><rect fill="#000"/></svg>',
      ].join(""),
    );
    expect(r.colors.sort()).toEqual(["#000", "#222", "WHITE", "rgb(10, 20, 30)"].sort());
  });

  test("the root's title and desc are read for the figure's name and description", () => {
    const r = ok(
      "<svg><title>Write path</title><desc>An agent's write goes  through the Worker.</desc></svg>",
    );
    expect(r.title).toBe("Write path");
    expect(r.desc).toBe("An agent's write goes through the Worker.");
  });

  test("resolvePalette writes one theme's values in, and the text colour on the root", () => {
    const pal = { "--ink": "#111", "--accent": "#f60" };
    expect(
      resolvePalette(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="var(--accent)" style="stroke:var(--ink)"/><rect fill="var(--muted)"/></svg>',
        pal,
      ),
    ).toBe(
      '<svg color="#111" xmlns="http://www.w3.org/2000/svg"><rect fill="#f60" style="stroke:#111"/><rect fill="var(--muted)"/></svg>',
    );
    expect(resolvePalette('<svg color="red"/>', pal)).toBe('<svg color="red"/>');
  });

  test("fence attributes: title and alt, quoted or not", () => {
    expect(fenceAttr('title="The flow" alt="Boxes and arrows"', "alt")).toBe("Boxes and arrows");
    expect(fenceAttr("alt='One' title=Two", "title")).toBe("Two");
    expect(fenceAttr("salt=x", "alt")).toBeNull();
    expect(fenceAttr(null, "alt")).toBeNull();
  });

  test("no one-character change to a hostile SVG gets anything through", () => {
    const hostile =
      '<svg onload="a()"><script>b()</script><a href="javascript:c()"><text>x</text></a><use href="http://x/#y"/><rect style="fill:url(http://x)" fill="url(#ok)"/><foreignObject><b>d</b></foreignObject><animate attributeName="href" to="javascript:e()"/></svg>';
    // In tags and attribute values only: text is escaped, so "http:" there is inert.
    const unsafe =
      /<(script|foreignObject|animate|a)[\s>/]|\son\w+="|="[^"]*(javascript:|https?:)/i;
    let parsed = 0;
    for (let i = 0; i < hostile.length; i++) {
      const variant = hostile.slice(0, i) + hostile.slice(i + 1);
      const r = sanitizeSvg(variant);
      if (!r.ok) continue;
      parsed++;
      // Tags alone: text is escaped ("<" never appears in it), so nothing in it is live.
      const svg = r.svg
        .replace(' xmlns="http://www.w3.org/2000/svg"', "")
        .replace(/>[^<]*</g, "><");
      expect({ variant, svg }).toEqual({ variant, svg: svg.replace(unsafe, "") });
    }
    expect(parsed).toBeGreaterThan(20);
  });
});
