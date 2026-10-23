import { type FormEvent, useState } from "react";
import { ApiError, api, useLoad } from "../api";
import { Icon } from "../chrome";
import { ComposeDialog } from "../Dialog";
import { libraryLabel } from "../role";
import { navigate } from "../router";
import { LibraryTile } from "../Sidebar";
import { type Health, plural, Status, useMe, useTitle } from "../ui";
import { Urls } from "../urls";
import { PageBar } from "../Workspace";

interface Library {
  id: string;
  owner: string;
  slug: string;
  /** Shared libraries carry the person's role there (tempra-dev: v2/sharing). */
  role?: "owner" | "write" | "read";
  title?: string;
  description?: string;
  seq?: number;
  concepts?: number;
  attachments?: number;
  open_work?: number;
  /** The daily check's summary: open work by kind (TEMPRA-66). */
  health?: Health;
  /** Since the person last looked (TEMPRA-72): changes by others, and items for them here. */
  tally?: { changes: number; for_you?: number };
  /** Its summary could not be read just now (TEMPRA-23): listed and linked, without counts. */
  unavailable?: boolean;
}

/**
 * The account's libraries (take 4, board 01): cards under Yours and Shared with you, each with
 * its title, what is for the person there, its description and one line of facts; New library
 * in the top bar (and from the switcher's menu, which lands here with ?new=1).
 */
export function Libraries({ create }: { create: boolean }) {
  useTitle("Libraries");
  const loaded = useLoad("libraries", () =>
    api<{ libraries: Library[] }>("/api/v1/libraries").then((r) => r.libraries),
  );
  const [creating, setCreating] = useState(create);
  const invited = useLoad("invitations", () =>
    api<{ invitations: unknown[] }>("/api/v1/invitations"),
  );
  const waiting = invited.state === "ready" ? invited.data.invitations.length : 0;
  return (
    <>
      <PageBar
        actions={
          <button
            type="button"
            className="tool-pill primary"
            aria-haspopup="dialog"
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" />
            New library
          </button>
        }
      />
      <h1>Libraries</h1>
      <NewLibrary open={creating} onClose={() => setCreating(false)} />
      {waiting > 0 && (
        <p>
          <a href="/inbox">
            {waiting === 1 ? "An invitation" : `${waiting} invitations`} to a library
          </a>{" "}
          {waiting === 1 ? "is" : "are"} waiting for you.
        </p>
      )}
      <Status loaded={loaded}>
        {(libs) => {
          const yours = libs.filter((l) => (l.role ?? "owner") === "owner");
          const shared = libs.filter((l) => (l.role ?? "owner") !== "owner");
          return (
            <>
              {libs.length === 0 && <p className="muted">No libraries yet.</p>}
              {yours.length > 0 && <Cards title="Yours" libraries={yours} />}
              {shared.length > 0 && <Cards title="Shared with you" libraries={shared} />}
            </>
          );
        }}
      </Status>
    </>
  );
}

/** One section of cards. */
function Cards({ title, libraries }: { title: string; libraries: Library[] }) {
  return (
    <section aria-label={title}>
      <h2 className="lib-section-title">{title}</h2>
      <ul className="lib-cards">
        {libraries.map((l) => (
          <li key={l.id}>
            <Card library={l} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A library as a card: a quiet cover with its tile, then its name, description and facts. */
function Card({ library: l }: { library: Library }) {
  const shared = (l.role ?? "owner") !== "owner";
  const name = l.title || l.slug;
  const facts: string[] = [];
  if (shared) facts.push(l.role === "write" ? "Write" : "Read");
  if (typeof l.concepts === "number") facts.push(plural(l.concepts, "page"));
  if (l.unavailable) facts.push("couldn't load just now");
  const forYou = l.tally?.for_you ? `${l.tally.for_you} for you` : "";
  return (
    <a className="lib-card" href={new Urls(l.owner, l.slug).tree("")}>
      <span className="lib-card-cover">
        <LibraryTile name={name} shared={shared} />
        {l.tally?.changes ? (
          <span className="lib-card-live">
            <span className="change-dot" aria-hidden="true" />
            {plural(l.tally.changes, "change")} since you looked
          </span>
        ) : null}
      </span>
      <span className="lib-card-body">
        <span className="lib-card-name">
          <span>{libraryLabel(l)}</span>
          {forYou && <span className="lib-card-for">{forYou}</span>}
        </span>
        {l.description && <span className="lib-card-desc">{l.description}</span>}
        {facts.length > 0 && <span className="lib-card-meta">{facts.join(" · ")}</span>}
      </span>
    </a>
  );
}

/** A library's address from its name: lowercase letters, digits and dashes, as the server checks. */
export function slugFrom(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 63)
    .replace(/-+$/, "");
}

/**
 * New library, as a compose dialog over the list: its name, a description, and its address
 * (filled in from the name until the person edits it). Creating opens the new library.
 */
function NewLibrary({ open, onClose }: { open: boolean; onClose(): void }) {
  const me = useMe();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const address = slug ?? slugFrom(title);
  const close = () => {
    setTitle("");
    setSlug(null);
    setError(null);
    onClose();
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const description = String(new FormData(e.currentTarget).get("description") ?? "")
      .replace(/\s+/g, " ")
      .trim();
    setBusy(true);
    setError(null);
    try {
      const lib = await api<Library>("/api/v1/libraries", {
        method: "POST",
        body: JSON.stringify({
          slug: address,
          title: title.trim() || undefined,
          description: description || undefined,
        }),
      });
      navigate(new Urls(lib.owner, lib.slug).tree(""));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <ComposeDialog
      open={open}
      onClose={close}
      context={me ? `@${me.handle}` : "You"}
      title="New library"
      action="Create library"
      busy={busy}
      error={error}
      onSubmit={submit}
      fields={
        <label className="compose-field">
          <span className={me ? "compose-prefix" : undefined}>
            {me ? `${me.handle}/` : "Address"}
          </span>
          <input
            name="slug"
            type="text"
            aria-label="Address"
            placeholder="team-notes"
            required
            pattern="[a-z0-9][a-z0-9\-]{0,62}"
            title="Lowercase letters, digits and dashes"
            value={address}
            onChange={(e) => setSlug(e.currentTarget.value)}
          />
        </label>
      }
    >
      <input
        className="compose-title"
        name="title"
        type="text"
        aria-label="Name"
        placeholder="Library name"
        maxLength={120}
        autoComplete="off"
        data-autofocus
        value={title}
        onChange={(e) => setTitle(e.currentTarget.value)}
      />
      <textarea
        className="compose-text"
        name="description"
        aria-label="Description"
        placeholder="Add a description…"
        maxLength={300}
        rows={3}
      />
    </ComposeDialog>
  );
}
