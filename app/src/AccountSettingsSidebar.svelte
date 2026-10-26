<script lang="ts">
  import type { AccountPage } from "./frame";
  import NavRow from "./NavRow.svelte";
  import { ACCOUNT_SETTINGS } from "./sidebar";

  /** The account settings' sidebar: back to the libraries, then each page. */
  let { page }: { page: AccountPage } = $props();
</script>

<nav class="nav" aria-label="Settings">
  <NavRow href="/" icon="previous" label="Back to libraries" className="back" />
  {#each ACCOUNT_SETTINGS as [key, href, label] (key)}
    <NavRow {href} current={page === key} {label} />
  {/each}
</nav>
