<script lang="ts">
  /** An image in running text: stays inline, with no caption; its alt text if it fails to load. */
  import { figureSizes, type ImageSource } from "../images";
  import Img from "./Img.svelte";

  let {
    source,
    alt,
    title,
    host,
  }: { source: ImageSource; alt: string; title: string | null; host?: string | null } = $props();
  let failed = $state<string | null>(null);
  const from = $derived(host ? `From ${host}` : null);
  const named = $derived(title?.trim() || null);
</script>

{#if failed === source.src}<span
    class="image-broken"
    data-atom=""
    title={host ? `This external image from ${host} can't be shown` : "This image can't be shown"}
    >{alt || "image"}</span
  >{:else}<Img
    atom
    {source}
    {alt}
    title={named && from ? `${named} (${from.toLowerCase()})` : (named ?? from ?? undefined)}
    sizes={figureSizes(null)}
    onError={() => (failed = source.src)}
  />{/if}
