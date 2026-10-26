<script lang="ts">
  import type { AccountPage } from "./frame";
  import { useUnread } from "./inbox.svelte.ts";
  import NavRow from "./NavRow.svelte";
  import { isShared, libraryLabel, type ReachableLibrary } from "./role";
  import { useLibraries } from "./role.svelte.ts";
  import { byKind } from "./sidebar";
  import { Urls } from "./urls";

  /** The account's sidebar: Libraries, the Inbox, then the person's libraries by kind. */
  let { page }: { page: AccountPage } = $props();
  const libs = useLibraries();
  const unread = useUnread();
  const kinds = $derived(byKind(libs.data?.libraries ?? []));
</script>

{#snippet row(l: ReachableLibrary)}
  <NavRow
    href={new Urls(l.owner, l.slug).tree("")}
    tile={{ name: l.title || l.slug, shared: isShared(l) }}
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
    unread={unread.current}
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
