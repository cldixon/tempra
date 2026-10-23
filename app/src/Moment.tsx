import { agoWords, useNow } from "./activity";
import { localTime } from "./ui";

/**
 * When something happened, as a sentence says it ("3 minutes ago", "on Oct 12"), kept current,
 * with the reader's local date and time on hover.
 */
export function Moment({ ts }: { ts: string }) {
  const now = useNow();
  return (
    <time dateTime={ts} title={localTime(ts)}>
      {agoWords(ts, now)}
    </time>
  );
}
