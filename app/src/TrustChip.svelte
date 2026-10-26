<script lang="ts">
  import Chip from "./Chip.svelte";

  let { tier }: { tier: string | undefined } = $props();
</script>

{#if tier === "human-reviewed"}
  <Chip text="human-reviewed" tone="ok" title="A human verified this version" />
{:else if tier === "machine-confirmed"}
  <Chip text="machine-confirmed" title="A process re-checked this version" />
{:else}
  <Chip text="unverified" tone="warn" title="Nobody has verified this version" />
{/if}
