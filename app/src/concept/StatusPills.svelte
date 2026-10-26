<script lang="ts">
  /** What is exceptional about the page, as pills: a status that is not stable, and stale. */
  let { status, stale }: { status: string | null; stale: boolean } = $props();
  const shown = $derived.by(() => {
    const s = status?.trim();
    return s && s.toLowerCase() !== "stable" ? s : null;
  });
</script>

{#if shown || stale}<span class="byline-pills">{#if shown}<span class="chip">{shown.charAt(0).toUpperCase() + shown.slice(1)}</span>{/if}{#if stale}<span class="chip">Stale</span>{/if}</span>{/if}
