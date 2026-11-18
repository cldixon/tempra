<script lang="ts">
  import AvatarMark from "./AvatarMark.svelte";
  import type { AvatarPairProps } from "./types";

  /**
   * A person's agent, as the person's round mark with the agent's mark as a badge at its foot
   * (`.avatar-pair`; an experiment): the person first, as "Claude Code for @dev" reads, the agent
   * the modifier, its brand's glyph or its letter. Decorative: the names beside it are the
   * caller's to draw.
   */
  let { personInitials, agentInitials, brand = null, size = "default" }: AvatarPairProps = $props();
</script>

<span class={size === "small" ? "avatar-pair small" : "avatar-pair"} aria-hidden="true"
  ><AvatarMark initials={personInitials} {size} /><AvatarMark
    kind="agent"
    initials={agentInitials}
    {brand}
  /></span
>
