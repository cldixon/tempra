<script lang="ts">
  import { agentInitial } from "./agents";
  import { personInitials } from "./chrome";

  /**
   * Someone who acts in a library, as a small round mark: a person's initials on a light fill, an
   * agent's one letter (the first of its name, "Claude" is C) on ink, and Tempra's own agent
   * (TEMPRA-223) on the agent colour. A person's initials come from their account's name when
   * they gave one (`fullName`, TEMPRA-54), else from `name`, their handle. Decorative: the name
   * beside it is the caller's to draw.
   */
  let {
    name,
    fullName = null,
    agent = false,
    tempra = false,
  }: { name: string; fullName?: string | null; agent?: boolean; tempra?: boolean } = $props();
  const kind = $derived(
    agent ? (tempra ? "avatar-mark agent tempra" : "avatar-mark agent") : "avatar-mark",
  );
</script>

<span class={kind} aria-hidden="true">{agent ? agentInitial(name) : personInitials(name, fullName)}</span>
