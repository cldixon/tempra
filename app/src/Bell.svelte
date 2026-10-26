<script lang="ts">
  import Icon from "./Icon.svelte";
  import { useUnread } from "./inbox.svelte.ts";

  /**
   * The bell: the way to the Inbox, with its unread count as a badge (TEMPRA-173: no popover;
   * the Inbox is the one list). The count follows the feed and every action on an item.
   */
  const unread = useUnread();
  const n = $derived(unread.current);
</script>

<a class="icon-button bell" href="/inbox" aria-label={n > 0 ? `Inbox, ${n} unread` : "Inbox"} title="Inbox">
  <Icon name="bell" />
  {#if n > 0}<span class="badge" aria-hidden="true">{n > 99 ? "99+" : n}</span>{/if}
</a>
