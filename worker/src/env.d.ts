import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

/** Secrets and injected helpers that `cf workers types` does not know about (they are not in cloudflare.config.ts). */
interface AuthEnv {
  /** Where the daily digest goes (secret, so the address stays out of the repository). */
  OPERATOR_EMAIL?: string;
  /** Local dev and the gate: "1" shows sign-in links on the page (loopback hosts only). */
  DEV_SIGNIN?: string;
  /** Injected by the OAuth provider into the default handler's env. */
  OAUTH_PROVIDER: OAuthHelpers;
}

declare global {
  interface Env extends AuthEnv {}
  namespace Cloudflare {
    interface Env extends AuthEnv {}
  }
}
