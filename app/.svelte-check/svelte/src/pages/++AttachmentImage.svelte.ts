///<reference types="svelte" />
;
import { imageSource } from "../images";
import Img from "../reader/Img.svelte";
import { baseName, type Urls } from "../urls";
import { ATTACHMENT_SIZES, type AttachmentFile } from "./file";

;type $$ComponentProps =  {
    urls: Urls;
    file: AttachmentFile;
    /** What it shows (its description), else its filename. */
    alt?: string;
    onLoad?(img: HTMLImageElement): void;
    onError(): void;
  };function $$render() {

  
  
  
  

  /**
   * An attachment's image on its page, from the image route (TEMPRA-162): its box reserved from
   * the stored size, a grey box until it loads, its scaled widths for the screen; Download stays the
   * original.
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
;
async () => {

 { const $$_gmI0C = __sveltets_2_ensureComponent(Img); new $$_gmI0C({ target: __sveltets_2_any(), props: {             "source":imageSource(props.urls, props.file),"alt":props.alt ?? baseName(props.file.path),"sizes":ATTACHMENT_SIZES,"lazy":false,"onLoad":props.onLoad,"onError":props.onError,}});}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const AttachmentImage__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type AttachmentImage__SvelteComponent_ = ReturnType<typeof AttachmentImage__SvelteComponent_>;
/*Ωignore_endΩ*/export default AttachmentImage__SvelteComponent_;