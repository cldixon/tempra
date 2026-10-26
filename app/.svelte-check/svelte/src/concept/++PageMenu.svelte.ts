///<reference types="svelte" />
;
import Icon from "../Icon.svelte";
import Menu from "../Menu.svelte";
import { baseName, type Urls } from "../urls";
import type { PanelName } from "./panel";
import { storedFile } from "./tools";
import { useCopied } from "./tools.svelte.ts";

;type $$ComponentProps =  {
    urls: Urls;
    path: string;
    panel: PanelName | null;
    markdown: boolean;
    onPanel(name: PanelName): void;
    onMarkdown(on: boolean): void;
  };function $$render() {

  
  
  
  
  
  

  /** ⋯: Copy page, the panels that are not Comments, the Markdown view, the page's link and file. */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const link = useCopied();
  const page = useCopied();
;
async () => {

 { const $$_uneM0C = __sveltets_2_ensureComponent(Menu); const $$_uneM0 = new $$_uneM0C({ target: __sveltets_2_any(), props: {        children:() => { return __sveltets_2_any(0); },"name":`More`,"title":`More`,"buttonClass":`icon-button`,"align":`end`,label:() => { async ()/*Ωignore_positionΩ*/ => { { const $$_nocI0C = __sveltets_2_ensureComponent(Icon); new $$_nocI0C({ target: __sveltets_2_any(), props: {  "name":`more`,}});}};return __sveltets_2_any(0)},}});/*Ωignore_startΩ*/const {label} = $$_uneM0.$$prop_def;/*Ωignore_endΩ*/ { svelteHTML.createElement("button", {         "type":`button`,"class":`menu-item`,...__sveltets_2_empty({"data-stay":`true`}),"onclick":() => page.run(() => storedFile(props.urls, props.path)),}); { const $$_nocI2C = __sveltets_2_ensureComponent(Icon); new $$_nocI2C({ target: __sveltets_2_any(), props: {  "name":`copy`,}});}  { svelteHTML.createElement("span", { "aria-live":`polite`,});page.state === "copied" ? "Copied" : page.state === "failed" ? "Could not copy" : "Copy page"; } } { svelteHTML.createElement("hr", {});} { svelteHTML.createElement("button", {        "type":`button`,"class":`menu-item`,"aria-pressed":props.panel === "history","onclick":() => props.onPanel("history"),}); { const $$_nocI2C = __sveltets_2_ensureComponent(Icon); new $$_nocI2C({ target: __sveltets_2_any(), props: {  "name":`history`,}});}  } { svelteHTML.createElement("button", {        "type":`button`,"class":`menu-item`,"aria-pressed":props.panel === "properties","onclick":() => props.onPanel("properties"),}); { const $$_nocI2C = __sveltets_2_ensureComponent(Icon); new $$_nocI2C({ target: __sveltets_2_any(), props: {  "name":`properties`,}});}  } { svelteHTML.createElement("button", {        "type":`button`,"class":`menu-item`,"aria-pressed":props.markdown,"onclick":() => props.onMarkdown(!props.markdown),}); { const $$_nocI2C = __sveltets_2_ensureComponent(Icon); new $$_nocI2C({ target: __sveltets_2_any(), props: {  "name":`markdown`,}});} props.markdown ? "Back to page" : "View Markdown"; } { svelteHTML.createElement("hr", {});} { svelteHTML.createElement("button", {       "type":`button`,"class":`menu-item`,"onclick":() => link.run(async () => new URL(props.urls.pinned(props.urls.at).file(props.path), location.href).href),}); { const $$_nocI2C = __sveltets_2_ensureComponent(Icon); new $$_nocI2C({ target: __sveltets_2_any(), props: {  "name":`link`,}});}   } { svelteHTML.createElement("a", {     "class":`menu-item`,"href":props.urls.raw(props.path),"download":baseName(props.path),}); { const $$_nocI2C = __sveltets_2_ensureComponent(Icon); new $$_nocI2C({ target: __sveltets_2_any(), props: {  "name":`download`,}});}   { svelteHTML.createElement("span", { "class":`menu-hint`,});  } } Menu}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const PageMenu__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type PageMenu__SvelteComponent_ = ReturnType<typeof PageMenu__SvelteComponent_>;
/*Ωignore_endΩ*/export default PageMenu__SvelteComponent_;