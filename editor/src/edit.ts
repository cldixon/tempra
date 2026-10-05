/**
 * Editing a concept body (tempra-dev: app/editor): what the reader turns on when a person edits.
 * Wordgard's schema behaviour for the GFM blocks and marks the body uses (menu buttons, key
 * bindings, input rules), undo history, a menu bar, our own link and image handling (Tempra's
 * Link and Image types are not Wordgard's), and a listener for changes. DOM side only.
 */
import { Menu } from "wordgard/command";
import type { Mark as WgMark } from "wordgard/doc";
import { Dialog, KeyBinding, menuBar, Wordgard } from "wordgard/editor";
import { history } from "wordgard/history";
import {
  blockquote,
  bulletList,
  code,
  codeBlock,
  emphasis,
  heading,
  horizontalRule,
  orderedList,
  paragraph,
  strikethrough,
  strong,
} from "wordgard/schema";
import { GardState } from "wordgard/state";
import { Image, type ImageParam, Link, type LinkParam } from "./schema";

export interface EditOptions {
  /** Library paths to offer as link targets (concepts first), loaded when the dialog opens. */
  paths?(): Promise<readonly string[]> | readonly string[];
  /**
   * The link to write for what was typed or pasted as a target, built by the parser's own rules;
   * null refuses it (a scheme a browser must not follow, or nothing usable).
   */
  link?(raw: string): LinkParam | null;
  /** Stores an image file beside the concept; resolves to its bundle path and a URL to show it. */
  upload?(file: File): Promise<{ path: string; src: string }>;
  /** How many image uploads are on their way (a save waits for them). */
  onUploads?(pending: number): void;
  /** Something the person should know (an upload failed, a link was refused). */
  onError?(message: string): void;
  /** The body changed. */
  onChange?(): void;
}

/** The link mark under the selection (all of it), with the extent of that link. */
function linkAt(state: GardState): { mark: WgMark<LinkParam>; from: number; to: number } | null {
  const { from, to } = state.selection;
  const isLink = (m: WgMark) => m.type === Link;
  // The selection's own inline nodes: all inside one link, or none.
  let found: WgMark<LinkParam> | null = null;
  let all = true;
  state.doc.iterate(Math.max(0, from === to ? from - 1 : from), Math.max(to, from + 1), (node) => {
    if (!node.isInline) return;
    const m = node.marks.find(isLink) as WgMark<LinkParam> | undefined;
    if (m && (!found || m.eq(found))) found = found ?? m;
    else all = false;
  });
  const mark = all ? (found as WgMark<LinkParam> | null) : null;
  if (!mark) return null;
  // The link's extent: the run of inline nodes carrying the same mark around the selection.
  let start = -1;
  let end = -1;
  let runStart = -1;
  state.doc.iterate((node, pos) => {
    if (!node.isInline) return;
    if (node.marks.some((m: WgMark) => m.eq(mark))) {
      if (runStart < 0 || pos !== end) runStart = pos;
      end = pos + node.length;
      if (runStart <= from && end >= to && start < 0) start = runStart;
    } else if (start < 0) runStart = -1;
  });
  return start < 0 ? null : { mark, from: start, to: end };
}

/** A datalist of paths, kept in the editor's element for the link dialog's input. */
function pathList(wg: Wordgard, id: string, paths: readonly string[]) {
  let list = wg.dom.querySelector<HTMLDataListElement>(`datalist#${id}`);
  if (!list) {
    list = document.createElement("datalist");
    list.id = id;
    wg.dom.append(list);
  }
  list.replaceChildren(
    ...paths.map((p) => {
      const o = document.createElement("option");
      o.value = `/${p}`;
      return o;
    }),
  );
}

let lists = 0;

function linkCommand(opts: EditOptions) {
  const id = `wg-paths-${++lists}`;
  return (wg: Wordgard): boolean => {
    const current = linkAt(wg.state);
    if (current) {
      // A link under the selection or the caret: Link removes all of it.
      wg.dispatch({ changes: { from: current.from, to: current.to, remove: current.mark } });
      return true;
    }
    const { from, to } = wg.state.selection;
    if (from === to) return false;
    void Promise.resolve(opts.paths?.() ?? []).then((paths) => pathList(wg, id, paths));
    const dialog = Dialog.show(wg, {
      label: "Link to",
      input: { name: "url", list: id, placeholder: "/dir/concept.md or https://…" },
      submitLabel: "Link",
      class: "link-dialog",
    });
    void dialog.result.then((form) => {
      const field = form?.elements.namedItem("url") as HTMLInputElement | null;
      const raw = field?.value.trim() ?? "";
      if (!form || !raw) return;
      const param = opts.link ? opts.link(raw) : null;
      if (!param) {
        wg.dispatch({ effects: dialog.close });
        opts.onError?.(`Not linked: "${raw}" is not a link target a reader can follow.`);
        return;
      }
      wg.dispatch({ changes: { from, to, add: Link.of(param) }, effects: dialog.close });
    });
    return true;
  };
}

/** An editing session: its extensions, and close() once the reader stops editing. */
export interface Editing {
  extensions: GardState.Extension[];
  close(): void;
}

/** Everything the reader adds while a person edits. */
export function editing(opts: EditOptions): Editing {
  let open = true;
  /** Where each image on its way goes, kept in step with the edits made meanwhile. */
  const pending = new Set<{ at: number }>();
  const uploads = () => opts.onUploads?.(pending.size);

  const imageFiles = (wg: Wordgard, files: readonly File[], at: number) => {
    const upload = opts.upload;
    if (!upload) return false;
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return false;
    for (const file of images) {
      const spot = { at };
      pending.add(spot);
      uploads();
      upload(file).then(
        ({ path, src }) => {
          pending.delete(spot);
          uploads();
          if (!open || !wg.dom.isConnected) return;
          const param: ImageParam = {
            url: `/${path}`,
            alt: file.name.replace(/\.[^.]+$/, ""),
            title: null,
            src,
          };
          const pos = Math.min(spot.at, wg.state.doc.length);
          wg.dispatch({ changes: { from: pos, insert: [Image.of(param)] } });
        },
        (e: unknown) => {
          pending.delete(spot);
          uploads();
          if (open) opts.onError?.(`Could not upload ${file.name}: ${String(e)}`);
        },
      );
    }
    return true;
  };

  const link = linkCommand(opts);
  const linkButton = Menu.Button.define({
    label: "Link",
    description: "Link the selection (Ctrl/Cmd+K)",
    run: link,
    active: (state) => linkAt(state) !== null,
  });
  const extensions: GardState.Extension[] = [
    Wordgard.editable.of(true),
    GardState.readOnly.of(false),
    history(),
    paragraph(),
    heading(),
    blockquote(),
    bulletList(),
    orderedList(),
    codeBlock(),
    horizontalRule(),
    strong(),
    emphasis(),
    code(),
    strikethrough(),
    linkButton.extension,
    KeyBinding.of({ key: "Mod-k", run: link }).extension,
    menuBar(),
    Wordgard.pasteHandler.of((wg, event) =>
      imageFiles(wg, [...(event.clipboardData?.files ?? [])], wg.state.selection.from),
    ),
    Wordgard.dropHandler.of((wg, event, pos) =>
      imageFiles(wg, [...(event.dataTransfer?.files ?? [])], pos),
    ),
    Wordgard.updateListener.of((u) => {
      if (!u.docChanged) return;
      for (const spot of pending) spot.at = u.changes.mapPos(spot.at, 1);
      opts.onChange?.();
    }),
  ];
  return {
    extensions,
    close: () => {
      open = false;
      pending.clear();
      uploads();
    },
  };
}
