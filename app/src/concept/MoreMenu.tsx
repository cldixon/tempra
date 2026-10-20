import { useState } from "react";
import { Icon, Menu } from "../chrome";
import { Dialog } from "../Dialog";
import { Chip, when } from "../ui";
import type { Urls } from "../urls";
import type { Namer } from "./Byline";
import { Contents, type Entry } from "./Contents";
import type { Concept, Links, Standing, WorkItem } from "./data";
import { Properties } from "./Properties";

/**
 * The concept's "…" menu (take 3; tempra-dev: app/reader, The corner controls): the Markdown view,
 * Properties (with the concept's verification), the raw file, Contents (only while the left margin cannot show it: the stylesheet
 * hides the item when it can), and the agents' notes on the concept.
 */
export function MoreMenu(props: {
  urls: Urls;
  concept: Concept;
  links: Links;
  head: number;
  standing: Standing;
  name: Namer;
  current: boolean;
  work: WorkItem[];
  contents: Entry[];
  markdown: boolean;
  onMarkdown(on: boolean): void;
}) {
  const { urls, concept: c } = props;
  const [open, setOpen] = useState<"properties" | "notes" | "contents" | null>(null);
  const notes = c.lint.length + props.work.length;
  const close = () => setOpen(null);
  return (
    <>
      <Menu
        name="More"
        title="More"
        buttonClass="icon-button"
        align="end"
        label={<Icon name="more" />}
      >
        <button
          type="button"
          aria-pressed={props.markdown}
          onClick={() => props.onMarkdown(!props.markdown)}
        >
          {props.markdown ? "Show the reader" : "Markdown"}
        </button>
        {props.contents.length >= 2 && (
          <button type="button" className="more-contents" onClick={() => setOpen("contents")}>
            Contents
          </button>
        )}
        <button type="button" onClick={() => setOpen("properties")}>
          Properties
        </button>
        <button type="button" onClick={() => setOpen("notes")}>
          Agent notes{notes > 0 ? ` (${notes})` : ""}
        </button>
        <hr />
        <a href={urls.raw(c.path)}>Raw file</a>
      </Menu>
      <Dialog title="Contents" open={open === "contents"} onClose={close}>
        <nav aria-label="Contents">
          <Contents headings={props.contents} onPick={close} />
        </nav>
      </Dialog>
      <Dialog title="Properties" open={open === "properties"} onClose={close}>
        <Properties
          urls={urls}
          path={c.path}
          fm={c.frontmatter}
          links={props.links}
          head={props.head}
          standing={props.standing}
          name={props.name}
          current={props.current}
          onClose={close}
        />
      </Dialog>
      <Dialog title="Agent notes" open={open === "notes"} onClose={close}>
        <AgentNotes concept={c} work={props.work} />
      </Dialog>
    </>
  );
}

/**
 * What agents should fix in this concept: its lint and its work items (broken links, staleness,
 * structure), with what to do about each. For people to see, not to act on.
 */
function AgentNotes({ concept: c, work }: { concept: Concept; work: WorkItem[] }) {
  const fm = c.frontmatter;
  return (
    <>
      <dl className="facts">
        <dt>type</dt>
        <dd>
          {typeof fm.type === "string" && fm.type ? fm.type : <Chip text="no type" tone="bad" />}
        </dd>
        {typeof fm.status === "string" && (
          <>
            <dt>status</dt>
            <dd>{fm.status}</dd>
          </>
        )}
        {fm.stale_after !== undefined && (
          <>
            <dt>stale_after</dt>
            <dd>
              {when(String(fm.stale_after))}
              {c.stale && <Chip text="stale" tone="bad" />}
              {c.stale_soon && <Chip text="stale soon" />}
            </dd>
          </>
        )}
      </dl>
      {c.lint.length + work.length === 0 ? (
        <p className="small muted">Nothing for agents to fix here.</p>
      ) : (
        <ul className="notes-list">
          {c.lint.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lint warnings have no id.
            <li key={i}>
              <Chip text="lint" /> <code>{l.code}</code> <span className="muted">{l.message}</span>
            </li>
          ))}
          {work.map((w) => (
            <li key={`${w.kind} ${w.detail}`}>
              <Chip
                text={w.kind.replace("_", " ")}
                tone={w.kind === "structure" ? "warn" : "bad"}
              />{" "}
              <span>{w.detail}</span>
              <div className="muted">→ {w.suggested_action}</div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
