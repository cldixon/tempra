/**
 * What MCP `read` says about a concept's figures (TEMPRA-154; tempra-dev: app/media, How agents
 * see): each figure, numbered as the reader numbers it (`findFigures`), with what the library
 * knows of it from the stored blob rows alone, so listing figures fetches no bytes.
 */
import { type Doc, fenceTitle, findFigures, linkTarget } from "@tempra/editor/doc";
import { diagramTypeOf } from "./diagrams";

/** An attachment as its blob row records it. */
export interface FigureBlob {
  hash: string;
  size: number;
  media: string | null;
  /**
   * Null when never worked out (an image stored before TEMPRA-152: `read` works it out, see
   * `figuresWithDimensions` in client.ts); 0 when worked out and the bytes do not say.
   */
  width: number | null;
  height: number | null;
}

export type FigureFact =
  | {
      n: number;
      kind: "image";
      /** As written in the body (links at their targets' current paths). */
      url: string;
      alt: string;
      /** The image's title, which is its caption. */
      title: string | null;
      /**
       * `ok`: an attachment in the library; `missing`: an internal path with no attachment there
       * (or a target the reader will not load); `external`: hotlinked from another site.
       */
      status: "ok" | "missing" | "external";
      /** The library path, when internal. */
      path: string | null;
      blob: FigureBlob | null;
    }
  | {
      n: number;
      kind: "diagram";
      lang: string;
      /** The diagram type its header names (flowchart, sequence, …), or null. */
      type: string | null;
      title: string | null;
      /** The fence's body, what the render Worker draws (TEMPRA-166). */
      source: string;
    };

/** The figures of a concept at `conceptPath`; `blobAt` reads an attachment's blob row by path. */
export function figureFacts(
  doc: Doc,
  conceptPath: string,
  blobAt: (path: string) => FigureBlob | null,
): FigureFact[] {
  return findFigures(doc).map((f): FigureFact => {
    if (f.kind === "diagram") {
      return {
        n: f.n,
        kind: "diagram",
        lang: (f.node.lang ?? "").toLowerCase(),
        type: diagramTypeOf(f.node.value),
        title: fenceTitle(f.node.meta),
        source: f.node.value,
      };
    }
    const { image } = f;
    const base = {
      n: f.n,
      kind: "image" as const,
      url: image.url,
      alt: image.alt ?? "",
      title: image.title?.trim() || null,
    };
    const target = linkTarget(conceptPath, image.url);
    if (target?.kind === "external") {
      return { ...base, status: "external", path: null, blob: null };
    }
    if (target?.kind !== "internal" || target.dir || target.path === "") {
      return { ...base, status: "missing", path: null, blob: null };
    }
    const blob = blobAt(target.path);
    return { ...base, status: blob ? "ok" : "missing", path: target.path, blob };
  });
}

const KB = 1024;

/** A size as people say it: 812 B, 182 KB, 1.4 MB. */
export function sizeText(bytes: number): string {
  if (bytes < KB) return `${bytes} B`;
  if (bytes < KB * KB) return `${Math.round(bytes / KB)} KB`;
  return `${(bytes / (KB * KB)).toFixed(1)} MB`;
}

/** One figure as a line of `read`'s header. */
export function figureLine(f: FigureFact): string {
  if (f.kind === "diagram") {
    return [
      `Figure ${f.n} · diagram (${f.lang}${f.type ? `, ${f.type}` : ""})`,
      ...(f.title ? [`caption ${JSON.stringify(f.title)}`] : []),
    ].join(" · ");
  }
  const parts = [`Figure ${f.n}`, f.path !== null ? `/${f.path}` : f.url];
  parts.push(`alt ${JSON.stringify(f.alt)}`);
  if (f.title) parts.push(`caption ${JSON.stringify(f.title)}`);
  if (f.blob?.width && f.blob.height) parts.push(`${f.blob.width}×${f.blob.height}`);
  if (f.blob) parts.push(sizeText(f.blob.size));
  parts.push(f.status);
  return parts.join(" · ");
}
