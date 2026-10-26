/**
 * Figures in the reader (tempra-dev: app/reader, Figures): what their components share. The
 * components are Caption, FromHosts, FigureBox, BrokenImage, Img, FigureImage and InlineImage
 * (`*.svelte` beside this file); see FigureImage.svelte for how a figure counts in the text.
 */
import type { ImageFigure } from "./prepare";

/** "Figure 3.", or for a group "Figures 3 and 4." and "Figures 3–5.": each image counts one. */
export function figureNumber(first: number, count: number): string {
  if (count <= 1) return `Figure ${first}.`;
  const last = first + count - 1;
  return count === 2 ? `Figures ${first} and ${last}.` : `Figures ${first}–${last}.`;
}

/** The accessible name of an image's enlarge button. */
export const enlargeName = (f: ImageFigure) =>
  `Enlarge image: ${f.alt || f.caption || f.path || f.url}`;
