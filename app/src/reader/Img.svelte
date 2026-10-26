<script lang="ts">
  /**
   * An image from its source (TEMPRA-162): the stored width and height, so its box is reserved
   * before it loads (a quiet grey box, `.image-loading`, until it has), and its candidates with
   * the `sizes` of where it is drawn. Without a known size, just the original.
   */
  import type { ImageSource } from "../images";

  let {
    source,
    alt,
    sizes,
    title,
    lazy,
    atom,
    onLoad,
    onError,
  }: {
    source: ImageSource;
    alt: string;
    sizes?: string;
    title?: string;
    lazy?: boolean;
    atom?: boolean;
    onLoad?(img: HTMLImageElement): void;
    onError(): void;
  } = $props();
  let loaded = $state<string | null>(null);
  const sized = $derived(source.width !== undefined && source.height !== undefined);
</script>

<img
  data-atom={atom ? "" : undefined}
  class={sized && loaded !== source.src ? "image-loading" : undefined}
  src={source.src}
  srcset={source.srcset}
  sizes={source.srcset ? sizes : undefined}
  width={source.width}
  height={source.height}
  {alt}
  {title}
  loading={lazy === false ? undefined : "lazy"}
  decoding="async"
  onload={(e) => {
    loaded = source.src;
    onLoad?.(e.currentTarget as HTMLImageElement);
  }}
  onerror={() => onError()}
/>
