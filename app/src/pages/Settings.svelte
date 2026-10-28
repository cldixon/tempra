<script lang="ts">
  import { untrack } from "svelte";
  import { useLibraryTitle, useRole } from "../role.svelte.ts";
  import { navigate } from "../router";
  import { useScrollToHash } from "../ui.svelte.ts";
  import type { SettingsSection, Urls } from "../urls";
  import ConnectLibrary from "./ConnectLibrary.svelte";
  import DeleteLibrary from "./DeleteLibrary.svelte";
  import General from "./General.svelte";
  import Members from "./Members.svelte";
  import { settingsSections } from "./manage";
  import Recovery from "./Recovery.svelte";
  import Transfer from "./Transfer.svelte";

  /**
   * The library's settings (tempra-dev: app/workspace, Library settings): one page in the
   * library's frame, as Activity is, its sections one after another under their headings, by
   * role. The person leaves it by opening anything else in the library. A former tab's URL
   * (`-/members` and the like) arrives as `section` and is replaced by the page at its anchor.
   */
  let {
    urls,
    me,
    section = undefined,
  }: { urls: Urls; me: string | null; section?: SettingsSection } = $props();
  useLibraryTitle(
    () => urls,
    () => "Settings",
  );
  const role = useRole(() => urls);
  const sections = $derived(settingsSections(role.current));
  $effect(() => {
    if (section) untrack(() => navigate(urls.settings(section), { replace: true }));
  });
  useScrollToHash(() => role.current !== null);
</script>

<header class="view-head">
  <div class="view-head-main">
    <h1 class="view-title">Settings</h1>
  </div>
</header>
{#if role.current === null}
  <p class="muted">Loading…</p>
{/if}
{#each sections as s (s.id)}
  <section class="settings-section" id={s.id} aria-labelledby={`${s.id}-heading`}>
    <h2 id={`${s.id}-heading`}>{s.label}</h2>
    {#if s.id === "general"}
      <General {urls} />
    {:else if s.id === "members"}
      <Members {urls} {me} />
    {:else if s.id === "connect"}
      <ConnectLibrary {urls} />
    {:else if s.id === "transfer"}
      <Transfer {urls} />
    {:else if s.id === "recovery"}
      <Recovery {urls} />
    {:else}
      <DeleteLibrary {urls} />
    {/if}
  </section>
{/each}
