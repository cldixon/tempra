/**
 * Where each thread sits in the comment margin (tempra-dev: app/comments, In the margin): beside
 * the line its quote is on, unless the thread before it reaches that far, in which case it is
 * pushed down. Threads keep their order. Pure: the margin measures, this decides.
 */

export interface Slot {
  id: string;
  /** Where the thread would like its top: its quote's line, in the margin's coordinates. */
  want: number;
  /** Its drawn height. */
  height: number;
}

/** Each slot's top, in the order given, never overlapping (with `gap` between). */
export function stack(slots: readonly Slot[], gap: number): Map<string, number> {
  const tops = new Map<string, number>();
  let floor = Number.NEGATIVE_INFINITY;
  for (const s of slots) {
    const top = Math.max(s.want, floor);
    tops.set(s.id, top);
    floor = top + s.height + gap;
  }
  return tops;
}
