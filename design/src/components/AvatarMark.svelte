<script lang="ts">
  import { BRAND_PATHS, BRAND_VIEWBOX } from "./brands";
  import type { AvatarMarkProps } from "./types";

  /**
   * Someone who acts, as a small round mark (`.avatar-mark`): a person's initials on a light
   * fill, an agent's letter on ink, Tempra's own agent on the agent colour. An agent with a
   * `brand` (an experiment) shows its brand's glyph on ink in place of the letter. Decorative:
   * the name beside it is the caller's to draw.
   */
  let { kind = "person", initials, size = "default", brand = null }: AvatarMarkProps = $props();
  const glyph = $derived(kind === "agent" && brand ? BRAND_PATHS[brand] : null);
  const cls = $derived(
    [
      "avatar-mark",
      kind === "agent" ? "agent" : kind === "tempra" ? "agent tempra" : "",
      glyph ? "brand" : "",
      size === "small" ? "small" : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
</script>

<span class={cls} aria-hidden="true"
  >{#if glyph}<svg viewBox={BRAND_VIEWBOX} fill="currentColor" focusable="false"><path d={glyph.d} /></svg
    >{:else}{initials}{/if}</span
>
