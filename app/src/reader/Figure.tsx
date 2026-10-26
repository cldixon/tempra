/**
 * Figures in the reader (tempra-dev: app/reader, Figures): an image alone in its paragraph, drawn
 * with a caption ("Figure n." and its title, else its alt text), opening the full-screen view
 * (Lightbox.tsx) when clicked; an image that fails to load as a quiet box saying so.
 *
 * The image is the paragraph's one atom: whatever is drawn for it (a button, the image, the box)
 * is one element marked `data-atom`, so it counts one character as `docText` does. The caption sits
 * outside the paragraph's `data-text` element and is marked `data-skip`: it is not the document's
 * text, so selections, comment anchors and the diff never count it.
 *
 * Figure markup (`:::figure`, tempra-dev: app/media) draws one to four images in one figure
 * (FigureBox): each image still one atom and one figure in the numbering, a group's images side by
 * side with their titles as small labels (`data-skip`), and one caption, the directive's label.
 *
 * An external image (hotlinked from another site, TEMPRA-163; tempra-dev: app/media) is drawn as
 * any other, with a quiet line under its caption naming the site ("From example.com"); its broken
 * box says it is external, and an inline one names the site in its tooltip.
 */
import type { FigureSpec } from "@tempra/editor";
import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Icon } from "../chrome";
import { figureSizes, type ImageSource } from "../images";
import type { Figure, ImageFigure } from "./prepare";

/** Opens the full-screen view at figure `n`; null where the reader offers none. */
export const OpenFigure = createContext<((n: number) => void) | null>(null);

/** A figure's caption: its number, then its text when it has one. Not part of the text. */
export function Caption({ figure, id }: { figure: Figure; id?: string }) {
  return (
    <figcaption data-skip="" id={id}>
      <span className="figure-number">Figure {figure.n}.</span>
      {figure.caption && ` ${figure.caption}`}
      {figure.kind === "image" && <FromHosts figures={[figure]} />}
    </figcaption>
  );
}

/** The quiet line under a caption naming where external images load from: "From example.com". */
export function FromHosts({ figures }: { figures: ImageFigure[] }) {
  const hosts = [...new Set(figures.map((f) => f.host).filter((h) => h !== null))];
  if (hosts.length === 0) return null;
  return <span className="figure-source">From {hosts.join(", ")}</span>;
}

/** "Figure 3.", or for a group "Figures 3 and 4." and "Figures 3–5.": each image counts one. */
export function figureNumber(first: number, count: number): string {
  if (count <= 1) return `Figure ${first}.`;
  const last = first + count - 1;
  return count === 2 ? `Figures ${first} and ${last}.` : `Figures ${first}–${last}.`;
}

/**
 * The frame of a figure drawn from its markup (`:::figure`, tempra-dev: app/media): its placement,
 * frame and group as classes (prose.css), and its width as `--figure-width`, set through the
 * CSSOM, as the reader's popovers set `--float-x`, so no style attribute is written (CSP).
 */
export function FigureBox(props: {
  spec: FigureSpec;
  count: number;
  block: string | undefined;
  children: ReactNode;
}) {
  const { spec, count } = props;
  const ref = useRef<HTMLElement>(null);
  const width = spec.width ? `${spec.width.value}${spec.width.unit}` : null;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (width) el.style.setProperty("--figure-width", width);
    else el.style.removeProperty("--figure-width");
  }, [width]);
  const cls = [
    "figure",
    spec.layout !== "column" ? `figure-${spec.layout}` : "",
    spec.frame ? "figure-framed" : "",
    width ? "figure-sized" : "",
    count > 1 ? `figure-group figure-n-${count}` : "",
  ];
  return (
    <figure ref={ref} className={cls.filter(Boolean).join(" ")} data-block={props.block}>
      {props.children}
    </figure>
  );
}

