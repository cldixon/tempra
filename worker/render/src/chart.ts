/**
 * Vega-Lite charts on the render Worker (TEMPRA-207; tempra-dev: app/diagrams): a spec with its
 * data already inline (the main Worker reads the library's files, @tempra/editor
 * `inlineChartData`) compiled by Vega-Lite and drawn by Vega to an SVG string, themed with the
 * reader's greys. Vega evaluates expressions with its interpreter, never `new Function`, which
 * Workers forbid; it is given a loader that loads nothing, and what it draws is sanitized, so a
 * spec reaches no network.
 */
import { peleThemes } from "@tempra/design/pele";
import {
  type ChartSpec,
  chartConfig,
  chartData,
  parseChart,
  sanitizeSvg,
  sizedChart,
} from "@tempra/editor/doc";
import { loader, parse, Error as VegaError, View } from "vega";
import { expressionInterpreter } from "vega-interpreter";
import { compile } from "vega-lite";
import type { Theme } from "./render";
import { MAX_CHART_SOURCE } from "./version";

/** Vega-Lite and Vega, pinned exactly (worker/render/package.json and app/package.json). */
export { VEGA_LITE_VERSION, VEGA_VERSION } from "./version";

/** A loader that refuses everything: the main Worker inlines the data; a spec fetches nothing. */
function noNetwork() {
  const l = loader();
  const refuse = async (uri: string) => {
    throw new Error(`data from ${uri} is not loaded: a chart's data is inline or a library file`);
  };
  l.load = refuse;
  // A link or an image's address is asked for here too: none is given (and links are sanitized
  // out of the drawing besides).
  l.sanitize = (async () => ({ href: "" })) as unknown as typeof l.sanitize;
  return l;
}

/** The chart drawn as SVG at `width` (0: its own size) in `theme`; throws Vega's error. */
export async function chartSvg(source: string, theme: Theme, width: number): Promise<string> {
  const parsed = parseChart(source);
  if (!parsed.ok) throw new Error(`The chart ${parsed.message}.`);
  const spec: ChartSpec = parsed.spec;
  if (chartData(spec).some((d) => d.url !== undefined)) {
    throw new Error("The chart's data was not made inline.");
  }
  const { spec: vega } = compile(sizedChart(spec, width) as never, {
    config: chartConfig(peleThemes[theme]) as never,
  });
  const view = new View(parse(vega, undefined, { ast: true }), {
    renderer: "none",
    expr: expressionInterpreter,
    loader: noNetwork(),
  });
  view.logLevel(VegaError);
  let svg: string;
  try {
    svg = await view.toSVG();
  } finally {
    view.finalize();
  }
  // Sanitized as an SVG fence is: links and images an encoding might add go, so the page the
  // rasterizer opens loads nothing.
  const clean = sanitizeSvg(svg, { maxLength: MAX_CHART_SOURCE });
  if (!clean.ok) throw new Error(`The chart's drawing did not parse: ${clean.message}.`);
  return clean.svg;
}
