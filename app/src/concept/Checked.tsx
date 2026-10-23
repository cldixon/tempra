import { api } from "../api";
import { navigate } from "../router";
import { day, plural } from "../ui";
import { enc, type Urls } from "../urls";
import type { Namer } from "./Byline";
import { actedBy, type Standing } from "./data";

/*
 * Whether a person checked the page (TEMPRA-122; tempra-dev: app/reader, The byline, and
 * decisions/take4-review-answers, answers 3 and 4). People see "checked"; the service, the
 * ledger and MCP keep "verify".
 */

/** Who checked the version on screen, in people's words: "you", "ann"; null if nobody has. */
export function checker(s: Standing, name: Namer): string | null {
  const v = s.verified;
  if (!v) return null;
  const by = name(v.event.actor, actedBy(v.event));
  return by.you ? "you" : by.name;
}

/** "2 changes since you checked". */
export function changesSince(s: Standing, name: Namer): string {
  return `${plural(s.since, "change")} since ${checker(s, name) ?? "someone"} checked`;
}

/**
 * Marks the latest version as checked (the verify route, as the signed-in person), then returns
 * to the plain page, which says so once (`?done=verify`).
 */
export async function markChecked(urls: Urls, path: string, note = ""): Promise<void> {
  await api(urls.api(`verify/${enc(path)}`), {
    method: "POST",
    headers: note ? { "X-Note": encodeURIComponent(note) } : {},
  });
  navigate(`${urls.pinned(undefined).file(path)}?done=verify`, { replace: true });
}

/**
 * The quiet line under the byline: "Checked by you, Oct 12", and "· changed since" (opening
 * review mode) when the page was edited after. Nothing when nobody has checked it.
 */
export function CheckedLine(props: { urls: Urls; path: string; standing: Standing; name: Namer }) {
  const { urls, path, standing: s } = props;
  const who = checker(s, props.name);
  if (!who || !s.verified) return null;
  return (
    <p className="doc-checked">
      Checked by {who}, {day(s.verified.event.ts)}
      {s.since > 0 && (
        <>
          <span className="byline-sep" aria-hidden="true">
            {" "}
            ·{" "}
          </span>
          <a href={urls.review(path)}>changed since</a>
        </>
      )}
    </p>
  );
}
