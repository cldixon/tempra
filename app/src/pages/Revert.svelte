<script lang="ts">
  import { useLibraryLabel } from "../role.svelte.ts";
  import { useTitle } from "../ui.svelte.ts";
  import type { Urls } from "../urls";
  import OwnerOnly from "./OwnerOnly.svelte";
  import RevertPage from "./RevertPage.svelte";

  /** Undoing one change (a ledger request), as a new change by the owner (owner only). */
  let { urls, request }: { urls: Urls; request: string; actor: string } = $props();
  const label = useLibraryLabel(() => urls);
  useTitle(() => `Revert · ${label.current}`);
</script>

<OwnerOnly {urls}>
  <RevertPage {urls} {request} />
</OwnerOnly>
