<script lang="ts" module>
  import type { AccountPage } from "./frame";

  /** The account's pages under its own sidebar; Welcome and Invitations are not settings (S-14). */
  const ACCOUNT_OWN: ReadonlySet<AccountPage> = new Set(["welcome", "invitations"]);
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import AccountSettingsSidebar from "./AccountSettingsSidebar.svelte";
  import AccountSidebar from "./AccountSidebar.svelte";
  import LibrarySearch from "./LibrarySearch.svelte";
  import Shell from "./Shell.svelte";
  import type { Me } from "./ui";

  /**
   * The account's frame (take 4, boards 01 to 05): Tempra over the sidebar; first run and
   * Invitations under the account's sidebar (Libraries, the person's libraries), the settings
   * under theirs (Back to libraries, then each page). The library list has no sidebar: its page
   * lists the libraries (TEMPRA-189).
   */
  let { page, me, children }: { page: AccountPage; me: Me | null; children: Snippet } = $props();
  const settings = $derived(!ACCOUNT_OWN.has(page));
  // Off a library, search finds a library (TEMPRA-127); Ctrl or Cmd+K opens it, and again closes it.
  let searching = $state(false);
  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searching = !searching;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
</script>

{#snippet sidebar()}
  {#if settings}
    <AccountSettingsSidebar {page} />
  {:else}
    <AccountSidebar {page} />
  {/if}
{/snippet}
<Shell onSearch={() => (searching = true)} {me} index={null} sidebar={page === "libraries" ? undefined : sidebar}>
  {@render children()}
</Shell>
<LibrarySearch open={searching} onClose={() => (searching = false)} />
