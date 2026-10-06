import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { createApp, type Deps } from "./app";
import { handleMcp, type McpContext } from "./mcp/server";
import { type GrantProps, SCOPES } from "./oauth/routes";
import { OkfError } from "./store/errors";
import { grantLibraries } from "./tenancy";
import { type Admission, admit, mcpWrites, tokenAdmission } from "./usage";

const HOUR = 3600;

/**
 * The Worker's fetch handler: Cloudflare's OAuth provider in front of everything (spec: Apps under
 * Auth). It serves OAuth discovery, /register and /token, guards /mcp (OAuth access tokens, or our
 * own bearer tokens through resolveExternalToken), and hands every other request to the app.
 *
 * The canonical resource is `<origin>/mcp`, so one provider is built per origin the Worker is
 * reached on (workers.dev, a custom domain, localhost in dev).
 */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** RFC 6750's answer to a token that no longer works: a Bearer challenge naming the metadata. */
function invalidToken(origin: string, why: string): Response {
  const e = new OkfError(401, "invalid_token", why);
  return Response.json(e.toJSON(), {
    status: 401,
    headers: {
      "WWW-Authenticate": `Bearer realm="OAuth", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="${why}"`,
      "Cache-Control": "no-store",
    },
  });
}

export function createWorker(deps: (env: Cloudflare.Env) => Deps): {
  fetch: NonNullable<ExportedHandler<Env>["fetch"]>;
} {
  const app = createApp(deps);
  const providers = new Map<string, OAuthProvider<Env>>();

  const providerFor = (origin: string) => {
    let provider = providers.get(origin);
    if (provider) return provider;
    const resource = `${origin}/mcp`;
    provider = new OAuthProvider<Env>({
      apiRoute: "/mcp",
      apiHandler: {
        async fetch(request, env, ctx) {
          const props = (ctx as unknown as { props: GrantProps }).props;
          const d = deps(env);
          // An app connection reaches the account's libraries as of now; a bearer token (or a
          // connection approved before account-level access) reaches its one library.
          let who: Admission;
          let caller: Pick<McpContext, "actor" | "scope" | "tiers" | "libraries">;
          if (props.grant) {
            const g = props.grant;
            const reach = await grantLibraries(d.accounts, g);
            // The account is gone (deleted, or a data reset) or suspended: the token is dead.
            // Say so as OAuth does, so the client signs in again instead of showing no tools.
            if (!reach) return invalidToken(origin, "This account is suspended or deleted.");
            who = { key: `grant:${g.id}|${g.actor}`, account: reach.user.handle };
            caller = {
              actor: g.actor,
              scope: g.scope,
              tiers: g.tiers,
              libraries: reach.libraries,
            };
          } else if (props.token) {
            const t = props.token;
            who = tokenAdmission(t);
            caller = {
              actor: t.actor,
              scope: t.scope,
              tiers: t.mcp_tiers,
              libraries: [t],
            };
          } else {
            return new Response(null, { status: 401 });
          }
          let write = false;
          if (request.method === "POST") {
            write = mcpWrites(
              await request
                .clone()
                .json()
                .catch(() => null),
            );
          }
          try {
            await admit(d, who, write);
          } catch (e) {
            if (e instanceof OkfError) return Response.json(e.toJSON(), { status: e.status });
            throw e;
          }
          return handleMcp(request, {
            ...caller,
            open: (t) => d.library(t),
            blobs: d.blobs,
            origin,
          });
        },
      },
      defaultHandler: { fetch: (request, env, ctx) => app.fetch(request, env, ctx) },
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/token",
      clientRegistrationEndpoint: "/register",
      clientIdMetadataDocumentEnabled: true,
      scopesSupported: SCOPES,
      accessTokenTTL: HOUR,
      refreshTokenTTL: 30 * 24 * HOUR,
      resourceMetadata: {
        resource,
        authorization_servers: [origin],
        bearer_methods_supported: ["header"],
        resource_name: "Tempra",
      },
      // Bearer tokens minted for Claude Code, scripts and scheduled tasks keep working on /mcp.
      resolveExternalToken: async ({ token, env }) => {
        try {
          const info = await deps(env).authenticate(token);
          const props: GrantProps = { token: info };
          return { props, audience: resource };
        } catch {
          return null;
        }
      },
    });
    providers.set(origin, provider);
    return provider;
  };

  return {
    fetch(request, env, ctx) {
      const url = new URL(request.url);
      // Plain http reaches the Worker when the zone does not force https. Only https (or a
      // loopback host in dev) is an origin: the OAuth metadata and session cookies need it.
      if (url.protocol === "http:" && !LOOPBACK.has(url.hostname)) {
        url.protocol = "https:";
        return Response.redirect(url.toString(), 308);
      }
      return providerFor(url.origin).fetch(request, env, ctx);
    },
  };
}
