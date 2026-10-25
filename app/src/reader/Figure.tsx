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
import type { Figure, ImageFigure } from "./prepare";

/** Opens the full-screen view at figure `n`; null where the reader offers none. */
export const OpenFigure = createContext<((n: number) => void) | null>(null);

/** A figure's caption: its number, then its text when it has one. Not part of the text. */
export function Caption({ figure, id }: { figure: Figure; id?: string }) {
  return (
    <figcaption data-skip="" id={id}>
      <span className="figure-number">Figure {figure.n}.</span>
      {figure.caption && ` ${figure.caption}`}
    </figcaption>
  );
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
  return (
    <span
      className="figure-broken"
      data-atom={atom ? "" : undefined}
      role="img"
      aria-label={`This image can't be shown: ${figure.alt || where}`}
    >
      <Icon name="broken" size={20} />
      <span className="figure-broken-title">This image can't be shown</span>
      <span>{where}</span>
      {figure.alt && <span>Alt text: “{figure.alt}”</span>}
    </span>
  );
}

/** The accessible name of an image's enlarge button. */
export const enlargeName = (f: ImageFigure) =>
  `Enlarge image: ${f.alt || f.caption || f.path || f.url}`;

/** A figure's image: a button opening the full-screen view, or the broken box once it fails. */
export function FigureImage({ figure }: { figure: ImageFigure }) {
  const open = useContext(OpenFigure);
  const [failed, setFailed] = useState<string | null>(null);
  const { src } = figure;
  if (src === null || failed === src) return <BrokenImage figure={figure} atom />;
  const img = <img src={src} alt={figure.alt} loading="lazy" onError={() => setFailed(src)} />;
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
export function InlineImage(props: { src: string; alt: string; title: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === props.src) {
    return (
      <span className="image-broken" data-atom="" title="This image can't be shown">
        {props.alt || "image"}
      </span>
    );
  }
  return (
    <img
      data-atom=""
      src={props.src}
      alt={props.alt}
      title={props.title ?? undefined}
      loading="lazy"
      onError={() => setFailed(props.src)}
    />
  );
}
