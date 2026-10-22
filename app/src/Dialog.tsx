import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Icon } from "./chrome";

/** What a confirmation asks: a title, a line or two on what happens, and the action's label. */
export interface Ask {
  title: string;
  body: ReactNode;
  action: string;
  run(): unknown;
}

/**
 * A confirmation before something that cannot be taken back (removing a member, leaving,
 * revoking a token): `confirm(ask)` opens the dialog, and the action runs only from its button.
 * The page renders `dialog` once.
 */
export function useConfirm() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const close = () => setAsk(null);
  const dialog = (
    <Dialog title={ask?.title ?? ""} open={ask !== null} onClose={close}>
      {ask && (
        <>
          <div className="confirm-body">{ask.body}</div>
          <p className="actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                close();
                ask.run();
              }}
            >
              {ask.action}
            </button>
            <button type="button" onClick={close}>
              Cancel
            </button>
          </p>
        </>
      )}
    </Dialog>
  );
  return { confirm: setAsk, dialog };
}

/**
 * A small modal dialog in the top layer (a concept's properties, its agent notes, all its
 * versions): a title, a close button, its content. Escape, the close button or a click on the
 * backdrop closes it, and the focus goes back where it was.
 */
export function Dialog(props: {
  title: string;
  open: boolean;
  onClose(): void;
  wide?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { open, onClose } = props;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open && typeof d.showModal === "function") d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  return (
    // A click on the backdrop lands on the dialog itself, outside its content: it closes.
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes it (the browser's cancel).
    <dialog
      ref={ref}
      className={props.wide ? "dialog wide" : "dialog"}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="dialog-box">
          <div className="dialog-head">
            <h2 id={titleId}>{props.title}</h2>
            <button
              type="button"
              className="icon-button touch"
              aria-label="Close"
              title="Close"
              onClick={onClose}
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="dialog-body">{props.children}</div>
        </div>
      )}
    </dialog>
  );
}
