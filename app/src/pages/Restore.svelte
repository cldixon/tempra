<script lang="ts">
  import { useTitleOf } from "../frame.svelte.ts";
  import { useLibraryLabel } from "../role.svelte.ts";
  import { useTitle } from "../ui.svelte.ts";
  import type { Urls } from "../urls";
  import OwnerOnly from "./OwnerOnly.svelte";
  import RestorePage from "./RestorePage.svelte";

  /** Writing back one page's earlier version, as a revert by the owner (owner only). */
  let props: { urls: Urls; path: string; to?: number; actor: string } = $props();
  const titleOf = useTitleOf();
  const title = $derived(titleOf.of(props.path));
  const label = useLibraryLabel(() => props.urls);
  useTitle(() => `Restore ${title} · ${label.current}`);
</script>

<OwnerOnly urls={props.urls}>
  <RestorePage urls={props.urls} path={props.path} to={props.to} {title} />
</OwnerOnly>
