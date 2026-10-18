import {
  AuthorizationError,
  type AuthRequest,
  CimdFetchError,
  type ConsentDescription,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import type { Hono } from "hono";
import type { ReachableLibrary } from "../accounts";
import { checkSlug } from "../accounts";
import { type ClientSignals, connectionAgent } from "../agents";
import type { Deps } from "../app";
import type { TokenInfo } from "../auth";
import { normalizeDir } from "../okf/paths";
import { signedIn } from "../signin";
import { OkfError } from "../store/errors";
import type { AccountGrant } from "../tenancy";
import { type ConsentForm, consentKey, consentPage, messagePage } from "./pages";

/** OAuth scopes (spec: Apps under Auth). A grant never carries more than the person approved. */
export const SCOPES = ["okf:read", "okf:write"];

/**
 * What an approved grant carries. Connections approved here belong to the account and name
 * their libraries (`grant`); `token` is one library's token: a bearer token on /mcp, or a
 * connection approved before account-level access, which keeps working as it was.
 */
export interface GrantProps {
  token?: TokenInfo;
  grant?: AccountGrant;
}

const AGENT_ACTOR = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;

type AppEnv = { Bindings: Cloudflare.Env };

function defaultActor(details: ConsentDescription): string {
  const base = (details.clientDomain ?? details.clientName ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "app"}/connector`;
}

function defaultForm(
  request: AuthRequest,
  details: ConsentDescription,
  libs: ReachableLibrary[],
): ConsentForm {
  const wantsWrite = request.scope.length === 0 || request.scope.includes("okf:write");
  return {
    libraries: "all",
    selected: [],
    newLibrary: libs.length === 0 ? "notes" : "",
    access: wantsWrite ? "write" : "read",
    prefix: "",
    actor: defaultActor(details),
    tiers: "all",
    create: wantsWrite,
  };
}

function readForm(form: FormData): ConsentForm {
  const s = (k: string) => String(form.get(k) ?? "").trim();
  return {
    libraries: s("libraries") === "all" ? "all" : "selected",
    selected: form
      .getAll("library")
      .map((v) => String(v).trim())
      .filter(Boolean),
    newLibrary: s("new_library"),
    access: s("access") === "read" ? "read" : "write",
    prefix: s("prefix"),
    actor: s("actor").toLowerCase(),
    tiers: s("tiers") === "files" ? "files" : "all",
    // A checkbox: absent when unticked.
    create: s("create_libraries") === "on",
  };
}

/** Checks the form; returns an error message for the person, or null. */
function validate(form: ConsentForm, libs: ReachableLibrary[]): string | null {
  if (!AGENT_ACTOR.test(form.actor)) {
    return "The ledger name must look like app/label, e.g. claude-ai/connector: lowercase letters, digits, dots, hyphens or underscores on each side of one slash.";
  }
  if (form.newLibrary !== "") {
    try {
      checkSlug(form.newLibrary);
    } catch (e) {
      return (e as OkfError).message;
    }
    if (libs.some((l) => l.role === "owner" && l.slug === form.newLibrary.toLowerCase())) {
      return `You already have a library named ${form.newLibrary}; pick it from the list.`;
    }
  }
  if (form.libraries === "selected") {
    if (form.selected.some((key) => !libs.some((l) => consentKey(l) === key))) {
      return "Pick libraries from the list.";
    }
    if (form.selected.length === 0 && form.newLibrary === "") {
      return "Pick at least one library, or name a new one.";
    }
  }
  if (form.prefix.includes("..")) return "The directory cannot contain '..'.";
  return null;
}

function html(body: string, headers?: Headers, status = 200): Response {
  const h = new Headers(headers);
  h.set("Content-Type", "text/html; charset=utf-8");
  h.set("X-Frame-Options", "DENY");
  h.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'",
  );
  return new Response(body, { status, headers: h });
}

function authError(e: unknown): Response {
  if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
  if (e instanceof AuthorizationError)
    return messagePage("Cannot connect this app", e.description, 400);
  if (e instanceof CimdFetchError) {
    return messagePage("Cannot connect this app", "This app could not be verified.", 400);
  }
  throw e;
}

/**
 * /authorize and /apps, for the signed-in person (spec: Apps under Auth). Consent lists their
 * own libraries and those shared with them, and a grant belongs to their account (v2 spec:
 * Tenancy); a shared library is reached at most at the person's role there (v2/sharing).
 */
export function registerAppRoutes<E extends AppEnv>(
  app: Hono<E>,
  deps: (env: Cloudflare.Env) => Deps,
) {
  app.get("/authorize", async (c) => {
    const d = deps(c.env);
    const accounts = d.accounts;
    const user = await signedIn(c.req.raw, d);
    if (user instanceof Response) return user;
    const oauth: OAuthHelpers = c.env.OAUTH_PROVIDER;
    try {
      const request = await oauth.parseAuthRequest(c.req.raw);
      const details = await oauth.describeConsent(request);
      const libs = await accounts.reachable(user.id);
      const consent = await oauth.beginConsent(request);
      return html(
        consentPage({
          details,
          handle: consent.handle,
          signedInAs: user.email,
          libraries: libs,
          form: defaultForm(request, details, libs),
        }),
        consent.headers,
      );
    } catch (e) {
      return authError(e);
    }
  });

  app.post("/authorize", async (c) => {
    const d = deps(c.env);
    const accounts = d.accounts;
    const user = await signedIn(c.req.raw, d);
    if (user instanceof Response) return user;
    const oauth: OAuthHelpers = c.env.OAUTH_PROVIDER;
    const body = await c.req.formData();
    const handle = String(body.get("handle") ?? "");
    try {
      if (body.get("decision") !== "approve") {
        const denied = await oauth.denyConsent(c.req.raw, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const form = readForm(body);
      const libs = await accounts.reachable(user.id);
      const problem = validate(form, libs);
      if (problem) {
        // The handle is still unused, so the same page can be shown again with the error. The
        // form posts to its own URL, so the original authorization request is in the query.
        const oauthReq = await oauth.parseAuthRequest(new Request(c.req.url)).catch(() => null);
        const details: ConsentDescription = oauthReq
          ? await oauth.describeConsent(oauthReq)
          : {
              clientId: "",
              clientName: "this app",
              redirectUri: "",
              redirectHost: "the app",
              redirectIsLoopback: false,
              scope: [],
            };
        return html(
          consentPage({
            details,
            handle,
            signedInAs: user.email,
            libraries: libs,
            form,
            error: problem,
          }),
          undefined,
          400,
        );
      }
      const scope = form.access === "write" ? ["okf:read", "okf:write"] : ["okf:read"];
      const approved = await oauth.approveConsent(c.req.raw, handle, { scope });
      const created = form.newLibrary ? await accounts.createLibrary(form.newLibrary, user) : null;
      const libraries: AccountGrant["libraries"] =
        form.libraries === "all"
          ? "all"
          : [
              ...libs.filter((l) => form.selected.includes(consentKey(l))).map((l) => l.id),
              ...(created ? [created.id] : []),
            ];
      const prefix = normalizeDir(form.prefix) || null;
      // Only a read-and-write connection with all tools keeps "Create libraries" (tenancy.ts
      // cannotCreate checks the same on every call).
      const create = form.create && form.access === "write" && form.tiers === "all";
      const grantId = crypto.randomUUID();
      // Who is connecting, as far as can be told (agents.ts): its sign-in domain is the
      // strongest signal; its name is a claim. Recorded as the person's agent on that platform.
      const described = await oauth.describeConsent(approved.request).catch(() => null);
      const host = described?.redirectHost ?? "";
      const client: ClientSignals = {
        name: described?.clientName ?? null,
        // A metadata-document client's own domain, else where its sign-in returns to (a
        // registered client's name is unverified, but only claude.ai receives at claude.ai).
        domain:
          described?.clientDomain ??
          (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) && !described?.redirectIsLoopback ? host : null),
        loopback: described?.redirectIsLoopback ?? false,
      };
      await accounts.recordAgent(user.id, connectionAgent(client));
      const props: GrantProps = {
        grant: {
          id: grantId,
          userId: user.id,
          actor: form.actor,
          scope: form.access,
          prefix,
          tiers: form.tiers,
          libraries,
          client,
          create,
        },
      };
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: user.id,
        metadata: {
          // The props' grant id, so /apps and deleting a library can find what it created.
          grant: grantId,
          libraries,
          create,
          actor: form.actor,
          access: form.access,
          prefix,
          tiers: form.tiers,
        },
        scope,
        props,
      });
      approved.headers.set("Location", redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    } catch (e) {
      if (e instanceof OkfError) return messagePage("Cannot connect this app", e.message, e.status);
      return authError(e);
    }
  });
}
