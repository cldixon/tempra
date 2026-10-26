/**
 * Drawn diagrams in exports (TEMPRA-168; tempra-dev: app/media, Diagrams): a downloaded bundle
 * carries, beside each concept with Mermaid fences, `<concept>.diagrams/<n>.svg`, the light SVG
 * the render Worker draws (its R2 cache makes an unchanged fence cost nothing), numbered as the
 * reader numbers figures (`findFigures`). Derived, never written into the concept, and ignored
 * on import. A fence that does not draw, or a render service that is not there, is left out
 * without a word: the export never fails for a diagram. Bounded by MAX_EXPORT_DIAGRAMS, a time
 * budget and a few renders at a time. Free of Worker APIs.
 */
import { FIGURE_FENCES, findFigures, parseMarkdown } from "@tempra/editor/doc";
import { splitFrontmatter } from "./okf/concept";
import { RENDER_WIDTH, type RenderContext, type RenderDiagram } from "./render";

/** The most diagrams one export draws; past it the rest are left out. */
export const MAX_EXPORT_DIAGRAMS = 500;
/** How long one export spends drawing, in all; what is not drawn by then is left out. */
export const EXPORT_DIAGRAMS_MS = 60_000;
/** Renders in flight at once. */
export const EXPORT_RENDER_CONCURRENCY = 4;

export interface DiagramExport {
  render: RenderDiagram;
  /** Whose renders these are, for metering. */
  ctx: RenderContext;
  max?: number;
  budgetMs?: number;
  concurrency?: number;
}

const DERIVED = /^(.*)\.diagrams\/\d+\.svg$/;
const HAS_FENCE = /(?:`{3,}|~{3,})[ \t]*mermaid/i;

/** Where a concept's drawn diagrams go: `a/b.md` → `a/b.diagrams/`. */
export function diagramsDir(conceptPath: string): string {
  return `${conceptPath.replace(/\.md$/, "")}.diagrams/`;
}

/** Whether a bundle path is a drawn diagram beside one of `concepts` (paths ending .md). */
export function isDrawnDiagram(path: string, concepts: ReadonlySet<string>): boolean {
  const m = DERIVED.exec(path);
  return !!m && concepts.has(`${m[1]}.md`);
}

/** The Mermaid fences of a bundle's concepts, as export paths and sources, in bundle order. */
export function diagramJobs(
  files: { path: string; text?: string }[],
): { path: string; source: string }[] {
  const taken = new Set(files.map((f) => f.path));
  const jobs: { path: string; source: string }[] = [];
  for (const f of files) {
    if (f.text === undefined || !f.path.endsWith(".md") || !HAS_FENCE.test(f.text)) continue;
    const dir = diagramsDir(f.path);
    for (const fig of findFigures(parseMarkdown(splitFrontmatter(f.text).body))) {
      if (fig.kind !== "diagram" || !FIGURE_FENCES.has((fig.node.lang ?? "").toLowerCase())) {
        continue;
      }
      const path = `${dir}${fig.n}.svg`;
      // A real file at that path is the library's own; keep it and draw nothing over it.
      if (!taken.has(path) && fig.node.value.trim()) jobs.push({ path, source: fig.node.value });
    }
  }
  return jobs;
}

/** Draws a bundle's diagrams as SVG files; what fails or runs out of budget is left out. */
export async function drawnDiagrams(
  files: { path: string; text?: string }[],
  opts: DiagramExport,
): Promise<{ path: string; svg: string }[]> {
  const jobs = diagramJobs(files).slice(0, opts.max ?? MAX_EXPORT_DIAGRAMS);
  if (jobs.length === 0) return [];
  const drawn: (string | undefined)[] = new Array(jobs.length);
  let next = 0;
  let over = false;
  const worker = async () => {
    while (!over && next < jobs.length) {
      const i = next++;
      const job = jobs[i] as (typeof jobs)[number];
      const r = await opts.render(
        { source: job.source, width: RENDER_WIDTH, theme: "light" },
        opts.ctx,
      );
      if (!over && r.svg && !r.error) drawn[i] = r.svg;
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pool = Promise.all(
    Array.from(
      { length: Math.min(opts.concurrency ?? EXPORT_RENDER_CONCURRENCY, jobs.length) },
      worker,
    ),
  );
  await Promise.race([
    pool,
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        over = true;
        resolve();
      }, opts.budgetMs ?? EXPORT_DIAGRAMS_MS);
    }),
  ]);
  over = true;
  if (timer !== undefined) clearTimeout(timer);
  const out: { path: string; svg: string }[] = [];
  for (const [i, svg] of drawn.entries()) {
    const job = jobs[i];
    if (svg !== undefined && job) out.push({ path: job.path, svg });
  }
  return out;
}
