<script lang="ts">
  import { api, field } from "../api";
  import { useAction } from "../load.svelte.ts";
  import { useLibraryLabel } from "../role.svelte.ts";
  import { useTitle } from "../ui.svelte.ts";
  import type { Urls } from "../urls";
  import { json } from "./manage";
  import OwnerOnly from "./OwnerOnly.svelte";

  /** Deleting the library, typing its name (v2 spec: Accounts; owner only). */
  let { urls }: { urls: Urls } = $props();
  const label = useLibraryLabel(() => urls);
  useTitle(() => `Delete · ${label.current}`);
  const action = useAction();

  function submit(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
    e.preventDefault();
    const confirm = field(e.currentTarget, "confirm");
    void action.run(async () => {
      if (confirm !== urls.slug) throw new Error(`Type ${urls.slug} to confirm.`);
      await api(urls.api("delete"), json({ confirm }));
      // A full load: the library list, or first run if it was the last one.
      location.assign("/");
    });
  }
</script>

<OwnerOnly {urls}>
  <h1>Delete {label.current}</h1>
  {#if action.error}<div class="notice">{action.error}</div>{/if}
  <p>
    Deletes every page, attachment, export and token of this library.
    <a href={urls.exportTar()}>Export it first</a>.
  </p>
  <form onsubmit={submit}>
    <p>
      <label>
        Type {urls.slug} to confirm
        <input type="text" name="confirm" autocomplete="off" required />
      </label>
    </p>
    <p>
      <button type="submit" disabled={action.busy}>Delete library</button>
    </p>
  </form>
</OwnerOnly>
