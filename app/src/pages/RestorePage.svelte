<script lang="ts">
  import { ApiError, api, field } from "../api";
  import { useAction, useLoad } from "../load.svelte.ts";
  import Moment from "../Moment.svelte";
  import { navigate } from "../router";
  import Status from "../Status.svelte";
  import { enc, type Urls } from "../urls";
  import { type HistoryRow, json, versionAt } from "./manage";

  let props: { urls: Urls; path: string; to?: number; title: string } = $props();
  const loaded = useLoad(
    () => `restore ${props.urls.base} ${props.path} ${props.to}`,
    async () => {
      const { urls, path, to } = props;
      if (to === undefined) throw new ApiError(400, "bad_param", "No version was chosen.");
      const h = await api<{ events: HistoryRow[] }>(urls.api(`history/${enc(path)}`));
      // The version shown at `to`: the latest content event up to it, numbered from the first.
      const v = versionAt(h.events, to);
      if (!v) throw new ApiError(404, "not_found", "That version is not in this page's history.");
      return v;
    },
  );
  const action = useAction();

  function submit(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
    e.preventDefault();
    const note = field(e.currentTarget, "note");
    const { urls, path, to } = props;
    void action.run(async () => {
      await api(urls.api("revert"), json({ path, to_seq: to, note }));
      navigate(`${urls.pinned(undefined).file(path)}?done=restore`);
    });
  }
</script>

<Status loaded={loaded.current}>
  {#snippet children(v)}
    <h1>Restore {props.title} to version {v.n}?</h1>
    <p>
      Version {v.n} is from <Moment ts={v.ts} />.
      <a href={props.urls.pinned(props.to).file(props.path)}>Read it as it was</a>.
    </p>
    <div class="panel-box">
      <p>Writes that version back as a new change by you. Nothing is erased.</p>
      {#if action.error}<div class="notice">{action.error}</div>{/if}
      <form onsubmit={submit}>
        <label>
          Note <input type="text" name="note" defaultValue={`Restore version ${v.n}`} />
        </label>
        <p class="actions">
          <button class="primary" type="submit" disabled={action.busy}>Restore</button><a
            class="button"
            href={props.urls.pinned(undefined).file(props.path)}>Cancel</a
          >
        </p>
      </form>
    </div>
  {/snippet}
</Status>
