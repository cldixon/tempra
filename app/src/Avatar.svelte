<script lang="ts">
  import { initials } from "./chrome";

  /**
   * Someone who acts in a library, as a small round mark with their initials: a person on a
   * light fill, an agent on ink (take 3). The name beside it is the caller's to draw.
   */
  let { name, agent = false }: { name: string; agent?: boolean } = $props();
</script>

<span class={agent ? "avatar-mark agent" : "avatar-mark"} aria-hidden="true"
  >{agent ? (name.trim()[0] ?? "?").toUpperCase() : initials(name)}</span
>
