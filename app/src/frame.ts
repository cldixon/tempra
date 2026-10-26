/*
 * The app's frame (take 4, TEMPRA-113; tempra-dev: app/workspace): what pages and the frame
 * share. Workspace.svelte draws it and provides the Frame (frame.svelte.ts) to its pages.
 */

/** Where the open page is in its library: a file, a folder, or one of the library's views. */
export interface Place {
  file: string | null;
  dir: string | null;
  view:
    | "home"
    | "activity"
    | "settings"
    | "transfer"
    | "recovery"
    | "connect"
    | "delete"
    | "members"
    | null;
}

/** Under this width the sidebar is a drawer behind the top bar (the phone layout). */
export const NARROW = "(max-width: 900px)";

/** The library's settings pages: they get the settings sidebar, not the library's. */
export const SETTINGS_VIEWS: ReadonlySet<Place["view"]> = new Set([
  "settings",
  "transfer",
  "recovery",
  "connect",
  "delete",
  "members",
]);

/** The account's pages: the library list and the Inbox, or the account's settings. */
export type AccountPage =
  | "libraries"
  | "inbox"
  | "welcome"
  | "account"
  | "notifications"
  | "agents"
  | "invitations";
