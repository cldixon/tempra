/**
 * The full-screen view of a concept's figures (tempra-dev: app/reader, Figures): over the app on
 * the ground colour, the image (or the diagram, drawn again at the view's size) as large as fits,
 * previous and next through the concept's figures, Escape to close. For an image, "Open original"
 * and "Download" as pills, and beneath the caption a quiet line: its path, size and who added it,
 * asked of the page when the view opens (`FigureView.describe`); an external image shows its URL.
 *
 * A modal <dialog> (showModal: the top layer, focus kept inside, Escape), its look in reader.css.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../chrome";
import { useDiagram } from "./Diagram";
import { BrokenImage } from "./Figure";
import type { DiagramFigure, Figure, ImageFigure } from "./prepare";

/** What the page knows about an image in the library, for the line under it. All optional. */
export interface ImageFacts {
  /** Its size in bytes. */
  size?: number | null;
  /** Its media type. */
  media?: string | null;
  /** Who added the current version (a name or handle as the page shows people). */
  by?: string | null;
  /** When, as an ISO 8601 datetime. */
  at?: string | null;
}

/** What the reader's page gives the full-screen view. Without it the view still works. */
export interface FigureView {
  /** The concept's title, shown in the view's header before "Figure n of m". */
  title?: string;
  /** Facts about an image at a library path, loaded when the view shows it. */
  describe?(path: string): Promise<ImageFacts | null>;
}

/** Bytes in a few characters: "316 KB", "2.1 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** An image figure's quiet line: path (or URL), size, who added it and when. */
export function factsLine(f: ImageFigure, facts: ImageFacts | null): string {
  const parts = [f.path ?? f.url];
  if (facts?.size != null) parts.push(formatSize(facts.size));
  if (facts?.by) {
    const when = facts.at ? new Date(facts.at) : null;
    const day =
      when && !Number.isNaN(when.getTime())
        ? `, ${when.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
        : "";
    parts.push(`added by ${facts.by}${day}`);
  }
  return parts.join(" · ");
}

function ImageStage({ figure }: { figure: ImageFigure }) {
  const [failed, setFailed] = useState<string | null>(null);
  const { src } = figure;
  if (src === null || failed === src) return <BrokenImage figure={figure} />;
  return <img src={src} alt={figure.alt} onError={() => setFailed(src)} />;
}

function DiagramStage({ figure }: { figure: DiagramFigure }) {
  const host = useRef<HTMLDivElement>(null);
  const failure = useDiagram(host, figure.source, `lb${figure.n}-`);
  if (failure !== null) {
    return (
      <pre className="lightbox-source">
        <code>{figure.source}</code>
      </pre>
    );
  }
  return <div ref={host} className="lightbox-diagram" role="img" aria-label="Diagram" />;
}

export function Lightbox(props: {
  figures: readonly Figure[];
  /** The figure shown (its number, from 1). */
  at: number;
  view?: FigureView;
  onMove(n: number): void;
  onClose(): void;
}) {
  const { figures, at, view, onMove, onClose } = props;
  const figure = figures[at - 1];
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const label = useId();
  const caption = useId();

  // Opened modally once, closed (and the focus given back) when it goes.
  useLayoutEffect(() => {
    const el = dialog.current;
    const before = el?.ownerDocument.activeElement as HTMLElement | null;
    if (el && !el.open) {
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
    }
    close.current?.focus();
    return () => {
      if (el?.open && typeof el.close === "function") el.close();
      before?.focus?.();
    };
  }, []);

  // The facts under an image in the library, asked once per path.
  const describe = view?.describe;
  const cache = useRef(new Map<string, ImageFacts | null>());
  const [facts, setFacts] = useState<{ path: string; facts: ImageFacts | null } | null>(null);
  const path = figure?.kind === "image" ? figure.path : null;
  useEffect(() => {
    if (path === null || !describe) return;
    if (cache.current.has(path)) {
      setFacts({ path, facts: cache.current.get(path) ?? null });
      return;
    }
    let live = true;
    describe(path).then(
      (f) => {
        cache.current.set(path, f);
        if (live) setFacts({ path, facts: f });
      },
      () => {
        if (live) setFacts({ path, facts: null });
      },
    );
    return () => {
      live = false;
    };
  }, [path, describe]);

  if (!figure) return null;
  const total = figures.length;
  const prev = at > 1 ? at - 1 : null;
  const next = at < total ? at + 1 : null;

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      // The view's own: no page-wide Escape (a drawer, a menu) acts on it too.
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowLeft" && prev !== null) {
      e.preventDefault();
      onMove(prev);
    } else if (e.key === "ArrowRight" && next !== null) {
      e.preventDefault();
      onMove(next);
    }
  };

  const image = figure.kind === "image" ? figure : null;
  const line = image ? factsLine(image, facts?.path === image.path ? facts.facts : null) : null;
  return (
    <dialog
      ref={dialog}
      className="lightbox"
      aria-labelledby={label}
      aria-describedby={figure.caption ? caption : undefined}
      onKeyDown={keys}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="lightbox-head">
        {view?.title && <span className="lightbox-where">{view.title}</span>}
        <span id={label}>
          Figure {figure.n} of {total}
        </span>
        <span className="lightbox-actions">
          {image?.src && (
            <>
              <a href={image.src} target="_blank" rel="noopener noreferrer">
                Open original
              </a>
              <a href={image.src} download="">
                Download
              </a>
            </>
          )}
          <button
            ref={close}
            type="button"
            className="lightbox-round"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </span>
      </header>
      <div className="lightbox-stage">
        {total > 1 && (
          <button
            type="button"
            className="lightbox-round lightbox-prev"
            aria-label="Previous figure"
            disabled={prev === null}
            onClick={() => prev !== null && onMove(prev)}
          >
            <Icon name="previous" size={18} />
          </button>
        )}
        <div className="lightbox-figure" key={figure.n}>
          {figure.kind === "image" ? (
            <ImageStage figure={figure} />
          ) : (
            <DiagramStage figure={figure} />
          )}
        </div>
        {total > 1 && (
          <button
            type="button"
            className="lightbox-round lightbox-next"
            aria-label="Next figure"
            disabled={next === null}
            onClick={() => next !== null && onMove(next)}
          >
            <Icon name="next" size={18} />
          </button>
        )}
      </div>
      <footer className="lightbox-foot">
        {figure.caption && (
          <p className="lightbox-caption" id={caption}>
            {figure.caption}
          </p>
        )}
        <p className="lightbox-facts">
          {line && <span>{line}</span>}
          <span className="lightbox-hint">
            Esc to close{total > 1 ? ", ← → between figures" : ""}
          </span>
        </p>
      </footer>
    </dialog>
  );
}
