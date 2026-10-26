/**
 * Where the reader's images load from (TEMPRA-162; tempra-dev: app/media, How people see): the
 * library's image route by hash (`-/image/<sha256>`, inline and cached for good), with `srcset`
 * over the scaled widths up to the image's own and the stored width and height, so each image's box
 * is reserved before it loads. An image whose size was never worked out is just the original.
 */
import type { FigureSpec } from "@tempra/editor";
import type { Urls } from "./urls";

/** The long edges the server scales to (worker/src/images.ts VARIANT_EDGES; a test holds them equal). */
export const VARIANT_EDGES = [320, 640, 768, 1092, 1280, 1568, 1920] as const;

/** Media the server scales; GIF keeps its frames and SVG is drawn as written. */
const SCALABLE = new Set(["image/png", "image/jpeg", "image/webp"]);

/** An attachment an image shows, as `GET …/files/{path}` lists it under `images`. */
export interface ImageRef {
  hash: string;
  media: string | null;
  /** Absent or null when not known. */
  width?: number | null;
  height?: number | null;
}

/** What an `img` is given: where it loads from, and when known its candidates and size. */
export interface ImageSource {
  src: string;
  srcset?: string;
  width?: number;
  height?: number;
}

/** The image route for a hash, scaled to a long edge when `edge` is given. */
export function imageUrl(urls: Urls, hash: string, edge?: number): string {
  return `${urls.base}-/image/${hash}${edge === undefined ? "" : `?w=${edge}`}`;
}

/** An attachment's `img` attributes: the original, and its scaled widths when its size is known. */
export function imageSource(urls: Urls, ref: ImageRef): ImageSource {
  const src = imageUrl(urls, ref.hash);
  const { width, height } = ref;
  if (!width || !height) return { src };
  const out: ImageSource = { src, width, height };
  if (!ref.media || !SCALABLE.has(ref.media)) return out;
  const long = Math.max(width, height);
  const candidates = VARIANT_EDGES.filter((e) => e < long).map(
    (e) => `${imageUrl(urls, ref.hash, e)} ${Math.round((width * e) / long)}w`,
  );
  if (candidates.length === 0) return out;
  out.srcset = [...candidates, `${src} ${width}w`].join(", ");
  return out;
}

/** The phone's breakpoint (tokens.css, `NARROW` in Workspace.tsx): images span the screen. */
const PHONE = "(max-width: 900px) 100vw";
/** The text's column (`--tempra-column-text`) and a wide figure's (`--tempra-figure-wide`). */
const COLUMN = 620;
const WIDE = 960;

/**
 * The `sizes` of a figure's images, as prose.css lays them out: the text's column, a wide figure's
 * reach, the page for a full one, a group's share of its row, and a width from the markup as a cap;
 * the whole screen on a phone (a group stacks there).
 */
export function figureSizes(spec: FigureSpec | null, count = 1): string {
  if (spec?.layout === "full") return "100vw";
  let reach: number = spec?.layout === "wide" ? WIDE : COLUMN;
  if (spec?.width?.unit === "px") reach = Math.min(reach, spec.width.value);
  else if (spec?.width?.unit === "%") reach = Math.round((reach * spec.width.value) / 100);
  if (count > 1) reach = Math.round(reach / count);
  return `${PHONE}, ${reach}px`;
}

/** The full-screen view: as wide as the window. */
export const LIGHTBOX_SIZES = "100vw";
