<script lang="ts">
  import type { ActorView } from "./agents";

  /**
   * Who acted, the one way the app names them (TEMPRA-131, X-1): an agent for its person
   * ("Claude Code for @dev"), a person by handle, the signed-in person as "You". Never the raw
   * actor id: the ActorView comes from `useActors` (the library's `GET …/agents`).
   */
  let { who }: { who: Pick<ActorView, "name" | "for"> } = $props();
</script>

<span class="agent-name"><b>{who.name}</b>{#if who.for}<span class="agent-for">{` for ${who.for}`}</span>{/if}</span>
