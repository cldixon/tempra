<script lang="ts">
  import { useLibraryLabel } from "../role.svelte.ts";
  import { useTitle } from "../ui.svelte.ts";
  import type { Urls } from "../urls";
  import OwnerOnly from "./OwnerOnly.svelte";
  import TransferPage from "./TransferPage.svelte";

  /** Export a bundle, import one as a single change, and the nightly exports (owner only). */
  let { urls }: { urls: Urls } = $props();
  const label = useLibraryLabel(() => urls);
  useTitle(() => `Import & export · ${label.current}`);
</script>

<OwnerOnly {urls}>
  <TransferPage {urls} />
</OwnerOnly>
