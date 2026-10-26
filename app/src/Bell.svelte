<script lang="ts">
  import BellList from "./BellList.svelte";
  import Icon from "./Icon.svelte";
  import { useOpenCount } from "./inbox.svelte.ts";
  import Menu from "./Menu.svelte";

  /**
   * The bell (TEMPRA-189): the person's notifications, on every page. What waits is a badge; the
   * panel under it lists it, so a look never leaves the page. The count follows the feed and every
   * action on an item.
   */
  const open = useOpenCount();
  const n = $derived(open.current);
</script>

<Menu
  name={n > 0 ? `Notifications, ${n} waiting` : "Notifications"}
  title="Notifications"
  buttonClass="icon-button bell"
  listClass="bell-pop"
  align="end"
>
  {#snippet label()}
    <Icon name="bell" />
    {#if n > 0}<span class="badge" aria-hidden="true">{n > 99 ? "99+" : n}</span>{/if}
  {/snippet}
  {#snippet children(close: () => void)}
    <BellList {close} />
  {/snippet}
</Menu>
