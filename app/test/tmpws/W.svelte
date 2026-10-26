<script lang="ts">
  let { items, flag }: { items: string[]; flag: boolean } = $props();
</script>

<ul>
  {#each items as p (p)}
    {@const x = p + "!"}
    <li
      ><a href="#">{x}</a
      ></li
    >
  {/each}
</ul>{#if flag}<b>y</b>{/if}
<div>{#snippet lab()}<i>L</i>{/snippet}
  <p>a</p>
</div>
