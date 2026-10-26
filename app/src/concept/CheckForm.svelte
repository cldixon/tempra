<script lang="ts">
  import { ApiError } from "../api";
  import type { Urls } from "../urls";
  import { markChecked } from "./checked";

  /** A note and Mark as checked: the person vouches for the version on screen. */
  let { urls, path, onVerified }: { urls: Urls; path: string; onVerified(): void } = $props();
  let error = $state<string | null>(null);
  let busy = $state(false);
  async function submit(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
    e.preventDefault();
    const note = String(new FormData(e.currentTarget).get("note") ?? "").trim();
    busy = true;
    error = null;
    try {
      await markChecked(urls, path, note);
      onVerified();
    } catch (err) {
      error = err instanceof ApiError ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<form class="verify-form" onsubmit={submit}
  ><input type="text" name="note" placeholder="Note (optional)" aria-label="Note" /><button class="primary" type="submit" disabled={busy}>Mark as checked</button
  >{#if error}<span class="warn">{error}</span>{/if}</form
>
