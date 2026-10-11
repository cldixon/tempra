import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiError, api, useLoad } from "../api";
import { Icon } from "../chrome";
import { navigate } from "../router";
import { type Health, healthWords, Status, useTitle } from "../ui";
import { Urls } from "../urls";

interface Library {
  id: string;
  owner: string;
  slug: string;
  /** Shared libraries carry the person's role there (tempra-dev: v2/sharing). */
  role?: "owner" | "write" | "read";
  seq?: number;
  concepts?: number;
  attachments?: number;
  open_work?: number;
  /** The daily check's summary: open work by kind (TEMPRA-66). */
  health?: Health;
  /** Since the person last looked (TEMPRA-72): changes by others, and items for them here. */
  tally?: { changes: number; for_you: number };
}

/** A library's tally as a few words: "2 for you · 5 new"; empty for none. */
export function tallyText(l: Pick<Library, "tally">): string {
  const parts: string[] = [];
  if (l.tally?.for_you) parts.push(`${l.tally.for_you} for you`);
  if (l.tally?.changes) parts.push(`${l.tally.changes} new`);
  return parts.join(" · ");
}

/** The account's libraries: one row each, a New button, and how agents get in. */
export function Libraries() {
  useTitle("Libraries");
  const loaded = useLoad("libraries", () =>
    api<{ libraries: Library[] }>("/api/v1/libraries").then((r) => r.libraries),
  );
  const [creating, setCreating] = useState(false);
  const invited = useLoad("invitations", () =>
    api<{ invitations: unknown[] }>("/api/v1/invitations"),
  );
  const waiting = invited.state === "ready" ? invited.data.invitations.length : 0;
  return (
    <>
      <div className="page-head">
        <h1>Libraries</h1>
        <button
          type="button"
          className="pill-button"
          aria-expanded={creating}
          onClick={() => setCreating((c) => !c)}
        >
          <Icon name="plus" />
          New
        </button>
      </div>
      {creating && <NewLibrary onCancel={() => setCreating(false)} />}
      {waiting > 0 && (
        <p>
          <a href="/invitations">
            {waiting === 1 ? "An invitation" : `${waiting} invitations`} to a library
          </a>{" "}
          {waiting === 1 ? "is" : "are"} waiting for you.
        </p>
      )}
      <Status loaded={loaded}>
        {(libs) => {
          const owners = new Set(libs.map((l) => l.owner));
          return (
            <>
              {libs.length === 0 ? (
                <p className="muted">No libraries yet.</p>
              ) : (
                <ul className="lib-list">
                  {libs.map((l) => (
                    <li key={l.id}>
                      <a href={new Urls(l.owner, l.slug).tree("")}>
                        {/* Another account's library (shared) says whose it is. */}
                        {owners.size > 1 && <span className="owner">{l.owner}/</span>}
                        {l.slug}
                        {tallyText(l) && <span className="tally">{tallyText(l)}</span>}
                        {l.health && healthWords(l.health.counts) && (
                          <span className="lib-health">{healthWords(l.health.counts)}</span>
                        )}
                      </a>
                      {l.role && l.role !== "owner" && <span className="faint"> {l.role}</span>}
                    </li>
                  ))}
                </ul>
              )}
              <p className="page-foot">
                Agents write to a library over MCP. <a href="/connect">Connect an agent</a> or{" "}
                <a href="/tokens">mint a token</a>.
              </p>
            </>
          );
        }}
      </Status>
    </>
  );
}

function NewLibrary({ onCancel }: { onCancel(): void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const slug = String(new FormData(e.currentTarget).get("slug") ?? "");
    setBusy(true);
    setError(null);
    try {
      const lib = await api<Library>("/api/v1/libraries", {
        method: "POST",
        body: JSON.stringify({ slug }),
      });
      navigate(new Urls(lib.owner, lib.slug).tree(""));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <form className="new-library" onSubmit={submit}>
      <label htmlFor="slug">New library</label>
      <input
        ref={input}
        id="slug"
        name="slug"
        type="text"
        placeholder="team-notes"
        required
        pattern="[a-z0-9][a-z0-9\-]{0,62}"
      />
      <button className="primary" type="submit" disabled={busy}>
        Create
      </button>
      <button type="button" className="ghost" onClick={onCancel}>
        Cancel
      </button>
      {error && <div className="notice">{error}</div>}
    </form>
  );
}
