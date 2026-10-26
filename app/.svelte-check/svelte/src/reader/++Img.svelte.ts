///<reference types="svelte" />
;
/**
   * An image from its source (TEMPRA-162): the stored width and height, so its box is reserved
   * before it loads (a quiet grey box, `.image-loading`, until it has), and its candidates with
   * the `sizes` of where it is drawn. Without a known size, just the original.
   */
import type { ImageSource } from "../images";

;type $$ComponentProps =  {
    source: ImageSource;
    alt: string;
    sizes?: string;
    title?: string;
    lazy?: boolean;
    atom?: boolean;
    onLoad?(img: HTMLImageElement): void;
    onError(): void;
  };function $$render() {

  
  

  let {
    source,
    alt,
    sizes,
    title,
    lazy,
    atom,
    onLoad,
    onError,
  }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  let loaded = $state<string | null>(null);
  const sized = $derived(source.width !== undefined && source.height !== undefined);
;
async () => {

 { svelteHTML.createElement("img", {                         ...__sveltets_2_empty({"data-atom":atom ? "" : undefined}),"class":sized && loaded !== source.src ? "image-loading" : undefined,"src":source.src,"srcset":source.srcset,"sizes":source.srcset ? sizes : undefined,"width":source.width,"height":source.height,alt,title,"loading":lazy === false ? undefined : "lazy","decoding":`async`,"onload":(e) => {
    loaded = source.src;
    onLoad?.(e.currentTarget as HTMLImageElement);
  },"onerror":() => onError(),});}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Img__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Img__SvelteComponent_ = ReturnType<typeof Img__SvelteComponent_>;
/*Ωignore_endΩ*/export default Img__SvelteComponent_;