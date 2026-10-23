import { localTime, relativeTime, useNow } from "./ui";

/**
 * When something happened, the one way the app draws it (TEMPRA-131): `relativeTime` ("just
 * now", "3 min ago", "yesterday", "Oct 12"), kept current, with the reader's local date and time
 * on hover. `now` is a clock the caller already ticks, if it has one.
 */
export function Moment({ ts, now }: { ts: string; now?: number }) {
  const ticking = useNow();
  return (
    <time dateTime={ts} title={localTime(ts)}>
      {relativeTime(ts, now ?? ticking)}
    </time>
  );
}
