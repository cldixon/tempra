<script lang="ts">
  import QuickSearch from "./QuickSearch.svelte";
  import { useLibraries } from "./role.svelte.ts";
  import { libraryOptions } from "./switcher";

  /**
   * Search off a library (the account's pages, TEMPRA-127): the person's libraries by title or
   * owner/slug, from the list the app already has; Enter opens the library's home.
   */
  let props: { open: boolean; onClose(): void } = $props();
  const libs = useLibraries();
  let q = $state("");
  $effect(() => {
    if (props.open) q = "";
  });
  const options = $derived(libraryOptions(libs.data?.libraries ?? [], q.trim().toLowerCase()));
</script>

<QuickSearch
  open={props.open}
  onClose={props.onClose}
  label="Search libraries"
  {q}
  onQuery={(v) => (q = v)}
  {options}
  empty={libs.state !== "ready" ? "Loading libraries…" : "No library matches."}
/>
