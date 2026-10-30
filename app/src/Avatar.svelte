<script lang="ts">
  import { agentInitial } from "./agents";
  import { initials } from "./chrome";

  /**
   * Someone who acts in a library, as a small round mark: a person's initials on a light fill, an
   * agent's one letter (the first of its name, "Claude" is C) on ink, and Tempra's own agent
   * (TEMPRA-223) on the agent colour. Decorative: the name beside it is the caller's to draw.
   */
  let {
    name,
    agent = false,
    tempra = false,
  }: { name: string; agent?: boolean; tempra?: boolean } = $props();
  const kind = $derived(
    agent ? (tempra ? "avatar-mark agent tempra" : "avatar-mark agent") : "avatar-mark",
  );
</script>

<span class={kind} aria-hidden="true">{agent ? agentInitial(name) : initials(name)}</span>
