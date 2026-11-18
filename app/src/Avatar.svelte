<script lang="ts">
  import { type AgentBrand, AvatarMark } from "@tempra/design/components";
  import { agentInitial } from "./agents";
  import { personInitials } from "./chrome";

  /**
   * Someone who acts in a library, as the design package's round mark (AvatarMark): a person's
   * initials on a light fill, an agent's one letter (the first of its name, "Claude" is C) on ink,
   * and Tempra's own agent (TEMPRA-223) on the agent colour; an agent with a brand (an
   * experiment) shows its brand's glyph instead of the letter. A person's initials come from their
   * account's name when they gave one (`fullName`, TEMPRA-54), else from `name`, their handle.
   * Decorative: the name beside it is the caller's to draw.
   */
  let {
    name,
    fullName = null,
    agent = false,
    tempra = false,
    brand = null,
  }: {
    name: string;
    fullName?: string | null;
    agent?: boolean;
    tempra?: boolean;
    brand?: AgentBrand | null;
  } = $props();
</script>

<AvatarMark
  kind={agent ? (tempra ? "tempra" : "agent") : "person"}
  initials={agent ? agentInitial(name) : personInitials(name, fullName)}
  brand={agent && !tempra ? brand : null}
/>
