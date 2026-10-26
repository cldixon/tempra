<script lang="ts">
  import type { Place } from "./frame";
  import NavRow from "./NavRow.svelte";
  import Tree from "./Tree.svelte";
  import type { OutlineFile } from "./tree";
  import type { Urls } from "./urls";

  /**
   * The library's sidebar (TEMPRA-145): the files, then a fixed foot of the library's tools,
   * Activity and Settings. Home is the library's name in the bar; the Inbox is the bell's.
   */
  let props: {
    urls: Urls;
    place: Place;
    /** The library's index (Workspace loads it), null until it arrives; whether loading failed. */
    files: OutlineFile[] | null;
    failed: boolean;
    onRetry(): void;
  } = $props();
</script>

<div class="sidebar-scroll">
  <Tree
    urls={props.urls}
    file={props.place.file}
    dir={props.place.dir}
    files={props.files}
    failed={props.failed}
    onRetry={props.onRetry}
  />
</div>
<nav class="sidebar-foot" aria-label="Library">
  <NavRow
    href={props.urls.activity()}
    current={props.place.view === "activity"}
    icon="activity"
    label="Activity"
  />
  <NavRow href={props.urls.settings()} icon="settings" label="Settings" />
</nav>
