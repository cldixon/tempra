<script lang="ts">
  import type { Snippet } from "svelte";
  import { useRole } from "../role.svelte.ts";
  import type { Urls } from "../urls";

  /**
   * The owner's recovery tools (Import, Recovery, Revert, Restore; tempra-dev:
   * decisions/read-and-comment-only, its one exception): nothing until the role is known, and a
   * plain line for anyone else.
   */
  let { urls, children }: { urls: Urls; children: Snippet } = $props();
  const role = useRole(() => urls);
</script>

{#if role.current === null}
  <p class="muted">Loading…</p>
{:else if role.current !== "owner"}
  <h1>Owner only</h1>
  <p>Only @{urls.owner}, the library's owner, can do this.</p>
{:else}
  {@render children()}
{/if}
