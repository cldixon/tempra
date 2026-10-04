import { type FormEvent, useState } from "react";
import { ApiError, api, useLoad } from "../api";
import { navigate } from "../router";
import { Chip, Status, useTitle } from "../ui";
import { Urls } from "../urls";

interface Library {
  id: string;
  owner: string;
  slug: string;
  seq?: number;
  concepts?: number;
  attachments?: number;
  open_work?: number;
}

export function Libraries() {
  useTitle("Libraries");
  const loaded = useLoad("libraries", () =>
    api<{ libraries: Library[] }>("/api/v1/libraries").then((r) => r.libraries),
  );
  return (
    <>
      <h1>Libraries</h1>
      <Status loaded={loaded}>
        {(libs) => (
          <>
            {libs.length === 0 ? (
              <p>No libraries yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="list">
                  <thead>
                    <tr>
                      <th>Library</th>
                      <th>Concepts</th>
                      <th>Attachments</th>
                      <th>Work queue</th>
                      <th>Seq</th>
                    </tr>
                  </thead>
                  <tbody>
                    {libs.map((l) => (
                      <tr key={l.id}>
                        <td className="name">
                          <a href={new Urls(l.owner, l.slug).tree("")}>
                            <strong>{l.slug}</strong>
                          </a>
                        </td>
                        <td>{l.concepts}</td>
                        <td>{l.attachments}</td>
                        <td>
                          {l.open_work ? (
                            <Chip text={`${l.open_work} open`} tone="warn" />
                          ) : (
                            <Chip text="none" tone="ok" />
                          )}
                        </td>
                        <td className="muted">{l.seq}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <NewLibrary />
            {libs.length > 0 && (
              <p>
                <a href="/connect">Connect an agent</a> to your libraries.
              </p>
            )}
          </>
        )}
      </Status>
    </>
  );
}

function NewLibrary() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
    <>
      {error && <div className="notice">{error}</div>}
      <form className="inline" onSubmit={submit}>
        <label className="small" htmlFor="slug">
          New library
        </label>{" "}
        <input
          id="slug"
          name="slug"
          type="text"
          placeholder="team-notes"
          required
          pattern="[a-z0-9][a-z0-9\-]{0,62}"
        />{" "}
        <button type="submit" disabled={busy}>
          Create
        </button>
      </form>
    </>
  );
}
