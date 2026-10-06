/**
 * Which failed cf calls are worth trying again (TEMPRA-52). Every call made through `cf()` must be
 * safe to repeat, so a call that failed for a passing reason on Cloudflare's side, or between here
 * and there, is retried; one that failed because of what it asked (bad arguments, auth, a missing
 * resource) is not. Free of side effects, so tests import it without the Cloudflare config.
 */

/** Output of a failed call that says the failure was transient. */
const TRANSIENT = [
  /\btime(?:d)?[ -]?out\b/i, // "timeout", "timed out", "time-out"
  /\bETIMEDOUT\b/,
  /\bECONNRESET\b/,
  /\bECONNREFUSED\b/,
  /\bEAI_AGAIN\b/,
  /\bENOTFOUND\b/,
  /socket hang up/i,
  /fetch failed/i,
  /network (?:error|connection lost)/i,
  /\b(?:502|503|504)\b/,
  /bad gateway|service unavailable|gateway time-?out/i,
  /\b429\b|too many requests|rate limit/i,
];

/** Output that says the call itself was wrong, which no retry fixes, whatever else it says. */
const PERMANENT = [
  /\b(?:400|401|403|404|409)\b/,
  /authentication|unauthori[sz]ed|forbidden|permission denied/i,
  /not found|does not exist|already exists/i,
  /invalid (?:argument|option|value)|unknown (?:argument|option|command)/i,
];

/** Whether cf's output (stderr and stdout) describes a transient failure. */
export function transientCfError(output: string): boolean {
  if (PERMANENT.some((re) => re.test(output))) return false;
  return TRANSIENT.some((re) => re.test(output));
}

/** How long to wait before retry `attempt` (1, 2, …): 2 s, then 4 s, then 8 s. */
export function retryDelayMs(attempt: number): number {
  return 1000 * 2 ** Math.min(attempt, 3);
}
