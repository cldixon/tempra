/*
 * The app's chrome (take 2, TEMPRA-53): the icons (Icon.svelte), menus (Menu.svelte) and the
 * avatar shared by the workspace and the account pages. Every look is in @tempra/design
 * (workspace.css); nothing here is styled.
 */

/** Two letters for a handle: "cl_dixon" → "CD", "sam" → "SA". */
export function initials(handle: string): string {
  const parts = handle.split(/[_\-.\s]+/).filter(Boolean);
  const letters =
    parts.length >= 2 ? (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "") : handle.slice(0, 2);
  return letters.toUpperCase() || "?";
}

/**
 * Two letters for a name (TEMPRA-54): the first letters of its first and last words ("Ann Lee
 * Smith" → "AS"), one for a one-word name ("Ann" → "A").
 */
export function nameInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = (w: string | undefined) => (w ? (Array.from(w)[0] ?? "") : "");
  const letters =
    words.length >= 2 ? first(words[0]) + first(words[words.length - 1]) : first(words[0]);
  return letters.toUpperCase() || "?";
}

/** A person's initials: from their name when they gave one, else from their handle. */
export const personInitials = (handle: string, name?: string | null) =>
  name?.trim() ? nameInitials(name) : initials(handle);
