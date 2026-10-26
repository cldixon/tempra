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
