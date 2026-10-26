<script lang="ts">
  import { imageSource } from "../images";
  import Img from "../reader/Img.svelte";
  import { baseName, type Urls } from "../urls";
  import { ATTACHMENT_SIZES, type AttachmentFile } from "./file";

  /**
   * An attachment's image on its page, from the image route (TEMPRA-162): its box reserved from
   * the stored size, a grey box until it loads, its scaled widths for the screen; Download stays the
   * original.
   */
  let props: {
    urls: Urls;
    file: AttachmentFile;
    /** What it shows (its description), else its filename. */
    alt?: string;
    onLoad?(img: HTMLImageElement): void;
    onError(): void;
  } = $props();
</script>

<Img
  source={imageSource(props.urls, props.file)}
  alt={props.alt ?? baseName(props.file.path)}
  sizes={ATTACHMENT_SIZES}
  lazy={false}
  onLoad={props.onLoad}
  onError={props.onError}
/>
