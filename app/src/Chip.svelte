<script lang="ts">
  import type { Tone } from "./ui";

  let { text, tone = "", title }: { text: string; tone?: Tone; title?: string } = $props();
</script>

<span class={tone ? `chip ${tone}` : "chip"} {title}>{text}</span>
