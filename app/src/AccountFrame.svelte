<script lang="ts" module>
  import type { AccountPage } from "./frame";

  /** The account's pages under its own sidebar; Welcome and Invitations are not settings (S-14). */
  const ACCOUNT_OWN: ReadonlySet<AccountPage> = new Set([
    "libraries",
    "inbox",
    "welcome",
    "invitations",
  ]);
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import AccountSettingsSidebar from "./AccountSettingsSidebar.svelte";
  import AccountSidebar from "./AccountSidebar.svelte";
  import LibrarySearch from "./LibrarySearch.svelte";
  import Shell from "./Shell.svelte";
  import type { Me } from "./ui";

  /**
   * The account's frame (take 4, boards 01 to 05): Tempra over the sidebar; the library list, the
   * Inbox (an invitation is answered from it), and first run under the account's sidebar
   * (Search, Libraries, Inbox, the person's libraries), the rest under the settings' (Back to
   * libraries, then each page).
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

<Shell onSearch={() => (searching = true)} {me} index={null}>
  {#snippet sidebar()}
    {#if settings}
      <AccountSettingsSidebar {page} />
    {:else}
      <AccountSidebar {page} />
    {/if}
  {/snippet}
  {@render children()}
</Shell>
<LibrarySearch open={searching} onClose={() => (searching = false)} />
