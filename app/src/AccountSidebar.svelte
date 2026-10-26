<script lang="ts">
  import type { AccountPage } from "./frame";
  import { useUnread } from "./inbox.svelte.ts";
  import NavRow from "./NavRow.svelte";
  import { libraryLabel, type ReachableLibrary } from "./role";
  import { useLibraries } from "./role.svelte.ts";
  import { byKind } from "./sidebar";
  import UnreadCount from "./UnreadCount.svelte";
  import { Urls } from "./urls";

  /** The account's sidebar: Libraries, the Inbox, then the person's libraries by kind. */
  let { page }: { page: AccountPage } = $props();
  const libs = useLibraries();
  const unread = useUnread();
  const kinds = $derived(byKind(libs.data?.libraries ?? []));
</script>

{#snippet unreadEnd()}<UnreadCount unread={unread.current} />{/snippet}
{#snippet row(l: ReachableLibrary)}
  <NavRow
    href={new Urls(l.owner, l.slug).tree("")}
    tile={{ name: l.title || l.slug, shared: (l.role ?? "owner") !== "owner" }}
    label={libraryLabel(l)}
  />
{/snippet}
<nav class="nav" aria-label="Account">
  <NavRow href="/" current={page === "libraries"} icon="libraries" label="Libraries" />
  <NavRow
    href="/inbox"
    current={page === "inbox" || page === "invitations"}
    icon="inbox"
    label="Inbox"
    end={unreadEnd}
  />
</nav>
<div class="sidebar-scroll">
  {#if kinds.yours.length > 0}
    <div class="sidebar-label">Yours</div>
    <nav class="nav" aria-label="Your libraries">
      {#each kinds.yours as l (`${l.owner}/${l.slug}`)}{@render row(l)}{/each}
    </nav>
  {/if}
  {#if kinds.shared.length > 0}
    <div class="sidebar-label">Shared with you</div>
    <nav class="nav" aria-label="Shared with you">
      {#each kinds.shared as l (`${l.owner}/${l.slug}`)}{@render row(l)}{/each}
    </nav>
  {/if}
</div>
