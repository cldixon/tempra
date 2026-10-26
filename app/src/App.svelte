<script lang="ts">
  import AccountMenu from "./AccountMenu.svelte";
  import Bell from "./Bell.svelte";
  import { here } from "./location.svelte.ts";
  import { useMe } from "./ui.svelte.ts";
  const me = useMe();
</script>

<p>{here.url.pathname}</p>
<Bell />
<AccountMenu me={me.current} />
