import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
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
  const ref = useModal(props.open);
  const titleId = useId();
  const { open, onClose } = props;
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

/**
 * Opens and closes a `<dialog>` as a modal with `open`; on opening, the element marked
 * `data-autofocus` takes the focus, if there is one.
 */
function useModal(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open && typeof d.showModal === "function") {
      d.showModal();
      d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);
  return ref;
}

/**
 * A dialog that makes something (a new library): anchored high over the page, its context and
 * what it makes at the top ("@ann › New library"), then the form's own fields (a large borderless
 * name, a description; `.compose-title`, `.compose-text`), a row of smaller fields, and the
 * action at the foot. Ctrl/Cmd+Enter submits; Escape, × or a click beside it cancels.
 */
export function ComposeDialog(props: {
  open: boolean;
  onClose(): void;
  /** Where the new thing goes, shown as a chip before the title. */
  context: ReactNode;
  title: string;
  action: string;
  busy?: boolean;
  error?: string | null;
  onSubmit(e: FormEvent<HTMLFormElement>): void;
  /** The row under the main fields: small labelled fields (`.compose-field`). */
  fields?: ReactNode;
  children: ReactNode;
}) {
  const ref = useModal(props.open);
  const titleId = useId();
  const { open, onClose } = props;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes it (the browser's cancel).
    <dialog
      ref={ref}
      className="dialog compose"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <form
          className="compose-form"
          onSubmit={props.onSubmit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              e.currentTarget.requestSubmit();
            }
          }}
        >
          <div className="compose-head">
            <span className="compose-context">{props.context}</span>
            <Icon name="chevron" />
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
          <div className="compose-body">{props.children}</div>
          {props.fields && <div className="compose-fields">{props.fields}</div>}
          {props.error && (
            <p className="notice" role="alert">
              {props.error}
            </p>
          )}
          <div className="compose-foot">
            <button type="button" className="ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={props.busy}>
              {props.action}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
