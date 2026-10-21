import { useEffect, useState } from "react";
import type { Heading, Prepared } from "../reader/prepare";

/**
 * The concept's contents (take 4; tempra-dev: app/reader, Contents): its top two heading levels,
 * nested, on the right of the page while no panel is open and there is room, otherwise under the
 * byline ("On this page"). The section in view is marked with a rule.
 */

/** A heading in the contents: a section, or one level under it. */
export interface Entry extends Heading {
  sub: boolean;
}

/**
 * The headings the contents list: the body's top two levels (h2 and h3 in most concepts; a
 * leading heading repeating the title aside).
 */
export function contentsOf(prepared: Prepared, skipFirst: boolean): Entry[] {
  const headings = skipFirst ? prepared.headings.slice(1) : prepared.headings;
  const top = Math.min(...headings.map((h) => h.depth));
  return headings.filter((h) => h.depth <= top + 1).map((h) => ({ ...h, sub: h.depth > top }));
}

/** The heading the sheet is scrolled to: the last one above the top of the view. */
function useCurrent(headings: Heading[]): string | null {
  const [current, setCurrent] = useState<string | null>(null);
  const ids = headings.map((h) => h.id).join(" ");
  useEffect(() => {
    const sheet = document.querySelector(".ws-main");
    if (!sheet || !ids) return;
    const list = ids.split(" ");
    const update = () => {
      const top = sheet.getBoundingClientRect().top + 120;
      let at: string | null = list[0] ?? null;
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= top) at = id;
      }
      setCurrent(at);
    };
    update();
    sheet.addEventListener("scroll", update, { passive: true });
    return () => sheet.removeEventListener("scroll", update);
  }, [ids]);
  return current;
}

export function Contents(props: { headings: Entry[]; onPick?(): void }) {
  const { headings } = props;
  const current = useCurrent(headings);
  return (
    <ul className="toc">
      {headings.map((h) => (
        <li key={h.id} className={h.sub ? "sub" : undefined}>
          <a
            href={`#${h.id}`}
            aria-current={h.id === current ? "location" : undefined}
            onClick={props.onPick}
          >
            {h.text}
          </a>
        </li>
      ))}
    </ul>
  );
}
