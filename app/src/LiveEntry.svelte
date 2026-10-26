<script lang="ts">
  import type { LiveWrite } from "./activity";
  import AgentName from "./AgentName.svelte";
  import type { ActorView } from "./agents";
  import Avatar from "./Avatar.svelte";
  import type { Urls } from "./urls";

  /**
   * The live entry at the top of the Summary: an agent writing now ("Claude Code is editing
   * Reader"), with the pulsing dot, while its writes keep arriving.
   */
  let {
    write: w,
    urls,
    actor,
    title,
  }: { write: LiveWrite; urls: Urls; actor: ActorView; title: string } = $props();
</script>

<article class="entry live" aria-live="polite">
  <Avatar name={actor.mark} agent={actor.agent} />
  <div class="entry-body">
    <p class="entry-line"><AgentName who={actor} /> is editing <a href={urls.file(w.path)}>{title}</a></p>
  </div>
  <span class="entry-side entry-now"><span class="change-dot live" aria-hidden="true"></span>now</span>
</article>
