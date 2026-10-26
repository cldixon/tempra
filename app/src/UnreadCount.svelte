<script lang="ts">
  /**
   * The Inbox's unread count at a row's end, read as "Inbox 2 unread": the name is the row's own
   * words, so it starts with what it shows (WCAG 2.5.3).
   */
  let { unread }: { unread: number } = $props();
</script>

{#if unread > 0}{" "}<span class="nav-count">{unread}<span class="visually-hidden">{" unread"}</span></span>{/if}
