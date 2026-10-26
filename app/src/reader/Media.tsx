/**
 * Figures that are not images (TEMPRA-164; tempra-dev: app/media, How people see): the same
 * markdown as an image (`![A walkthrough](/x/demo.mp4 "Caption")`), drawn by what the attachment
 * is, through the reader's registry (registry.tsx, `media`):
 *
 * - a video (MP4, WebM): `<video controls preload="metadata">`, never autoplaying, its stored size
 *   when known and its poster when one is attached beside it (`demo.poster.png`), with an Enlarge
 *   button to play it in the full-screen view;
 * - audio (MP3, Ogg, WAV): `<audio controls>`;
 * - a PDF: a card with its name, type and size, Open (its attachment page) and Download; no
 *   embedded viewer.
 *
 * Each is the paragraph's one atom, as an image is: one element marked `data-atom`, counting one
 * character in `docText`, so comment anchors and the diff are unchanged. One that fails to play
 * is the broken box, saying so.
 */
import { type ReactNode, useContext, useState } from "react";
import { Icon } from "../chrome";
import type { ImageSource } from "../images";
import { formatSize } from "../ui";
import { baseName } from "../urls";
import { BrokenImage, OpenFigure } from "./Figure";
import type { ImageFigure } from "./prepare";

export interface MediaProps {
  figure: ImageFigure;
}

/** What a media figure is called to a screen reader: its alt text, else its caption or name. */
const nameOf = (f: ImageFigure) => f.alt || f.caption || (f.path ? baseName(f.path) : f.url);

/** Clicks on a player's controls are not clicks on the text (no thread to open or close). */
const own = (e: React.MouseEvent) => e.stopPropagation();

/** A video or audio element for a source; `onError` when it cannot be played. */
export function Player(props: {
  kind: "video" | "audio";
  source: ImageSource;
  name: string;
  onError(): void;
}) {
  const { source } = props;
  const fallback = (
    <a href={source.download ?? source.src} download="">
      Download
    </a>
  );
  // No captions are stored with an attachment yet: a track would have nothing to point to.
  return props.kind === "video" ? (
    // biome-ignore lint/a11y/useMediaCaption: no captions file exists for it yet
    <video
      controls
      preload="metadata"
      src={source.src}
      poster={source.poster}
      width={source.width}
      height={source.height}
      aria-label={props.name}
      onError={props.onError}
    >
      {fallback}
    </video>
  ) : (
    // biome-ignore lint/a11y/useMediaCaption: no transcript file exists for it yet
    <audio
      controls
      preload="metadata"
      src={source.src}
      aria-label={props.name}
      onError={props.onError}
    >
      {fallback}
    </audio>
  );
}

function MediaFigure({ figure, kind }: MediaProps & { kind: "video" | "audio" }) {
  const open = useContext(OpenFigure);
  const [failed, setFailed] = useState<string | null>(null);
  const { source } = figure;
  if (source === null || failed === source.src) return <BrokenImage figure={figure} atom />;
  const name = nameOf(figure);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only keeps the player's clicks its own
    // biome-ignore lint/a11y/useKeyWithClickEvents: the player handles its own keys
    <span className={`figure-media figure-${kind}`} data-atom="" onClick={own}>
      <Player kind={kind} source={source} name={name} onError={() => setFailed(source.src)} />
      {open && kind === "video" && (
        <span className="figure-tools" data-skip="">
          <button
            type="button"
            className="figure-enlarge"
            aria-label={`Enlarge video: ${name}`}
            onClick={() => open(figure.n)}
          >
            <Icon name="enlarge" size={14} />
          </button>
        </span>
      )}
    </span>
  );
}

export function VideoFigure({ figure }: MediaProps) {
  return <MediaFigure figure={figure} kind="video" />;
}

export function AudioFigure({ figure }: MediaProps) {
  return <MediaFigure figure={figure} kind="audio" />;
}

/** A PDF's card: its name, type and size, Open and Download. Also the full-screen view's. */
export function PdfCard({ figure, atom }: MediaProps & { atom?: boolean }): ReactNode {
  const { source } = figure;
  if (source === null) return <BrokenImage figure={figure} atom={atom} />;
  const name = figure.path ? baseName(figure.path) : figure.url;
  return (
    <span className="figure-pdf" data-atom={atom ? "" : undefined}>
      <Icon name="file" size={24} />
      <span className="figure-pdf-about">
        <span className="figure-pdf-name">{name}</span>
        <span className="figure-pdf-meta">
          PDF document{source.size !== undefined ? ` · ${formatSize(source.size)}` : ""}
        </span>
      </span>
      <span className="figure-pdf-actions">
        {source.page && (
          <a className="button" href={source.page}>
            Open
          </a>
        )}
        <a className="button" href={source.download ?? source.src} download={name}>
          <Icon name="download" /> Download
        </a>
      </span>
    </span>
  );
}

export function PdfFigure({ figure }: MediaProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only keeps the card's clicks its own
    // biome-ignore lint/a11y/useKeyWithClickEvents: the card's links handle their own keys
    <span className="figure-media" data-atom="" onClick={own}>
      <PdfCard figure={figure} />
    </span>
  );
}
