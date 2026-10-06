/**
 * Comment anchors (tempra-dev: app/comments): a quote selector over a document's text
 * ({@link docText}), tied to the block it started in, resolved against whatever version of the
 * body is being shown. Shared by the Worker (which makes selectors and resolves them for agents)
 * and the app (which resolves them against the body on screen). No Wordgard.
 */
import type { DocText } from "./text";

/** How much text either side of the quote is kept to tell repeated quotes apart. */
export const CONTEXT = 32;

/** Longest quote kept; a longer selection is refused rather than cut. */
export const MAX_QUOTE = 2000;

export interface QuoteSelector {
  /** The quoted text. */
  quote: string;
  /** Up to CONTEXT characters before it, and after it, when it was made. */
  prefix: string;
  suffix: string;
  /** Where it started, in the text at the version it was made on. */
  from: number;
  /** The block it started in, and how far into that block's text: the best hint while it lives. */
  block: string | null;
  offset: number;
}

export interface Located {
  from: number;
  to: number;
}

/** The selector for `text.slice(from, to)`. */
export function selectorAt(doc: DocText, from: number, to: number): QuoteSelector {
  const { text } = doc;
  const tb = doc.blocks.find((b) => from >= b.from && from <= b.to);
  return {
    quote: text.slice(from, to),
    prefix: text.slice(Math.max(0, from - CONTEXT), from),
    suffix: text.slice(to, to + CONTEXT),
    from,
    block: tb?.block ?? null,
    offset: tb ? from - tb.from : 0,
  };
}

/** Every start of `quote` in `body`, up to `max` of them. */
export function occurrences(body: string, quote: string, max = 1000): number[] {
  const out: number[] = [];
  if (!quote) return out;
  let at = body.indexOf(quote);
  while (at !== -1 && out.length < max) {
    out.push(at);
    at = body.indexOf(quote, at + 1);
  }
  return out;
}

/** How many characters before `at` match the end of `prefix`, and after `end` the start of `suffix`. */
function contextScore(body: string, at: number, end: number, sel: QuoteSelector): number {
  let score = 0;
  for (let i = 1; i <= sel.prefix.length && at - i >= 0; i++) {
    if (body[at - i] !== sel.prefix[sel.prefix.length - i]) break;
    score++;
  }
  for (let i = 0; i < sel.suffix.length && end + i < body.length; i++) {
    if (body[end + i] !== sel.suffix[i]) break;
    score++;
  }
  return score;
}

/**
 * Where a selector's quote is in a document's text: the occurrence whose surroundings match best,
 * then the one nearest where it was (in its block, while the block lives). Null when the quote is
 * gone (the thread is outdated).
 */
export function locate(doc: DocText, sel: QuoteSelector): Located | null {
  const body = doc.text;
  const tb = sel.block === null ? undefined : doc.blocks.find((b) => b.block === sel.block);
  const hint = tb ? tb.from + sel.offset : sel.from;
  const starts = occurrences(body, sel.quote);
  let best: Located | null = null;
  let bestScore = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const at of starts) {
    const end = at + sel.quote.length;
    const score = contextScore(body, at, end, sel);
    const distance = Math.abs(at - hint);
    if (score > bestScore || (score === bestScore && distance < bestDistance)) {
      best = { from: at, to: end };
      bestScore = score;
      bestDistance = distance;
    }
  }
  return best;
}
