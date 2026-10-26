<script lang="ts">
  /** A library's tile: its initial on a dark square (a lighter round one for a shared library). */
  let { name, shared = false }: { name: string; shared?: boolean } = $props();
</script>

<span class={shared ? "lib-tile shared" : "lib-tile"} aria-hidden="true">{(name.trim()[0] ?? "?").toUpperCase()}</span>
