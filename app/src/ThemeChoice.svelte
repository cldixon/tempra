<script lang="ts">
  import { THEMES, type Theme } from "./theme.svelte.ts";

  /** System, Light, Dark as one segmented control (the avatar's menu, the Account page). */
  let { value, onChange }: { value: Theme; onChange(theme: Theme): void } = $props();
</script>

<fieldset class="segmented">
  <legend class="visually-hidden">Theme</legend>
  {#each THEMES as [key, label] (key)}
    <button type="button" aria-pressed={value === key} data-stay onclick={() => onChange(key)}>{label}</button>
  {/each}
</fieldset>
