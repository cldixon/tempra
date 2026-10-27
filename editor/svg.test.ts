import { describe, expect, test } from "bun:test";
import { fenceAttr, SVG_MAX_SOURCE, sanitizeSvg } from "./src/svg";

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
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><circle r="1"/></svg>',
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
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="1" height="1"/><rect style="stroke:black"/><path d="M0 0"/></svg>',
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

  test("what does not parse says where", () => {
    const cases: [string, string, number, number][] = [
      ["<svg><rect></svg>", "</svg> closes <rect>", 1, 12],
      ["<svg>\n  <rect width=10/>\n</svg>", "width's value must be quoted", 2, 15],
      ['<svg><rect x="1" x="2"/></svg>', "x is given twice", 1, 20],
      ["<svg><text>AT&T</text></svg>", '"&" must start an entity such as &amp;', 1, 14],
      ["<svg><text>&nbsp;</text></svg>", "unknown entity &nbsp;", 1, 12],
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
