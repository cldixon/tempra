<script lang="ts">
  import { navigate } from "./router";

  /** A page that moved (`-/needs` into the Inbox, `-/work` to the home): the URL is replaced, as the server's 308 does. */
  let { to }: { to: string } = $props();
  $effect(() => navigate(to, { replace: true }));
</script>
