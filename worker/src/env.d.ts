import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

/** Secrets and injected helpers that `cf workers types` does not know about (they are not in cloudflare.config.ts). */
interface AuthEnv {
  /** Where the daily digest goes (secret, so the address stays out of the repository). */
  OPERATOR_EMAIL?: string;
  /** Local dev and the gate: "1" shows sign-in links on the page (loopback hosts only). */
  DEV_SIGNIN?: string;
  /** Injected by the OAuth provider into the default handler's env. */
  OAUTH_PROVIDER: OAuthHelpers;
  /**
   * The managed-agent spike (TEMPRA-67), bound in preview mode only (cloudflare.config.ts), so
   * the types generated with no mode do not have them.
   */
  AGENT_SPIKE?: string;
  LIBRARY_AGENT?: DurableObjectNamespace;
  AGENT_RUN?: Workflow;
  AI?: Ai;
  /** A secret on preview Workers only (scripts/preview.ts); unset, the Claude arms answer "no key". */
  ANTHROPIC_API_KEY?: string;
}

declare global {
  interface Env extends AuthEnv {}
  namespace Cloudflare {
    interface Env extends AuthEnv {}
  }
}
