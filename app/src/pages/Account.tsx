import { type FormEvent, useState } from "react";
import { api, field, useAction, useLoad } from "../api";
import { type Me, Status, useScrollToHash, useTitle, when } from "../ui";
import { Urls } from "../urls";

/** The landing page's legal pages (TEMPRA-14). */
export const LEGAL = "https://tempra.dev";

/** The skill agents follow to work in a library (skills/okf/SKILL.md). */
const SKILL_URL = "https://github.com/cldixon/tempra/blob/main/skills/okf/SKILL.md";

const post = (url: string, body: unknown, method = "POST") =>
  api(url, { method, body: JSON.stringify(body) });

// ---------------------------------------------------------------- first run

/** First run (v2 spec: Onboarding): pick a handle and name the first library. */
export function Welcome({ me }: { me: Me | null }) {
  useTitle("Welcome");
  const { busy, error, run } = useAction();
  if (!me) return <p className="muted">Loading…</p>;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const handle = field(form, "handle");
    const slug = field(form, "library");
    const starter = new FormData(form).get("starter") === "1";
    void run(async () => {
      if (handle.toLowerCase() !== me.handle)
        await post("/api/v1/account/handle", { handle }, "PUT");
      const lib = await api<{ owner: string; slug: string }>("/api/v1/libraries", {
        method: "POST",
        body: JSON.stringify({ slug, starter }),
      });
      // A full load: the header and links follow the new handle.
      location.assign(new Urls(lib.owner, lib.slug).connect());
    });
  };
  return (
    <>
      <h1>Welcome</h1>
      {error && <div className="notice">{error}</div>}
      <form onSubmit={submit}>
        <p>
          <label>
            Handle <input type="text" name="handle" defaultValue={me.handle} required />
          </label>
        </p>
        <p>
          <label>
            First library <input type="text" name="library" defaultValue="notes" required />
          </label>
        </p>
        <p>
          <label>
            <input type="checkbox" name="starter" value="1" defaultChecked /> Add a start-here note
          </label>
        </p>
        <p>
          <button className="primary" type="submit" disabled={busy}>
            Create
          </button>
        </p>
      </form>
    </>
  );
}

// ---------------------------------------------------------------- connecting an agent

/** How to connect each kind of client; `slug` names the library when the page is about one. */
export function ConnectSteps({ slug }: { slug?: string }) {
  const mcp = `${location.origin}/mcp`;
  return (
    <>
      <h2>claude.ai</h2>
      <p>
        Add a custom connector with this URL. When asked,{" "}
        {slug
          ? `choose All libraries, or select ${slug}`
          : "choose All libraries, or select the ones it may use"}
        .
      </p>
      <pre>{mcp}</pre>
      <h2>Claude Code</h2>
      <pre>claude mcp add --transport http tempra {mcp}</pre>
      <p>Then run /mcp in Claude Code to sign in.</p>
      <h2>Other clients</h2>
      <p>
        <a href={slug ? `/tokens?library=${encodeURIComponent(slug)}` : "/tokens"}>
          Create a token
        </a>
      </p>
      <h2>Skill</h2>
      <p>
        <a href={SKILL_URL}>SKILL.md</a>
      </p>
    </>
  );
}

/** /connect: connecting an agent to the account (connections reach all or selected libraries). */
export function ConnectAccount() {
  useTitle("Connect an agent");
  return (
    <>
      <h1>Connect an agent</h1>
      <p>One connection can reach all your libraries, or the ones you select.</p>
      <ConnectSteps />
      <h2>Connected apps</h2>
      <p>
        <a href="/apps">See and revoke connections</a>
      </p>
    </>
  );
}

// ---------------------------------------------------------------- tokens

interface TokenRow {
  id: string;
  library: string;
  actor: string;
  scope: string;
  prefix: string | null;
  expires: string | null;
  mcp_tiers: string;
  created_by: string | null;
  revoked: string | null;
}

interface Minted {
  secret: string;
  actor: string;
  library: string;
}

