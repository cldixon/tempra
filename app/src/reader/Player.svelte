<script lang="ts">
  /**
   * A video or audio element for a source (TEMPRA-164; tempra-dev: app/media, How people see):
   * `<video controls preload="metadata">`, never autoplaying, its stored size and its poster when
   * known; `<audio controls>`. `onError` when it cannot be played.
   */
  import type { ImageSource } from "../images";

  let {
    kind,
    source,
    name,
    onError,
  }: { kind: "video" | "audio"; source: ImageSource; name: string; onError(): void } = $props();
</script>

<!-- No captions are stored with an attachment yet: a track would have nothing to point to. -->
{#snippet fallback()}<a href={source.download ?? source.src} download="">Download</a>{/snippet}
{#if kind === "video"}
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    controls
    preload="metadata"
    src={source.src}
    poster={source.poster}
    width={source.width}
    height={source.height}
    aria-label={name}
    onerror={() => onError()}>{@render fallback()}</video
  >
{:else}
  <!-- svelte-ignore a11y_media_has_caption -->
  <audio
    controls
    preload="metadata"
    src={source.src}
    aria-label={name}
    onerror={() => onError()}>{@render fallback()}</audio
  >
{/if}
