<script lang="ts">
  import type { ActedBy, ActorView } from "../agents";
  import Moment from "../Moment.svelte";
  import { dirOf, folderName, type Urls } from "../urls";
  import type { Changed } from "./home";

  /** Recently changed: the last few pages edited, each with who and when; absent when none. */
  let {
    urls,
    changed,
    view,
  }: { urls: Urls; changed: Changed[]; view(actor: string, by: ActedBy | null): ActorView } =
    $props();
</script>

{#if changed.length > 0}
  <section class="home-section" aria-labelledby="home-recent">
    <div class="view-section-head">
      <h2 id="home-recent" class="view-section-title">Recently changed</h2>
    </div>
    <ul class="home-recent">
      {#each changed as c (c.path)}
        {@const who = view(c.actor, c.by)}
        {@const folder = dirOf(c.path)}
        <li class="home-recent-row">
          <a class="home-recent-title" href={urls.file(c.path)}>{c.title}</a>
          <span class="home-recent-meta">{#if folder}<span>{`${folderName(folder)} · `}</span>{/if}{who.name}{who.for ? ` for ${who.for}` : ""} · <Moment ts={c.ts} /></span>
        </li>
      {/each}
    </ul>
  </section>
{/if}
