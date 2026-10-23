import { type FormEvent, useState } from "react";
import { actorText } from "../agents";
import { ApiError, api } from "../api";
import { Moment } from "../Moment";
import type { Compare } from "../router";
import { navigate } from "../router";
import { day } from "../ui";
import { enc, type Urls } from "../urls";
import type { Namer } from "./Byline";
import { actedBy, type Concept, type Standing } from "./data";

/**
 * The slim bar over the text while it shows changes (tempra-dev: app/reader, Review mode, The
 * panels): in review mode, what the diff is against, a note and Verify this version (not for a
 * read member); on a version chosen in History, "v16 · note · who · when" (the version on screen,
 * whose changes from the one before are drawn) and Back to latest.
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
    const by = version ? name(version.event.actor, actedBy(version.event)) : null;
    const note = typeof version?.event.meta?.note === "string" ? version.event.meta.note : "";
    return (
      <section className="review-bar" aria-label="Changes">
        <span className="review-what">
          {version && <span className="version-n">v{version.n}</span>}
          {note && <span className="review-note"> {note}</span>}
          {by && version && (
            <span className="muted">
              {" "}
              · {actorText(by)} · <Moment ts={version.event.ts} />
            </span>
          )}
          {!fromBefore && base && <span className="muted"> · changes since v{base.n}</span>}
        </span>
        {props.error && <span className="warn">{props.error}</span>}
        <span className="review-actions">
          <a className="button" href={plain}>
            Back to latest
          </a>
        </span>
      </section>
    );
  }
  const v = s.verified;
  const verifier = v ? name(v.event.actor, actedBy(v.event)) : null;
  const against =
    v && verifier
      ? `Changes since ${verifier.you ? "you" : verifier.name} verified on ${day(v.event.ts)}${v.version ? ` (version ${v.version.n})` : ""}`
      : "Not yet verified by a person";
  return (
    <section className="review-bar" aria-label="Review">
      <span className="review-what">
        {s.since === 0 && v ? "No changes since it was verified" : against}
      </span>
      {props.error && <span className="warn">{props.error}</span>}
      <span className="review-actions">
        {props.mayVerify && (s.since > 0 || !v) && (
          <VerifyForm urls={urls} path={c.path} onVerified={props.onVerified} />
        )}
        <a className="button" href={plain}>
          Done
        </a>
      </span>
    </section>
  );
}

/** A note and Verify this version: the person vouches for the version on screen. */
function VerifyForm(props: { urls: Urls; path: string; onVerified(): void }) {
  const { urls, path } = props;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const note = String(new FormData(e.currentTarget).get("note") ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      await api(urls.api(`verify/${enc(path)}`), {
        method: "POST",
        headers: note ? { "X-Note": encodeURIComponent(note) } : {},
      });
      navigate(`${urls.pinned(undefined).file(path)}?done=verify`, { replace: true });
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
        Verify this version
      </button>
      {error && <span className="warn">{error}</span>}
    </form>
  );
}
