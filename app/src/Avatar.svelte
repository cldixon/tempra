<script lang="ts">
  import { type AgentBrand, AvatarMark, AvatarPair } from "@tempra/design/components";
  import { agentInitial } from "./agents";
  import { personInitials } from "./chrome";

  /**
   * Someone who acts in a library, as the design package's round mark (AvatarMark): a person's
   * initials on a light fill, an agent's one letter (the first of its name, "Claude" is C) on ink,
   * and Tempra's own agent (TEMPRA-223) as the Tempra mark on orange; an agent with a brand (an
   * experiment) shows its brand's glyph instead of the letter. A person's initials come from their
   * account's name when they gave one (`fullName`, TEMPRA-54), else from `name`, their handle.
   * An agent whose person is known (`person`, an experiment) is drawn as that person's mark with
   * the agent's as a badge (AvatarPair), "person via agent". Decorative: the name beside it is
   * the caller's to draw.
   */
  let {
    name,
    fullName = null,
    agent = false,
    tempra = false,
    brand = null,
    person = null,
  }: {
    name: string;
    fullName?: string | null;
    agent?: boolean;
    tempra?: boolean;
    brand?: AgentBrand | null;
    person?: { handle: string; fullName?: string | null } | null;
  } = $props();
</script>

{#if agent && !tempra && person}
  <AvatarPair
    personInitials={personInitials(person.handle, person.fullName)}
    agentInitials={agentInitial(name)}
    {brand}
  />
{:else}
  <AvatarMark
    kind={agent ? (tempra ? "tempra" : "agent") : "person"}
    initials={agent ? agentInitial(name) : personInitials(name, fullName)}
    brand={agent && !tempra ? brand : null}
  />
{/if}
