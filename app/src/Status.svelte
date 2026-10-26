<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import type { Loaded } from "./api";
  import ErrorView from "./ErrorView.svelte";

  /** What a page shows while its data loads or when it failed. */
  let { loaded, children }: { loaded: Loaded<T>; children: Snippet<[T]> } = $props();
</script>

{#if loaded.state === "loading"}
  <p class="muted">Loading…</p>
{:else if loaded.state === "error"}
  <ErrorView error={loaded.error} />
{:else}
  {@render children(loaded.data)}
{/if}
