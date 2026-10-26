<script lang="ts">
  import Icon from "./Icon.svelte";
  import { useOpenCount } from "./inbox.svelte.ts";

  /**
   * The bell: the one way to the Inbox (TEMPRA-189), on every page and width, with what waits as
   * a badge (TEMPRA-173: no popover; the Inbox is the one list). The count follows the feed and
   * every action on an item.
   */
  const open = useOpenCount();
  const n = $derived(open.current);
</script>

<a class="icon-button bell" href="/inbox" aria-label={n > 0 ? `Inbox, ${n} waiting` : "Inbox"} title="Inbox">
  <Icon name="bell" />
  {#if n > 0}<span class="badge" aria-hidden="true">{n > 99 ? "99+" : n}</span>{/if}
</a>
