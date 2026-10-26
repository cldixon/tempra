<script lang="ts">
  import type { Place } from "./frame";
  import { useUnread } from "./inbox.svelte.ts";
  import NavRow from "./NavRow.svelte";
  import Tree from "./Tree.svelte";
  import type { OutlineFile } from "./tree";
  import UnreadCount from "./UnreadCount.svelte";
  import type { Urls } from "./urls";

  /**
   * The library's sidebar (TEMPRA-145): the files, then a fixed foot of the library's tools,
   * Activity and Settings (and on a phone the Inbox). Home is the library's name in the bar.
   */
  let props: {
    urls: Urls;
    place: Place;
    onIndex(files: OutlineFile[], seq: number): void;
  } = $props();
  const unread = useUnread();
</script>

{#snippet unreadEnd()}<UnreadCount unread={unread.current} />{/snippet}
<div class="sidebar-scroll">
  <Tree urls={props.urls} file={props.place.file} dir={props.place.dir} onIndex={props.onIndex} />
</div>
<nav class="sidebar-foot" aria-label="Library">
  <NavRow
    href={props.urls.activity()}
    current={props.place.view === "activity"}
    icon="activity"
    label="Activity"
  />
  <NavRow href={props.urls.settings()} icon="settings" label="Settings" />
  <NavRow href="/inbox" icon="inbox" label="Inbox" className="phone-only" end={unreadEnd} />
</nav>
