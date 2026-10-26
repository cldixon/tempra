<script lang="ts">
  import BellList from "./BellList.svelte";
  import Icon from "./Icon.svelte";
  import { useOpenCount } from "./inbox.svelte.ts";
  import Menu from "./Menu.svelte";

  /**
   * The bell (TEMPRA-189): what waits as a badge, and a panel under it listing what waits, each
   * one a link, with Open Inbox at its foot, so a look at the Inbox never leaves the page. The
   * count follows the feed and every action on an item.
   */
  const open = useOpenCount();
  const n = $derived(open.current);
</script>

<Menu
  name={n > 0 ? `Inbox, ${n} waiting` : "Inbox"}
  title="Inbox"
  buttonClass="icon-button bell"
  listClass="bell-pop"
  align="end"
>
  {#snippet label()}
    <Icon name="bell" />
    {#if n > 0}<span class="badge" aria-hidden="true">{n > 99 ? "99+" : n}</span>{/if}
  {/snippet}
  <BellList />
</Menu>
