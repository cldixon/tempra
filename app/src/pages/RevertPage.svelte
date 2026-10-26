<script lang="ts">
  import { type LedgerRequest, loadTitles, touchedBy } from "../activity";
  import { useAgentNames } from "../agents.svelte.ts";
  import { api, field } from "../api";
  import { useAction, useLoad } from "../load.svelte.ts";
  import Moment from "../Moment.svelte";
  import { navigate } from "../router";
  import Status from "../Status.svelte";
  import { useMe } from "../ui.svelte.ts";
  import type { Urls } from "../urls";
  import { folderOf, json, WHAT_WORDS } from "./manage";

  let { urls, request }: { urls: Urls; request: string } = $props();
  const loaded = useLoad(
    () => `revert ${urls.revert(request)}`,
    () => api<LedgerRequest>(urls.api(`requests/${encodeURIComponent(request)}`)),
  );
  // One load of the library's titles, shared by home and Activity (activity's useTitles).
  const titles = useLoad(
    () => `titles ${urls.base}`,
    () => loadTitles(urls),
  );
  /** "you" for the signed-in person, an agent by its name, another person by their handle. */
  const me = useMe();
  const names = useAgentNames(() => urls);
  const name = (actor: string, by?: LedgerRequest["by"]) =>
    me.current && actor === me.current.actor && !by?.agent ? "you" : names.label(actor, by);
  const action = useAction();

  function submit(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
    e.preventDefault();
    const note = field(e.currentTarget, "note");
    void action.run(async () => {
      const res = await api<{ results: unknown[] }>(
        urls.api("revert"),
        json({ request_id: request, note }),
      );
      navigate(`${urls.ledger()}?done=revert&n=${res.results.length}`);
    });
  }
</script>

<Status loaded={loaded.current}>
  {#snippet children(r)}
    {@const touched = touchedBy(r.events, titles.data?.titles ?? {})}
    <h1>Revert this change?</h1>
    <p>
      By {name(r.actor, r.by)}, <Moment ts={r.ts} />{r.note ? `: ${r.note}` : ""}
    </p>
    <ul class="events">
      {#each touched as t (t.path)}
        <li>
          {WHAT_WORDS[t.what]}
          <a href={t.what === "deleted" ? urls.pinned(t.seq - 1).file(t.path) : urls.since(t.path, t.seq)}
            >{t.title}</a
          >{#if t.from}<span class="muted">{` from ${folderOf(t.from)}`}</span>{/if}
        </li>
      {/each}
    </ul>
    <div class="panel-box">
      <p>Undoes every change in it, as a new change by you. Nothing is erased.</p>
      {#if action.error}<div class="notice">{action.error}</div>{/if}
      <form onsubmit={submit}>
        <label>
          Note
          <input type="text" name="note" defaultValue={`Revert: ${r.note ?? "a change"}`} />
        </label>
        <p class="actions">
          <button class="primary" type="submit" disabled={action.busy}>Revert</button><a
            class="button" href={urls.activity({ view: "events" })}>Cancel</a>
        </p>
      </form>
    </div>
  {/snippet}
</Status>
