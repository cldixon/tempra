/**
 * Figure markup (tempra-dev: app/media, Figure markup): a container directive named `figure`
 * around one to four ordinary images, saying what a plain image cannot, its width, its placement
 * and that several images are one group:
 *
 *     :::figure[The top bar before and after]{width=480 layout=wide frame}
 *     ![The top bar with crumbs](/app/bar-before.png "Before")
 *     ![The top bar with the path](/app/bar-after.png "After")
 *     :::
 *
 * The directive is a block in the tree; its label (`[…]`, the group's caption) is a paragraph
 * mdast-util-directive marks `directiveLabel`, and is not part of the document's text; each image
 * stays one atom. A directive with another name is kept as written (rule 6 of the structured
 * documents decision). DOM-free: the Worker lints with it and the reader draws with it.
 */
import type { Image, Paragraph, RootContent } from "mdast";
import type { ContainerDirective } from "mdast-util-directive";

export type { ContainerDirective };

/** Where a figure sits: in the text's column, wider than the text, or the page's width. */
export type FigureLayout = "column" | "wide" | "full";

export const FIGURE_LAYOUTS: readonly FigureLayout[] = ["column", "wide", "full"];

/** The most images one figure holds. */
export const FIGURE_MAX_IMAGES = 4;

/** The attributes a figure takes, in their canonical order. */
const ATTRIBUTES = ["width", "layout", "frame"];

/** A figure's width: pixels, or a share of the column. */
export interface FigureWidth {
  value: number;
  unit: "px" | "%";
}

/** What a figure's markup says, once it parses. */
export interface FigureSpec {
  width: FigureWidth | null;
  layout: FigureLayout;
  frame: boolean;
  /** Its images, in order. */
  images: Image[];
  /** The group's caption (the directive's label), if it has one. */
  label: Paragraph | null;
}

export type FigureCheck = { ok: true; spec: FigureSpec } | { ok: false; problems: string[] };

/** A container directive's label (`[…]` after its name): a paragraph that is not the text. */
export function isDirectiveLabel(node: { type: string; data?: unknown }): boolean {
  return (
    node.type === "paragraph" &&
    (node.data as { directiveLabel?: boolean } | undefined)?.directiveLabel === true
  );
}

/** Whether a node is figure markup (well formed or not). */
export function isFigure(node: { type: string; name?: string }): node is ContainerDirective {
  return node.type === "containerDirective" && node.name === "figure";
}

/** A directive's label paragraph, if it has one. */
export function directiveLabel(node: ContainerDirective): Paragraph | null {
  const first = node.children[0];
  return first && isDirectiveLabel(first) ? (first as Paragraph) : null;
}

/** A directive's content: its children after the label. */
export function directiveContent(node: ContainerDirective): RootContent[] {
  const label = directiveLabel(node);
  return (label ? node.children.slice(1) : node.children) as RootContent[];
}

/** The images of a paragraph that holds images and nothing else (whitespace aside), or null. */
function onlyImages(n: RootContent): Image[] | null {
  if (n.type !== "paragraph") return null;
  const out: Image[] = [];
  for (const c of n.children) {
    if (c.type === "image") out.push(c);
    else if (c.type !== "text" || c.value.trim() !== "") return null;
  }
  return out;
}

const PX = /^([1-9]\d{0,4})$/;
const SHARE = /^([1-9]\d?|100)%$/;

/** Parses a figure's markup: what it says, or what is wrong with it. */
export function checkFigure(node: ContainerDirective): FigureCheck {
  const problems: string[] = [];
  const attrs = node.attributes ?? {};
  let width: FigureWidth | null = null;
  let layout: FigureLayout = "column";
  let frame = false;
  for (const [key, raw] of Object.entries(attrs)) {
    if (raw === null || raw === undefined) continue;
    const value = String(raw);
    if (key === "width") {
      const px = PX.exec(value);
      const share = SHARE.exec(value);
      if (px) width = { value: Number(px[1]), unit: "px" };
      else if (share) width = { value: Number(share[1]), unit: "%" };
      else
        problems.push(
          `width=${value || '""'} is not a width: give pixels (width=480) or a share of the column (width=60%)`,
        );
    } else if (key === "layout") {
      if ((FIGURE_LAYOUTS as readonly string[]).includes(value)) layout = value as FigureLayout;
      else problems.push(`layout=${value || '""'} is not a layout: use column, wide or full`);
    } else if (key === "frame") {
      if (value === "") frame = true;
      else problems.push(`frame takes no value (write frame, not frame=${value})`);
    } else {
      const shown = key === "id" ? `#${value}` : key === "class" ? `.${value}` : key;
      problems.push(`${shown} is not a figure attribute (width, layout and frame are)`);
    }
  }
  const images: Image[] = [];
  let other = false;
  for (const c of directiveContent(node)) {
    const found = onlyImages(c);
    if (found) images.push(...found);
    else other = true;
  }
  if (other) problems.push('a figure holds images only (each `![alt](/path "caption")`)');
  if (images.length === 0) problems.push("it has no images");
  if (images.length > FIGURE_MAX_IMAGES)
    problems.push(`it has ${images.length} images; a figure holds at most ${FIGURE_MAX_IMAGES}`);
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, spec: { width, layout, frame, images, label: directiveLabel(node) } };
}

/**
 * A directive in its canonical form, in place, as it is parsed: a figure's attributes in a fixed
 * order (width, layout, frame, then any others as written), and its images in one paragraph, one
 * to a line, however they were spaced. Other directives are kept as written.
 */
export function canonicalDirective(node: ContainerDirective): void {
  if (!isFigure(node)) return;
  const attrs = node.attributes ?? {};
  const ordered: Record<string, string | null | undefined> = {};
  for (const k of ATTRIBUTES) if (k in attrs) ordered[k] = attrs[k];
  for (const [k, v] of Object.entries(attrs)) if (!(k in ordered)) ordered[k] = v;
  node.attributes = ordered;

  const label = directiveLabel(node);
  const content = directiveContent(node);
  const groups = content.map(onlyImages);
  if (content.length === 0 || groups.some((g) => g === null)) return;
  const images = groups.flatMap((g) => g ?? []);
  if (images.length === 0) return;
  const paragraph: Paragraph = { type: "paragraph", children: [] };
  images.forEach((image, i) => {
    if (i > 0) paragraph.children.push({ type: "text", value: "\n" });
    paragraph.children.push(image);
  });
  node.children = label ? [label, paragraph] : [paragraph];
}
