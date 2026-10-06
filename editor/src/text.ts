/**
 * A document's text, for comment anchors (tempra-dev: app/comments): every textblock (paragraph,
 * heading, code, table cell) in document order, one newline between them. Inline content reads as
 * the reader shows it; an atom (image, footnote reference, raw markdown, line break) is one
 * character, so offsets within a textblock are offsets within the reader's block too. Footnote
 * definitions are not part of it: they are shown beside the body.
 */
import type { Nodes, PhrasingContent } from "mdast";
import { type Doc, type DocNode, idOf, parseMarkdown } from "./tree";

/** Stands for an atom in the text. */
export const ATOM = "\uFFFC";

/** A textblock's place in the text: `from` to `to`, inside the block with ID `block`. */
export interface TextBlock {
  block: string | null;
  from: number;
  to: number;
}

export interface DocText {
  text: string;
  blocks: TextBlock[];
}

/** The text of inline content, as the reader holds it. */
export function inlineText(nodes: readonly PhrasingContent[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.type === "text") out += n.value;
    else if (n.type === "inlineCode") out += n.value.replace(/\n/g, " ");
    else if (n.type === "break") out += "\n";
    else if ("children" in n && n.type !== "linkReference") out += inlineText(n.children);
    else out += ATOM;
  }
  return out;
}

/** The text of a document and where each textblock sits in it. */
export function docText(doc: Doc): DocText {
  const parts: string[] = [];
  const blocks: TextBlock[] = [];
  let at = 0;
  const add = (block: string | null, text: string) => {
    if (blocks.length > 0) at += 1; // the newline between textblocks
    parts.push(text);
    blocks.push({ block, from: at, to: at + text.length });
    at += text.length;
  };
  const visit = (n: DocNode, block: string | null) => {
    const id = idOf(n) ?? block;
    switch (n.type) {
      case "footnoteDefinition":
        return;
      case "paragraph":
      case "heading":
        return add(id, inlineText(n.children));
      case "code":
        return add(id, n.value);
      case "table":
        for (const row of n.children)
          for (const cell of row.children) add(id, inlineText(cell.children));
        return;
      default:
        if ("children" in n) for (const c of n.children as Nodes[]) visit(c, id);
    }
  };
  visit(doc, null);
  return { text: parts.join("\n"), blocks };
}

/** The text a markdown quote reads as (`**bold** word` reads `bold word`), for agents' quotes. */
export function quoteText(markdown: string): string {
  return docText(parseMarkdown(markdown)).text;
}
