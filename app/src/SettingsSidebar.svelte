<script lang="ts">
  import type { Place } from "./frame";
  import NavRow from "./NavRow.svelte";
  import { useRole } from "./role.svelte.ts";
  import { settingsTabs } from "./sidebar";
  import type { Urls } from "./urls";

  /**
   * The settings' sidebar: back to the library (its name is already over the sidebar, so the row
   * does not say it again), then its tabs.
   */
  let { urls, place }: { urls: Urls; place: Place } = $props();
  const role = useRole(() => urls);
  const tabs = $derived(settingsTabs(urls, role.current));
</script>

<nav class="nav" aria-label="Library settings">
  <NavRow href={urls.tree("")} icon="previous" label="Back to library" className="back" />
  {#each tabs as t (t.view)}
    <NavRow href={t.href} current={place.view === t.view} label={t.label} />
  {/each}
</nav>
