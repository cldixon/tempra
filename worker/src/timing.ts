/**
 * Where a Library DO call's time goes (TEMPRA-190): one log line for each object's first call
 * and for any call slower than SLOW_MS, from the object (what it awaited, and the call itself) and
 * from the Worker (the whole round trip), so Workers Observability can tell the platform's share
 * (the object starting, its storage loading, queueing) from ours. Free of Worker APIs.
 *
 * Workers' clocks advance only across I/O, so the synchronous store work reads as 0 ms here; the
 * platform's own per-invocation CPU time covers it (production's slow calls spent 0 to 96 ms of
 * CPU in 0.9 to 5 s of wall time, 2026-10-25 to 26).
 */

/** A call slower than this is logged, cold or not. */
export const SLOW_MS = 250;

/** One Library DO call, as the object saw it. */
export interface CallTiming {
  /** The library's id (the object's name), never its slug. */
  library: string;
  method: string;
  /** The object's first call since it started. */
  cold: boolean;
  /** From the object's constructor to this call. */
  sinceStartMs: number;
  /** Awaiting the maintenance alarm check (`getAlarm`, maybe `setAlarm`); 0 once checked. */
  alarmMs: number;
  /** The store method, with what it awaited (R2, D1). */
  callMs: number;
  totalMs: number;
}

/** Whether a call is worth a line: the first after a start, or a slow one. */
export const worthLogging = (cold: boolean, totalMs: number) => cold || totalMs > SLOW_MS;

/** The object's line, with the library's size. */
export function callLine(t: CallTiming, size: { files: number; dbBytes: number }): string {
  return JSON.stringify({
    do_call: t.method,
    library: t.library,
    cold: t.cold,
    since_start_ms: t.sinceStartMs,
    alarm_ms: t.alarmMs,
    call_ms: t.callMs,
    total_ms: t.totalMs,
    files: size.files,
    db_bytes: size.dbBytes,
  });
}

/** The Worker's line for a slow round trip to a library's object, or null when it was quick. */
export function rpcLine(method: string, library: string, ms: number): string | null {
  return ms > SLOW_MS ? JSON.stringify({ do_rpc: method, library, ms }) : null;
}