/** What an image can't show: the box that keeps its place, saying why, its path and alt text. */
export function BrokenImage({ figure, atom }: { figure: ImageFigure; atom?: boolean }) {
  const where = figure.path ?? figure.url;
  const what = figure.host ? `This external image from ${figure.host}` : "This image";
  return (
    <span
      className="figure-broken"
      data-atom={atom ? "" : undefined}
      role="img"
      aria-label={`${what} can't be shown: ${figure.alt || where}`}
    >
      <Icon name="broken" size={20} />
      <span className="figure-broken-title">This image can't be shown</span>
      {figure.host && <span>An external image from {figure.host}</span>}
      <span>{where}</span>
      {figure.alt && <span>Alt text: “{figure.alt}”</span>}
    </span>
  );
}

/** The accessible name of an image's enlarge button. */
export const enlargeName = (f: ImageFigure) =>
  `Enlarge image: ${f.alt || f.caption || f.path || f.url}`;

/**
 * An image from its source (TEMPRA-162): the stored width and height, so its box is reserved
 * before it loads (a quiet grey box, `.image-loading`, until it has), and its candidates with the
 * `sizes` of where it is drawn. Without a known size, just the original.
 */
export function Img(props: {
  source: ImageSource;
  alt: string;
  sizes?: string;
  title?: string;
  lazy?: boolean;
  atom?: boolean;
  onLoad?(img: HTMLImageElement): void;
  onError(): void;
}) {
  const { source } = props;
  const [loaded, setLoaded] = useState<string | null>(null);
  const sized = source.width !== undefined && source.height !== undefined;
  return (
    <img
      data-atom={props.atom ? "" : undefined}
      className={sized && loaded !== source.src ? "image-loading" : undefined}
      src={source.src}
      srcSet={source.srcset}
      sizes={source.srcset ? props.sizes : undefined}
      width={source.width}
      height={source.height}
      alt={props.alt}
      title={props.title}
      loading={props.lazy === false ? undefined : "lazy"}
      decoding="async"
      onLoad={(e) => {
        setLoaded(source.src);
        props.onLoad?.(e.currentTarget);
      }}
      onError={props.onError}
    />
  );
}

/** A figure's image: a button opening the full-screen view, or the broken box once it fails. */
export function FigureImage({ figure }: { figure: ImageFigure }) {
  const open = useContext(OpenFigure);
  const [failed, setFailed] = useState<string | null>(null);
  const { source } = figure;
  if (source === null || failed === source.src) return <BrokenImage figure={figure} atom />;
  const img = (
    <Img
      source={source}
      alt={figure.alt}
      sizes={figureSizes(figure.markup?.spec ?? null, figure.markup?.figures.length ?? 1)}
      onError={() => setFailed(source.src)}
    />
  );
  return (
    <span className="figure-media" data-atom="">
      {open ? (
        <button
          type="button"
          className="figure-open"
          aria-label={enlargeName(figure)}
          onClick={(e) => {
            // Opening a figure is not a click on the text (no thread to open or close).
            e.stopPropagation();
            open(figure.n);
          }}
        >
          {img}
        </button>
      ) : (
        img
      )}
    </span>
  );
}

/** An image in running text: stays inline, with no caption; its alt text if it fails to load. */
export function InlineImage(props: {
  source: ImageSource;
  alt: string;
  title: string | null;
  host?: string | null;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const from = props.host ? `From ${props.host}` : null;
  if (failed === props.source.src) {
    return (
      <span
        className="image-broken"
        data-atom=""
        title={
          props.host
            ? `This external image from ${props.host} can't be shown`
            : "This image can't be shown"
        }
      >
        {props.alt || "image"}
      </span>
    );
  }
  const title = props.title?.trim() || null;
  return (
    <Img
      atom
      source={props.source}
      alt={props.alt}
      title={title && from ? `${title} (${from.toLowerCase()})` : (title ?? from ?? undefined)}
      sizes={figureSizes(null)}
      onError={() => setFailed(props.source.src)}
    />
  );
}
