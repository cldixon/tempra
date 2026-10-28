import { describe, expect, test } from "bun:test";
import {
  CHART_MAX_ROWS,
  ChartDataError,
  chartConfig,
  chartDataPaths,
  delimitedRows,
  delimitedValues,
  inlineChartData,
  parseChart,
  sizedChart,
} from "./src/chart";

describe("Vega-Lite fences (TEMPRA-207)", () => {
  test("a spec is a JSON object; what is not says where", () => {
    expect(parseChart('{"mark":"bar"}')).toEqual({ ok: true, spec: { mark: "bar" } });
    expect(parseChart("[1]")).toMatchObject({
      ok: false,
      message: "a Vega-Lite spec is a JSON object",
    });
    const bad = parseChart('{\n  "mark": "bar",\n}');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toStartWith("it is not JSON");
    expect(parseChart(" ".repeat(50_001))).toMatchObject({ ok: false, line: 0 });
  });

  test("data from the library is allowed; anything else is named, in every view", () => {
    const spec = {
      data: { url: "/data/sales.csv" },
      layer: [
        { data: { url: "https://example.com/x.csv" }, mark: "line" },
        { data: { url: "rel.csv" }, mark: "point" },
      ],
      transform: [{ lookup: "id", from: { data: { url: "data:text/csv,a" }, key: "id" } }],
    };
    const { paths, problems } = chartDataPaths(spec, "notes/q.md");
    expect(paths).toEqual(["data/sales.csv", "notes/rel.csv"]);
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toContain("data from https://example.com/x.csv is not read");
    expect(problems.join("\n")).toContain("data from data:text/csv,a is not read");
  });

  test("CSV and TSV: quotes, line ends, and columns typed as Vega's auto parse types them", () => {
    expect(delimitedRows('a,"b,c","d ""e"""\r\n1,2,3', ",")).toEqual([
      ["a", "b,c", 'd "e"'],
      ["1", "2", "3"],
    ]);
    expect(
      delimitedValues(
        "name,n,share,ok,day\nAnn,3,0.5,true,2024-01-02\nBo,,1.25,false,2024-02-01\n",
        ",",
      ),
    ).toEqual([
      { name: "Ann", n: 3, share: 0.5, ok: true, day: "2024-01-02" },
      { name: "Bo", n: null, share: 1.25, ok: false, day: "2024-02-01" },
    ]);
    expect(delimitedValues("a\tb\nx\t1\n", "\t")).toEqual([{ a: "x", b: 1 }]);
  });

  test("inlining: library files read, text values parsed, the original untouched; refusals", async () => {
    const files: Record<string, string> = {
      "data/sales.csv": "month,v\nJan,3\nFeb,5\n",
      "data/rows.json": '{"rows":[{"a":1}]}',
    };
    const read = async (p: string) => files[p] ?? null;
    const spec = {
      data: { url: "/data/sales.csv" },
      layer: [
        {
          data: { url: "/data/rows.json", format: { type: "json", property: "rows" } },
          mark: "point",
        },
        { data: { values: "x\ty\n1\t2", format: { type: "tsv" } }, mark: "line" },
      ],
    };
    const out = await inlineChartData(spec, "notes/q.md", read);
    expect(out).toEqual({
      data: {
        values: [
          { month: "Jan", v: 3 },
          { month: "Feb", v: 5 },
        ],
      },
      layer: [
        { data: { values: [{ a: 1 }] }, mark: "point" },
        { data: { values: [{ x: 1, y: 2 }] }, mark: "line" },
      ],
    });
    expect(spec.data).toEqual({ url: "/data/sales.csv" });
    const fails = async (s: Record<string, unknown>) =>
      inlineChartData(s, "", read).then(
        () => "",
        (e) => (e instanceof ChartDataError ? e.message : `other: ${e}`),
      );
    expect(await fails({ data: { url: "https://x/y.csv" } })).toContain("is not read");
    expect(await fails({ data: { url: "/missing.csv" } })).toBe(
      "no file at /missing.csv for the chart's data",
    );
    expect(
      await fails({ data: { url: "/data/sales.csv", format: { type: "topojson" } } }),
    ).toContain("topojson is not read");
    const many = Array.from({ length: CHART_MAX_ROWS + 1 }, (_, i) => ({ i }));
    expect(await fails({ data: { values: many } })).toContain("over");
  });

  test("a single view without a width fills the column; others keep their size", () => {
    expect(sizedChart({ mark: "bar" }, 680)).toEqual({
      autosize: { type: "fit-x", contains: "padding" },
      mark: "bar",
      width: 680,
    });
    expect(sizedChart({ mark: "bar", width: 200 }, 680)).toEqual({ mark: "bar", width: 200 });
    expect(sizedChart({ hconcat: [] }, 680)).toEqual({ hconcat: [] });
    expect(sizedChart({ mark: "bar" }, 0)).toEqual({ mark: "bar" });
  });

  test("the theme: the page's ground, ink, Inter and grey series, from the diagram theme", () => {
    const c = chartConfig({
      "--pele-bg": "#fff",
      "--pele-fg": "#111",
      "--pele-muted": "#666",
      "--pele-border": "#ddd",
      "--pele-font": "Inter",
      "--pele-series-1": "#111",
      "--pele-series-2": "#666",
    }) as {
      background: string;
      font: string;
      range: { category: string[] };
      axis: { labelColor: string };
    };
    expect(c.background).toBe("#fff");
    expect(c.font).toBe("Inter");
    expect(c.axis.labelColor).toBe("#666");
    expect(c.range.category.slice(0, 2)).toEqual(["#111", "#666"]);
  });

  test("the series in colour, greys for the rest, level x labels thinned on collision (TEMPRA-217)", () => {
    const theme = { "--pele-fg": "#111", "--pele-muted": "#666", "--pele-border": "#ddd" };
    const series = ["#2a78d6", "#eb6834", "#1baf7a"];
    const c = chartConfig(theme, series) as {
      mark: { color: string };
      axis: { labelColor: string; gridColor: string; domainColor: string };
      axisX: { labelAngle: number; labelOverlap: boolean };
      range: { category: string[]; ordinal: string[]; ramp: string[] };
    };
    expect(c.range.category).toEqual(series);
    expect(c.range.ordinal).toEqual(series);
    expect(c.mark.color).toBe("#2a78d6");
    expect([c.axis.labelColor, c.axis.gridColor, c.axis.domainColor]).toEqual([
      "#666",
      "#ddd",
      "#666",
    ]);
    expect(c.axisX).toEqual({ labelAngle: 0, labelOverlap: true });
    expect(c.range.ramp.every((v) => !series.includes(v))).toBe(true);
  });
});
