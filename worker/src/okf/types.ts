import type { Doc } from "@tempra/editor/doc";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export interface LintWarning {
  code: string;
  message: string;
  /** The path the warning is about, when it is not the concept itself (e.g. a broken link). */
  target?: string;
  /** The body block the warning is about (e.g. a diagram that does not parse). */
  block?: string;
  /**
   * Found by the render service after the write (TEMPRA-167, TEMPRA-207): replaced, not added to,
   * when its next verdicts come.
   */
  rendered?: true;
}

/**
 * A body link as stored in a concept record: the written target plus what it resolved to. One per
 * internal link, image or definition of the document, in document order.
 */
export interface StoredLink {
  /** Which of the document's link targets (links, images, definitions in order) it is. */
  at: number;
  raw: string;
  /** Bundle path the target resolved to at write time, without anchor. */
  path: string;
  anchor: string | null;
  form: "absolute" | "relative";
  /** concept_id of the target, or null when it did not exist at write time. */
  target: string | null;
}

/**
 * An internal `sources[].resource` as stored in a concept record, resolved like a body link
 * (spec: Concept model, Links). `root` is a bundle-root path without a leading slash, as OKF's
 * sample bundles write them.
 */
export interface StoredSource {
  /** Position of the entry in `sources`. */
  index: number;
  /** The resource exactly as written, anchor included. */
  raw: string;
  /** Bundle path the resource resolved to at write time, without anchor. */
  path: string;
  anchor: string | null;
  form: "absolute" | "relative" | "root";
  /** concept_id of the target, or null when it did not exist at write time. */
  target: string | null;
}

/**
 * A concept's content version (spec: Concept model; tempra-dev: decisions/structured-documents).
 * Hashing its canonical serialization gives the content-version hash used by ETags, If-Match and
 * the ledger. `verified` is not part of it.
 */
export interface ConceptRecord {
  /** Writer frontmatter in arrival order, minus server-owned and computed keys. */
  fm: [string, Json][];
  /** Frontmatter text kept verbatim when it could not be parsed as a YAML mapping. */
  raw_fm: string | null;
  /** Server-owned `generated`. */
  generated: JsonObject | null;
  /** The body: the stored tree, every block with its ID. */
  doc: Doc;
  /** The body as markdown, generated from `doc` with links as written: what agents read. */
  body: string;
  links: StoredLink[];
  /** Internal source resources; absent when there are none. */
  sources?: StoredSource[];
}

export interface Verification {
  by: string;
  at: string;
}

export type TrustTier = "unverified" | "machine-confirmed" | "human-reviewed";
