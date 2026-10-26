import type { Snippet } from "svelte";

/** What a confirmation asks: a title, a line or two on what happens, and the action's label. */
export interface Ask {
  title: string;
  body: string | Snippet;
  action: string;
  run(): unknown;
}

/**
 * A confirmation before something that cannot be taken back (removing a member, leaving,
 * revoking a token): `confirm(ask)` opens the dialog, and the action runs only from its button.
 * The page renders `<ConfirmDialog asking={c} />` once.
 */
export function useConfirm() {
  let ask = $state.raw<Ask | null>(null);
  return {
    get ask() {
      return ask;
    },
    confirm(a: Ask) {
      ask = a;
    },
    close() {
      ask = null;
    },
  };
}

export type Confirming = ReturnType<typeof useConfirm>;
