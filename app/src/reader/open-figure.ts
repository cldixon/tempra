/**
 * Opens the full-screen view at figure `n` (Lightbox.svelte): the reader provides it to the
 * figures in its body; where nothing does (a body drawn outside the reader), figures offer none.
 */
import { getContext, setContext } from "svelte";

const KEY = Symbol("open-figure");

type OpenFigure = (n: number) => void;

/** Provides the full-screen view to the figures inside this component (Reader.svelte). */
export function provideOpenFigure(open: OpenFigure) {
  setContext(KEY, open);
}

/** The full-screen view's opener, or null where the reader offers none. */
export function useOpenFigure(): OpenFigure | null {
  return getContext<OpenFigure | undefined>(KEY) ?? null;
}

/** The same context for `mount(…, { context })`, as the tests mount a body on its own. */
export function openFigureContext(open: OpenFigure): Map<unknown, unknown> {
  return new Map([[KEY, open]]);
}
