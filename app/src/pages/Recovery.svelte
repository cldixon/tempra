<script lang="ts">
  import { useLibraryLabel } from "../role.svelte.ts";
  import { useTitle } from "../ui.svelte.ts";
  import type { Urls } from "../urls";
  import OwnerOnly from "./OwnerOnly.svelte";
  import RecoveryPage from "./RecoveryPage.svelte";

  /** Point-in-time restore of the whole library, and undoing one (owner only). */
  let { urls }: { urls: Urls } = $props();
  const label = useLibraryLabel(() => urls);
  useTitle(() => `Recovery · ${label.current}`);
</script>

<OwnerOnly {urls}>
  <RecoveryPage {urls} />
</OwnerOnly>
