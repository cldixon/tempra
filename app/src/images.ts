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
  /** Its size in bytes. */
  size?: number;
  /** Absent or null when not known. */
  width?: number | null;
  height?: number | null;
  /** A video's poster, the image attached beside it (`demo.poster.png`; TEMPRA-164). */
  poster?: ImageRef;
}

/**
 * What a figure is drawn as, by its media type (TEMPRA-164; tempra-dev: app/media, Kinds): an
 * image, a video or audio player, or a PDF's card. The reader's registry maps the others to their
 * components (reader/registry.ts, `media`).
 */
export type MediaKind = "image" | "video" | "audio" | "pdf";

export function mediaKind(media: string | null | undefined): MediaKind {
  const m = media?.toLowerCase() ?? "";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m === "application/pdf") return "pdf";
  return "image";
}

/** What an `img` is given: where it loads from, and when known its candidates and size. */
export interface ImageSource {
  src: string;
  srcset?: string;
  width?: number;
  height?: number;
  /** What it is, when the library knows its type; absent is an image. */
  kind?: MediaKind;
  /** Its size in bytes, when known (a PDF's card says it). */
  size?: number;
  /** A video's poster frame, from the image route. */
  poster?: string;
  /** Its attachment page (a PDF's Open). */
  page?: string;
  /** Its original as a download. */
  download?: string;
}

/** The image route for a hash, scaled to a long edge when `edge` is given. */
function imageUrl(urls: Urls, hash: string, edge?: number): string {
  return `${urls.base}-/image/${hash}${edge === undefined ? "" : `?w=${edge}`}`;
}

/** The media route for a video or audio file's hash, which serves ranges (TEMPRA-164). */
function mediaUrl(urls: Urls, hash: string): string {
  return `${urls.base}-/media/${hash}`;
}

/**
 * Where an attachment a figure shows loads from, by what it is: an image as `imageSource` has it;
 * a video or audio file from the media route, with a video's poster and stored size; a PDF as its
 * download, page and size, for its card. `path` is its library path, for the page and download.
 */
export function attachmentSource(urls: Urls, ref: ImageRef, path?: string): ImageSource {
  const kind = mediaKind(ref.media);
  if (kind === "image") return imageSource(urls, ref);
  const links = path
    ? { page: urls.pinned(undefined).file(path), download: urls.download(path) }
    : {};
  const out: ImageSource = { src: mediaUrl(urls, ref.hash), kind, ...links };
  if (ref.size !== undefined) out.size = ref.size;
  if (kind === "pdf") {
    out.src = links.download ?? urls.base;
    return out;
  }
  if (kind === "video") {
    if (ref.width && ref.height) {
      out.width = ref.width;
      out.height = ref.height;
    }
    if (ref.poster) out.poster = imageUrl(urls, ref.poster.hash);
  }
  return out;
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

/** The phone's breakpoint (tokens.css, `NARROW` in frame.ts): images span the screen. */
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
