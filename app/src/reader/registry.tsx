/**
 * Rich blocks (tempra-dev: app/reader, The registry): a fence's language, or a block's node type,
 * mapped to a React component that draws it in place of the default. Diagrams are the first entry
 * (`code.mermaid`, Diagram.tsx: Pele, TEMPRA-98); raw HTML could be `node.html`.
 *
 * A component receives the node, its block ID and, for a textblock, its offset in the document's
 * text, plus `text`: the node's text drawn by the reader's rules (with the verification diff in
 * it). Comments anchor in what the reader counts, so a component either puts `text` inside an
 * element carrying `data-text={offset}` (as the default code block does) or marks what it draws
 * `data-opaque`, which the selection toolbar does not offer Comment on. A block that is a figure
 * (prepare.ts: a diagram's fence) gets its `figure` for the caption and the full-screen view.
 */
import type { Code, RootContent } from "mdast";
import type { ReactNode } from "react";
import type { MediaKind } from "../images";
import { Diagram } from "./Diagram";
import { AudioFigure, type MediaProps, PdfFigure, VideoFigure } from "./Media";
import type { Figure } from "./prepare";

export interface BlockProps<N> {
  node: N;
  /** The block's ID in the stored tree; draw it as `data-block`. */
  id: string | undefined;
  /** Where the block's text starts in the document's text, for `data-text`; undefined outside it. */
  offset: number | undefined;
  /** The block's text as the reader draws it, ready to place inside the `data-text` element. */
  text: ReactNode;
  /** The figure this block is (a diagram's number and caption), when it is one. */
  figure?: Figure;
}

export type BlockComponent<N> = (props: BlockProps<N>) => ReactNode;

/** Code fences by language (as written after the fence, lowercased). */
export const code: Record<string, BlockComponent<Code>> = { mermaid: Diagram };

/** Blocks by node type, ahead of the default rendering (e.g. `html` for raw HTML blocks). */
export const node: Record<string, BlockComponent<RootContent>> = {};

/**
 * An image node's figure by what its attachment is (TEMPRA-164; Media.tsx): video, audio and PDF
 * in place of the image, each still the paragraph's one atom. An image, or a file the library
 * does not know the type of, is drawn as an image (Figure.tsx).
 */
export const media: Partial<Record<MediaKind, (props: MediaProps) => ReactNode>> = {
  video: VideoFigure,
  audio: AudioFigure,
  pdf: PdfFigure,
};

/** The default code block: the text, with the fence's language as a quiet label (CSS only). */
export function CodeBlock({ node, id, offset, text }: BlockProps<Code>) {
  return (
    <pre data-block={id} data-text={offset} data-lang={node.lang ?? undefined}>
      <code>{text}</code>
    </pre>
  );
}
