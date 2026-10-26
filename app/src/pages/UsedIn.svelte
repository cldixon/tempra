<script lang="ts">
  import { baseName, type Urls } from "../urls";
  import type { Use } from "./attachment";

  /** Used in: each page that links the file, and the figures it appears as there. */
  let props: {
    urls: Urls;
    /** The pages linking it, in order; null while loading. */
    paths: readonly string[] | null;
    uses: readonly Use[] | null;
    titles: ReadonlyMap<string, string>;
  } = $props();
</script>

{#if props.paths === null}…{:else if props.paths.length === 0}<span class="muted">No page links it</span>{:else}<ul class="attachment-used">
    {#each props.paths as p (p)}
      {@const figures = props.uses?.find((u) => u.path === p)?.figures ?? []}
      <li
        ><a href={props.urls.file(p)}>{props.titles.get(p) ?? baseName(p)}</a
        >{#each figures as f (f.n)}<div class="attachment-figure">Figure {f.n}{f.caption ? `. ${f.caption}` : ""}</div>{/each}</li
      >
    {/each}
  </ul>{/if}
