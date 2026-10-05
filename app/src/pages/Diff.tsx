import type { FormEvent } from "react";
import { api, useLoad } from "../api";
import { navigate } from "../router";
import { Crumbs, Status, useTitle } from "../ui";
import { baseName, type Urls } from "../urls";

interface DiffData {
  path: string;
  from: number;
  to: number;
  diff: string;
}

/** Changes to one file between two sequences, as rendered markdown. */
export function Diff(props: { urls: Urls; path: string; from?: number; to?: number }) {
  const { urls, path } = props;
  const loaded = useLoad(`diff ${urls.diff(path, props.from, props.to)}`, async () => {
    const [d, stats] = await Promise.all([
      api<DiffData>(urls.api("diff", { path, from: props.from, to: props.to })),
      api<{ seq: number }>(urls.api("stats")),
    ]);
    return { ...d, head: stats.seq };
  });
  return <Status loaded={loaded}>{(d) => <DiffView urls={urls} {...d} />}</Status>;
}

function DiffView(props: { urls: Urls } & DiffData & { head: number }) {
  const { urls, path, from, to, head } = props;
  useTitle(`Changes to ${path} · ${urls.slug}`);
  const at = (seq: number) => (
    <a href={urls.pinned(seq >= head ? undefined : seq).file(path)}>seq {seq}</a>
  );
  const compare = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const n = (k: string) => {
      const v = Number(form.get(k));
      return Number.isInteger(v) && v >= 0 ? v : undefined;
    };
    navigate(urls.diff(path, n("from"), n("to")));
  };
  return (
    <>
      <Crumbs urls={urls} path={path} file />
      <h1>Changes to {baseName(path)}</h1>
      <p className="muted">
        From {at(from)} to {at(to)}, as rendered markdown.
      </p>
      <form className="inline" onSubmit={compare} key={`${from}-${to}`}>
        <label className="small" htmlFor="from">
          From
        </label>{" "}
        <input id="from" name="from" type="number" min={0} max={head} defaultValue={from} />{" "}
        <label className="small" htmlFor="to">
          to
        </label>{" "}
        <input id="to" name="to" type="number" min={0} max={head} defaultValue={to} />{" "}
        <button type="submit">Compare</button>
      </form>
      <DiffLines diff={props.diff} />
    </>
  );
}

/** A unified diff, one line per row, classed by kind. */
export function DiffLines({ diff }: { diff: string }) {
  if (diff.trim() === "") return <p className="muted">No differences.</p>;
  const lines = diff.replace(/\n$/, "").split("\n");
  return (
    <pre className="diff">
      {lines.map((line, i) => {
        let cls = "ctx";
        if (line.startsWith("+++") || line.startsWith("---")) cls = "meta";
        else if (line.startsWith("@@")) cls = "hunk";
        else if (line.startsWith("+")) cls = "add";
        else if (line.startsWith("-")) cls = "del";
        else if (line.startsWith("\\")) cls = "meta";
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a diff's lines are fixed for the page.
          <span key={i} className={cls}>
            {line || " "}
            {i < lines.length - 1 ? "\n" : ""}
          </span>
        );
      })}
    </pre>
  );
}
