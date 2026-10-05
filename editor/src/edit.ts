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
  /** Turns what was typed or pasted as a link target into the target to write (`/dir/x.md`). */
  linkTarget?(raw: string): string;
  /** Stores an image file beside the concept; resolves to its bundle path and a URL to show it. */
  upload?(file: File): Promise<{ path: string; src: string }>;
  /** The body changed. */
  onChange?(): void;
}

/** The link mark covering the whole selection, if one does. */
function linkAt(state: GardState): WgMark<LinkParam> | null {
  const { from, to } = state.selection;
  let found: WgMark<LinkParam> | null = null;
  let all = true;
  state.doc.iterate(from, Math.max(to, from + 1), (node) => {
    if (!node.isInline) return;
    const m = node.marks.find((x: WgMark) => x.type === Link) as WgMark<LinkParam> | undefined;
    if (m) found = found ?? m;
    else all = false;
  });
  return all ? found : null;
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
    const { from, to } = wg.state.selection;
    const current = linkAt(wg.state);
    if (current) {
      // A link under the selection: Link removes it.
      wg.dispatch({ changes: { from, to: Math.max(to, from), remove: current } });
      return true;
    }
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
      const url = opts.linkTarget ? opts.linkTarget(raw) : raw;
      const param: LinkParam = { url, title: null, href: url, path: null, broken: false };
      wg.dispatch({ changes: { from, to, add: Link.of(param) }, effects: dialog.close });
    });
    return true;
  };
}

/** Image files pasted or dropped into the body: uploaded, then inserted as an image. */
function imageFiles(opts: EditOptions, wg: Wordgard, files: readonly File[], at: number) {
  const upload = opts.upload;
  if (!upload) return false;
  const images = files.filter((f) => f.type.startsWith("image/"));
  if (images.length === 0) return false;
  for (const file of images) {
    void upload(file).then(({ path, src }) => {
      const param: ImageParam = {
        url: `/${path}`,
        alt: file.name.replace(/\.[^.]+$/, ""),
        title: null,
        src,
      };
      wg.dispatch({ changes: { from: at, insert: [Image.of(param)] } });
    });
  }
  return true;
}

/** Everything the reader adds while a person edits. */
export function editing(opts: EditOptions): GardState.Extension[] {
  const link = linkCommand(opts);
  const linkButton = Menu.Button.define({
    label: "Link",
    description: "Link the selection (Ctrl/Cmd+K)",
    run: link,
    active: (state) => linkAt(state) !== null,
  });
  return [
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
      imageFiles(opts, wg, [...(event.clipboardData?.files ?? [])], wg.state.selection.from),
    ),
    Wordgard.dropHandler.of((wg, event, pos) =>
      imageFiles(opts, wg, [...(event.dataTransfer?.files ?? [])], pos),
    ),
    Wordgard.updateListener.of((u) => {
      if (u.docChanged) opts.onChange?.();
    }),
  ];
}
