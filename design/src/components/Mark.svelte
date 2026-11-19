<script lang="ts">
  import { MARK_PATHS, MARK_VIEWBOX } from "./mark";
  import type { MarkProps } from "./types";

  /**
   * The Tempra mark (`.mark`, TEMPRA-279): three plates, graphite in light and silver in dark.
   * `small` at 24px and under; `finish="on-orange"` (white and two orange tints, `.mark.on-orange`)
   * for a mark on the brand's orange, as @tempra's round mark is. Decorative unless `label` names
   * it; beside a name, the name says it.
   * Its size and its place beside a name are the caller's class (`.brand-mark` in the top bar,
   * `.wordmark` on the public pages).
   */
  let { small = false, label, finish = "default", class: className, ...rest }: MarkProps = $props();
  const p = $derived(MARK_PATHS[small ? "small" : "standard"]);
</script>

<svg
  class={["mark", finish === "on-orange" ? "on-orange" : "", className].filter(Boolean).join(" ")}
  viewBox={MARK_VIEWBOX}
  xmlns="http://www.w3.org/2000/svg"
  role={label ? "img" : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : "true"}
  {...rest}
  ><path class="mark-back" d={p.back} /><path class="mark-mid" d={p.middle} /><path
    class="mark-front"
    d={p.front}
  /></svg
>
