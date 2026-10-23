import { type FormEvent, useState } from "react";
import { actorText } from "../agents";
import { ApiError } from "../api";
import { Moment } from "../Moment";
import type { Compare } from "../router";
import { day } from "../ui";
import type { Urls } from "../urls";
import type { Namer } from "./Byline";
import { checker, markChecked } from "./Checked";
import { actedBy, type Concept, type Standing, type Version } from "./data";

/**
 * The slim bar over the text while it shows changes, or an earlier version (tempra-dev:
 * app/reader, Review mode, The panels). In review mode: what the diff is against ("Changes since
 * you checked on Oct 12"), a note and Mark as checked (not for a read member), and Done, the one
 * way out. On a version chosen in History, both views of it by name: "Changes in v3" (the diff
 * from the version before, `?since=`) and "v3 as it was" (`?at=` alone), each linking to the
 * other, with Back to latest.
 */
export function ReviewBar(props: {
  urls: Urls;
  concept: Concept;
  compare: Compare;
  standing: Standing;
  name: Namer;
  mayVerify: boolean;
  error: string | null;
  onVerified(): void;
}) {
  const { urls, concept: c, compare, standing: s, name } = props;
  const plain = urls.pinned(undefined).file(c.path);
  if (compare.kind === "since") {
    // The version on screen, and what its changes are drawn from: the version before it, from
    // History; any other base says so.
    const version = s.current;
    const i = version ? s.versions.indexOf(version) : -1;
    const base = s.versions.find((v) => v.event.seq === compare.seq);
    const fromBefore = i > 0 && s.versions[i - 1] === base;
    const latest = version !== null && i === s.versions.length - 1;
    return (
      <section className="review-bar" aria-label="Changes">
        <span className="review-what">
          {version && (
            <VersionWhat
              version={version}
              name={name}
              lead={fromBefore || !base ? `Changes in v${version.n}` : `Changes since v${base.n}`}
            />
          )}
        </span>
        {props.error && <span className="warn">{props.error}</span>}
        <span className="review-actions">
          {version && !latest && (
            // Reached from History, which stays open.
            <a
              className="button"
              href={`${urls.pinned(version.event.seq).file(c.path)}&panel=history`}
            >
              v{version.n} as it was
            </a>
          )}
          <a className="button" href={plain}>
            Back to latest
          </a>
        </span>
      </section>
    );
  }
  const v = s.verified;
  const who = checker(s, name);
  const against =
    v && who
      ? s.since === 0
        ? `No changes since ${who} checked on ${day(v.event.ts)}`
        : `Changes since ${who} checked on ${day(v.event.ts)}`
      : "Nobody has checked this page yet";
  return (
    <section className="review-bar" aria-label="Review">
      <span className="review-what">{against}</span>
      {props.error && <span className="warn">{props.error}</span>}
      <span className="review-actions">
        {props.mayVerify && (s.since > 0 || !v) && (
          <CheckForm urls={urls} path={c.path} onVerified={props.onVerified} />
        )}
        <a className="button" href={plain}>
          Done
        </a>
      </span>
    </section>
  );
}

/**
 * An earlier version on screen with no changes drawn (`?at=` alone): "v3 as it was · note · who
 * · when", Changes in v3 (the diff from the version before) and Back to latest.
 */
export function VersionBar(props: {
  urls: Urls;
  concept: Concept;
  standing: Standing;
  name: Namer;
}) {
  const { urls, concept: c, standing: s, name } = props;
  const version = s.current;
  if (!version) return null;
  const i = s.versions.indexOf(version);
  const before = i > 0 ? s.versions[i - 1] : undefined;
  const page = urls.pinned(version.event.seq).file(c.path);
  return (
    <section className="review-bar" aria-label="Version">
      <span className="review-what">
        <VersionWhat version={version} name={name} lead={`v${version.n} as it was`} />
      </span>
      <span className="review-actions">
        {before && (
          <a
            className="button"
            href={`${page}${page.includes("?") ? "&" : "?"}since=${before.event.seq}`}
          >
            Changes in v{version.n}
          </a>
        )}
        <a className="button" href={urls.pinned(undefined).file(c.path)}>
          Back to latest
        </a>
      </span>
    </section>
  );
}

/** "Changes in v3 · note · who · when". */
function VersionWhat(props: { version: Version; name: Namer; lead: string }) {
  const { version, name } = props;
  const by = name(version.event.actor, actedBy(version.event));
  const note = typeof version.event.meta?.note === "string" ? version.event.meta.note : "";
  return (
    <>
      <strong className="review-lead">{props.lead}</strong>
      {note && <span className="review-note"> · {note}</span>}
      <span className="muted">
        {" "}
        · {actorText(by)} · <Moment ts={version.event.ts} />
      </span>
    </>
  );
}

/** A note and Mark as checked: the person vouches for the version on screen. */
function CheckForm(props: { urls: Urls; path: string; onVerified(): void }) {
  const { urls, path } = props;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const note = String(new FormData(e.currentTarget).get("note") ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      await markChecked(urls, path, note);
      props.onVerified();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="verify-form" onSubmit={submit}>
      <input type="text" name="note" placeholder="Note (optional)" aria-label="Note" />
      <button className="primary" type="submit" disabled={busy}>
        Mark as checked
      </button>
      {error && <span className="warn">{error}</span>}
    </form>
  );
}
