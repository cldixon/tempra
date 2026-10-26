<script lang="ts">
  import type { ApiError } from "./api";
  import { useTitle } from "./ui.svelte.ts";

  let { error }: { error: ApiError } = $props();
  const title = $derived(error.status === 404 ? "Not found" : "Something went wrong");
  useTitle(() => title);
</script>

<h1>{title}</h1>
<p>{error.message}</p>
