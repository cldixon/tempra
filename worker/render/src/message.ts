/**
 * Pele's error as one short line (TEMPRA-184), for `diagram_unrendered` lint, the `render` tool and
 * `read`'s diagrams alike. Pele's parse errors take four lines: a header naming the line, the
 * source line, a caret under the column, then what it expected ("Expecting 'NODE_STRING', got
 * 'TAGEND'"); a lexical error puts its reason in the header ("Lexical error on line 2.
 * Unrecognized text."). The line and column travel beside the message, so the place, the source
 * and the caret are dropped and what is left is the reason. Free of Pele and Worker APIs, so the
 * main Worker can name the format without importing Pele.
 */

/** Moves when the message's shape does, so verdicts kept in the old shape are asked for again. */
export const PELE_MESSAGE_FORMAT = 2;

/** The longest message kept, in characters, the ellipsis included. */
export const MAX_PELE_MESSAGE = 200;

const CARET = /^\s*-*\^\s*$/;
const PLACE = / on line \d+/;
const BARE_HEADER = /^(?:Parse|Lexical) error:?$/;

export function peleMessage(raw: string): string {
  const lines = raw.split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // The source line Pele quotes stands just above its caret.
    if (CARET.test(line) || (i > 0 && CARET.test(lines[i + 1] ?? ""))) continue;
    const text = (i === 0 ? line.replace(PLACE, "") : line).replace(/\s+/g, " ").trim();
    if (text) kept.push(text);
  }
  if (kept.length > 1 && BARE_HEADER.test(kept[0] ?? "")) kept.shift();
  const message = kept.join(" ") || raw.replace(/\s+/g, " ").trim();
  if (message.length <= MAX_PELE_MESSAGE) return message;
  return `${message.slice(0, MAX_PELE_MESSAGE - 1).trimEnd()}…`;
}