/** Tokens for agents and scripts (spec: Auth, identity and actors). */
export function Tokens({ me, library }: { me: Me | null; library: string | null }) {
  useTitle("Tokens");
  const loaded = useLoad("tokens", async () => {
    const [t, l] = await Promise.all([
      api<{ tokens: TokenRow[] }>("/api/v1/tokens"),
      api<{ libraries: { owner: string; slug: string; role?: string }[] }>("/api/v1/libraries"),
    ]);
    // An own library by its slug; one shared with the person as owner/slug, the name the
    // server mints on (a member's token is held to their role there).
    const names = l.libraries.map((x) =>
      (x.role ?? "owner") === "owner" ? x.slug : `${x.owner}/${x.slug}`,
    );
    return { tokens: t.tokens, libraries: names };
  });
  const [minted, setMinted] = useState<Minted | null>(null);
  const action = useAction();
  if (minted) return <TokenCreated minted={minted} onDone={() => setMinted(null)} />;
  const create = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = (k: string) => field(form, k);
    void action.run(async () => {
      const res = await api<Minted>("/api/v1/tokens", {
        method: "POST",
        body: JSON.stringify({
          library: f("library"),
          actor: f("actor"),
          scope: f("scope") === "read" ? "read" : "write",
          prefix: f("prefix") || null,
          expires: f("expires") || null,
          mcp_tiers: f("tiers") === "files" ? "files" : "all",
        }),
      });
      loaded.reload();
      setMinted(res);
    });
  };
  const revoke = (id: string) =>
    action.run(async () => {
      await api(`/api/v1/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
      loaded.reload();
    });
  const now = Date.now();
  return (
    <>
      <h1>Tokens</h1>
      <Status loaded={loaded}>
        {({ tokens, libraries }) => (
          <>
            {tokens.length === 0 ? (
              <p className="muted">No tokens yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="list">
                  <thead>
                    <tr>
                      <th>Actor</th>
                      <th>Access</th>
                      <th />
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.map((t) => {
                      const expired = t.expires !== null && Date.parse(t.expires) <= now;
                      return (
                        <tr key={t.id}>
                          <td className="name">
                            <strong>{t.actor}</strong>
                            <div className="small muted">
                              {t.library}
                              {t.prefix ? ` · ${t.prefix}/ only` : ""}
                              {t.mcp_tiers === "files" ? " · file tools only" : ""}
                            </div>
                          </td>
                          <td>{t.scope}</td>
                          <td className="small muted nowrap">
                            {t.expires ? `expires ${when(t.expires)}` : "no expiry"}
                            {t.created_by && (
                              <>
                                <br />
                                by {t.created_by}
                              </>
                            )}
                          </td>
                          <td>
                            {t.revoked ? (
                              <span className="chip bad">revoked</span>
                            ) : expired ? (
                              <span className="chip warn">expired</span>
                            ) : (
                              <span className="chip ok">active</span>
                            )}
                          </td>
                          <td>
                            {!t.revoked && !expired && (
                              <button
                                type="button"
                                disabled={action.busy}
                                onClick={() => void revoke(t.id)}
                              >
                                Revoke
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="panel-box">
              <h2>New token</h2>
              {action.error && <div className="notice">{action.error}</div>}
              {libraries.length === 0 ? (
                <p className="muted">Create a library first.</p>
              ) : (
                <form className="token" onSubmit={create}>
                  <p>
                    <label>
                      Library{" "}
                      <select name="library" defaultValue={library ?? libraries[0]}>
                        {libraries.map((l) => (
                          <option key={l} value={l}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </label>
                  </p>
                  <p>
                    <label>
                      Actor{" "}
                      <input type="text" name="actor" placeholder="claude-code/laptop" required />
                    </label>{" "}
                    app/label, process:name, or {me?.actor ?? "human:you"}
                  </p>
                  <p>
                    <label className="choice">
                      <input type="radio" name="scope" value="write" defaultChecked /> Read and
                      write
                    </label>{" "}
                    <label className="choice">
                      <input type="radio" name="scope" value="read" /> Read only
                    </label>
                  </p>
                  <p>
                    <label>
                      Directory <input type="text" name="prefix" placeholder="whole library" />
                    </label>{" "}
                    <label>
                      Expires <input type="date" name="expires" />
                    </label>
                  </p>
                  <p>
                    <label className="choice">
                      <input type="radio" name="tiers" value="all" defaultChecked /> All MCP tools
                    </label>{" "}
                    <label className="choice">
                      <input type="radio" name="tiers" value="files" /> File tools only
                    </label>
                  </p>
                  <button className="primary" type="submit" disabled={action.busy}>
                    Create token
                  </button>
                </form>
              )}
            </div>
          </>
        )}
      </Status>
    </>
  );
}

function TokenCreated({ minted, onDone }: { minted: Minted; onDone(): void }) {
  useTitle("Token created");
  const cmd = `claude mcp add --transport http ${minted.library} ${location.origin}/mcp --header "Authorization: Bearer ${minted.secret}"`;
  return (
    <>
      <h1>Token created</h1>
      <p>Shown once. Copy it now.</p>
      <p>
        For <strong>{minted.actor}</strong> on <strong>{minted.library}</strong>:
      </p>
      <pre className="src wrap" id="token-secret">
        {minted.secret}
      </pre>
      <p className="small muted">Claude Code:</p>
      <pre className="src wrap">{cmd}</pre>
      <p>
        <button type="button" onClick={onDone}>
          Back to tokens
        </button>
      </p>
    </>
  );
}

// ---------------------------------------------------------------- connected apps

interface AppGrant {
  id: string;
  app: string;
  actor: string | null;
  libraries: "all" | string[];
  access: "read" | "write";
  prefix: string | null;
  tiers: "all" | "files";
  created: string;
}

/** Apps connected over OAuth (claude.ai, Claude Code) and what each may reach. */
export function Apps() {
  useTitle("Connected apps");
  const loaded = useLoad("apps", () => api<{ apps: AppGrant[] }>("/api/v1/apps"));
  const action = useAction();
  const [notice, setNotice] = useState<string | null>(null);
  const revoke = (id: string) =>
    action.run(async () => {
      await api(`/api/v1/apps/${encodeURIComponent(id)}`, { method: "DELETE" });
      setNotice("Connection revoked.");
      loaded.reload();
    });
  return (
    <>
      <h1>Connected apps</h1>
      {notice && <div className="notice ok">{notice}</div>}
      {action.error && <div className="notice">{action.error}</div>}
      <Status loaded={loaded}>
        {({ apps }) =>
          apps.length === 0 ? (
            <p>None.</p>
          ) : (
            <div className="table-wrap">
              <table className="list">
                <thead>
                  <tr>
                    <th>App</th>
                    <th>Libraries</th>
                    <th>Access</th>
                    <th>Since</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {apps.map((a) => (
                    <tr key={a.id}>
                      <td className="name">
                        <strong>{a.app}</strong>
                        {a.actor && <div className="small muted">{a.actor}</div>}
                      </td>
                      <td>
                        {a.libraries === "all"
                          ? "All libraries"
                          : a.libraries.length > 0
                            ? a.libraries.join(", ")
                            : "None (deleted)"}
                        {a.prefix && <div className="small muted">under {a.prefix}/</div>}
                      </td>
                      <td>
                        {a.access === "write" ? "Read and write" : "Read only"}
                        {a.tiers === "files" && <div className="small muted">file tools only</div>}
                      </td>
                      <td className="small muted">{a.created.slice(0, 10)}</td>
                      <td>
                        <button
                          type="button"
                          disabled={action.busy}
                          onClick={() => void revoke(a.id)}
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Status>
    </>
  );
}

// ---------------------------------------------------------------- invitations

interface PendingInvitation {
  id: string;
  owner: string;
  slug: string;
  role: "read" | "write";
  /** Who invited. */
  handle: string;
  expires: string;
}

/** Invitations to other people's libraries (tempra-dev: v2/sharing), to accept or decline. */
export function Invitations() {
  useTitle("Invitations");
  const loaded = useLoad("invitations", () =>
    api<{ invitations: PendingInvitation[] }>("/api/v1/invitations"),
  );
  const action = useAction();
  const answer = (i: PendingInvitation, accept: boolean) =>
    action.run(async () => {
      await api(
        `/api/v1/invitations/${encodeURIComponent(i.id)}/${accept ? "accept" : "decline"}`,
        {
          method: "POST",
        },
      );
      if (accept) {
        // A full load: the library list and the workspace learn the new library.
        location.assign(new Urls(i.owner, i.slug).tree(""));
        return;
      }
      loaded.reload();
    });
  return (
    <>
      <h1>Invitations</h1>
      {action.error && <div className="notice">{action.error}</div>}
      <Status loaded={loaded}>
        {({ invitations }) =>
          invitations.length === 0 ? (
            <p>None waiting.</p>
          ) : (
            <div className="table-wrap">
              <table className="list">
                <thead>
                  <tr>
                    <th>Library</th>
                    <th>Access</th>
                    <th>From</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((i) => (
                    <tr key={i.id}>
                      <td className="name">
                        <strong>
                          {i.owner}/{i.slug}
                        </strong>
                        <div className="small muted">open until {i.expires.slice(0, 10)}</div>
                      </td>
                      <td>{i.role === "write" ? "Read and write" : "Read and comment"}</td>
                      <td>@{i.handle}</td>
                      <td>
                        <button
                          type="button"
                          className="primary"
                          disabled={action.busy}
                          onClick={() => void answer(i, true)}
                        >
                          Accept
                        </button>{" "}
                        <button
                          type="button"
                          disabled={action.busy}
                          onClick={() => void answer(i, false)}
                        >
                          Decline
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Status>
    </>
  );
}

// ---------------------------------------------------------------- the account page

interface AccountData {
  email: string;
  handle: string;
  actor: string;
  sessions: {
    id: string;
    created: string;
    last_seen: string;
    user_agent: string | null;
    current: boolean;
  }[];
  usage: { libraries: number; tokens: number };
  limits: { libraries: number; tokens: number };
}

const DONE: Record<string, string> = {
  email: "Your email is changed.",
};

/** The account: email, handle, limits, sessions, deleting it (v2 spec: Accounts). */
export function Account({ done }: { done: string | null }) {
  useTitle("Account");
  const loaded = useLoad("account", () => api<AccountData>("/api/v1/account"));
  const action = useAction();
  const [notice, setNotice] = useState<string | null>(done ? (DONE[done] ?? null) : null);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  if (deleted) {
    return (
      <>
        <h1>Account deleted</h1>
        <p>
          <a href={LEGAL}>tempra.dev</a>
        </p>
      </>
    );
  }
  const changeEmail = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = field(e.currentTarget, "email");
    void action.run(async () => {
      const res = await api<{ sent_to: string; dev_link?: string }>("/api/v1/account/email", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setNotice(`Check ${res.sent_to} for a link.`);
      setDevLink(res.dev_link ?? null);
    });
  };
  const changeHandle = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const handle = field(e.currentTarget, "handle");
    void action.run(async () => {
      await post("/api/v1/account/handle", { handle }, "PUT");
      // A full load: the header and every library link follow the new handle.
      location.assign("/account");
    });
  };
  const endSession = (id: string) =>
    action.run(async () => {
      await api(`/api/v1/account/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      loaded.reload();
    });
  const remove = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const confirm = field(e.currentTarget, "confirm");
    void action.run(async () => {
      await post("/api/v1/account/delete", { confirm });
      setDeleted(true);
    });
  };
  return (
    <>
      <h1>Account</h1>
      {notice && <div className="notice ok">{notice}</div>}
      {devLink && (
        <p>
          Local dev, no email sent:{" "}
          <a id="dev-link" href={devLink}>
            confirm the new email
          </a>
        </p>
      )}
      {action.error && <div className="notice">{action.error}</div>}
      <Status loaded={loaded}>
        {(a) => (
          <>
            <form onSubmit={changeEmail}>
              <p>
                <label>
                  Email <input type="text" name="email" defaultValue={a.email} required />
                </label>{" "}
                <button type="submit" disabled={action.busy}>
                  Change
                </button>
              </p>
            </form>
            <form onSubmit={changeHandle}>
              <p>
                <label>
                  Handle <input type="text" name="handle" defaultValue={a.handle} required />
                </label>{" "}
                <button type="submit" disabled={action.busy}>
                  Change
                </button>
              </p>
            </form>
            <p>Actor: {a.actor}</p>
            <h2>Limits</h2>
            <p>
              Libraries: {a.usage.libraries} of {a.limits.libraries}. Active tokens:{" "}
              {a.usage.tokens} of {a.limits.tokens}.
            </p>
            <MailSettings />
            <h2>Sessions</h2>
            <div className="table-wrap">
              <table className="list">
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Last seen</th>
                    <th>Device</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {a.sessions.map((s) => (
                    <tr key={s.id}>
                      <td className="when">{when(s.created)}</td>
                      <td className="when">{when(s.last_seen)}</td>
                      <td className="small muted">{s.user_agent ?? ""}</td>
                      <td>
                        {s.current ? (
                          "this device"
                        ) : (
                          <button
                            type="button"
                            disabled={action.busy}
                            onClick={() => void endSession(s.id)}
                          >
                            Sign out
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Signing out stays a server form: it must work whatever state the app is in. */}
            <div className="actions">
              <form method="post" action="/sign-out">
                <button type="submit">Sign out</button>
              </form>
              <form method="post" action="/sign-out/everywhere">
                <button type="submit">Sign out everywhere</button>
              </form>
            </div>
            <h2>Delete account</h2>
            <p>Deletes every library you own. Export them first.</p>
            <form onSubmit={remove}>
              <p>
                <label>
                  Type {a.handle} to confirm{" "}
                  <input type="text" name="confirm" autoComplete="off" required />
                </label>
              </p>
              <p>
                <button type="submit" disabled={action.busy}>
                  Delete account
                </button>
              </p>
            </form>
            <p>
              <a href={`${LEGAL}/terms`}>Terms</a> · <a href={`${LEGAL}/privacy`}>Privacy</a>
            </p>
          </>
        )}
      </Status>
    </>
  );
}

// ---------------------------------------------------------------- notification mail

interface MailPrefs {
  immediate: boolean;
  digest: boolean;
  libraries: { library: string; immediate: boolean | null; digest: boolean | null }[];
}

/** A library's setting as the select shows it: following the account, on or off. */
const choice = (v: boolean | null) => (v === null ? "" : v ? "on" : "off");
const fromChoice = (v: string) => (v === "" ? null : v === "on");

/**
 * What the person is mailed (TEMPRA-74): what is addressed to them, batched, and an opt-in daily
 * digest; each library can follow the account or differ. Every change saves at once.
 */
function MailSettings() {
  const loaded = useLoad("mail-prefs", () => api<MailPrefs>("/api/v1/account/notifications"));
  // Mail's "Mail settings" link lands here (#notifications).
  useScrollToHash(loaded.state === "ready");
  const action = useAction();
  const save = (body: Record<string, unknown>) =>
    action.run(async () => {
      await post("/api/v1/account/notifications", body, "PUT");
      loaded.reload();
    });
  return (
    <>
      <h2 id="notifications">Notifications</h2>
      {action.error && <div className="notice">{action.error}</div>}
      <Status loaded={loaded}>
        {(p) => (
          <>
            <p>
              <label>
                <input
                  type="checkbox"
                  checked={p.immediate}
                  disabled={action.busy}
                  onChange={(e) => void save({ immediate: e.currentTarget.checked })}
                />{" "}
                Mail me replies, mentions and new threads on what I wrote
              </label>
            </p>
            <p>
              <label>
                <input
                  type="checkbox"
                  checked={p.digest}
                  disabled={action.busy}
                  onChange={(e) => void save({ digest: e.currentTarget.checked })}
                />{" "}
                Mail me a daily digest of my libraries
              </label>
            </p>
            {p.libraries.length > 0 && (
              <div className="table-wrap">
                <table className="list">
                  <thead>
                    <tr>
                      <th>Library</th>
                      <th>Mail</th>
                      <th>Digest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.libraries.map((l) => (
                      <tr key={l.library}>
                        <td className="name">{l.library}</td>
                        {(["immediate", "digest"] as const).map((k) => (
                          <td key={k}>
                            <select
                              aria-label={`${k === "immediate" ? "Mail" : "Digest"} for ${l.library}`}
                              value={choice(l[k])}
                              disabled={action.busy}
                              onChange={(e) =>
                                void save({
                                  library: l.library,
                                  [k]: fromChoice(e.currentTarget.value),
                                })
                              }
                            >
                              <option value="">As above ({p[k] ? "on" : "off"})</option>
                              <option value="on">On</option>
                              <option value="off">Off</option>
                            </select>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Status>
    </>
  );
}
