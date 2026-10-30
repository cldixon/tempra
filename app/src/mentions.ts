/*
 * Mentions in the comment box (TEMPRA-73): typing @ offers the people who can reach the library
 * (its owner and members) and its managed agent once there is one; the server resolves what was
 * written when the comment is posted. Looks come from the menu list in @tempra/design. The box is
 * `MentionArea.svelte`; the handles it offers come from `useMentionable` (mentions.svelte.ts).
 */

/** The @word being typed just before the caret, if any: where it starts and what it says. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|[\s(])@([a-z0-9_-]*)$/i.exec(text.slice(0, caret));
  if (!m) return null;
  const query = m[2] ?? "";
  return { start: caret - query.length - 1, query: query.toLowerCase() };
}

/** The handles offered for a query: those starting with it, the exact one last, a few at most. */
export function offered(people: string[], query: string): string[] {
  return people
    .filter((h, i) => people.indexOf(h) === i && h.toLowerCase().startsWith(query))
    .sort((a, b) => Number(a === query) - Number(b === query) || a.localeCompare(b))
    .slice(0, 6);
}

/** A key event's own parts, as the comment box reads them. */
type Keyed = Pick<KeyboardEvent, "key" | "shiftKey" | "isComposing" | "keyCode">;

/** A key that is an input method's, mid-composition (229 is what Safari sends for its Enter). */
export const composing = (e: Keyed) => e.isComposing || e.keyCode === 229;

/**
 * Whether a key sends the comment (TEMPRA-223): Enter, Ctrl+Enter or Cmd+Enter does; Shift+Enter
 * is a new line, and an input method's Enter, mid-composition, is the method's.
 */
export const sendsComment = (e: Keyed) => e.key === "Enter" && !e.shiftKey && !composing(e);
