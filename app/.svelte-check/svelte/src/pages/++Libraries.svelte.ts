///<reference types="svelte" />
;
import { ApiError, api } from "../api";
import ComposeDialog from "../ComposeDialog.svelte";
import Icon from "../Icon.svelte";
import { useLoad } from "../load.svelte.ts";
import PageBar from "../PageBar.svelte";
import { libraryLabel } from "../role";
import { navigate } from "../router";
import Status from "../Status.svelte";
import { useMe, useTitle } from "../ui.svelte.ts";
import { Urls } from "../urls";
import { cardFacts, type Library, slugFrom } from "./libraries";

;type $$ComponentProps =  { create: boolean };function $$render() {
 const newLibrary/*Ωignore_positionΩ*/ = (className: string)/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {
   { svelteHTML.createElement("button", {        "type":`button`,"class":className,"aria-haspopup":`dialog`,"onclick":() => (creating = true),}); { const $$_nocI1C = __sveltets_2_ensureComponent(Icon); new $$_nocI1C({ target: __sveltets_2_any(), props: {  "name":`plus`,}});}  }
};return __sveltets_2_any(0)};  const barNew/*Ωignore_positionΩ*/ = ()/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {;__sveltets_2_ensureSnippet(newLibrary("tool-pill primary bar-new"));};return __sveltets_2_any(0)}; const tile/*Ωignore_positionΩ*/ = (name: string, shared: boolean)/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {
   { svelteHTML.createElement("span", {   "class":shared ? "lib-tile shared" : "lib-tile","aria-hidden":`true`,});(name.trim()[0] ?? "?").toUpperCase(); }
};return __sveltets_2_any(0)}; const cards/*Ωignore_positionΩ*/ = (heading: string, libraries: Library[])/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {
   { svelteHTML.createElement("section", { "aria-label":heading,});
     { svelteHTML.createElement("h2", { "class":`lib-section-title`,});heading; }
     { svelteHTML.createElement("ul", { "class":`lib-cards`,});
         for(let l of __sveltets_2_ensureArray(libraries)){l.id;
        const facts = cardFacts(l);
         { svelteHTML.createElement("li", {});
           { svelteHTML.createElement("a", {    "class":`lib-card`,"href":new Urls(l.owner, l.slug).tree(""),}); { svelteHTML.createElement("span", { "class":`lib-card-cover`,});;__sveltets_2_ensureSnippet(tile(l.title || l.slug, (l.role ?? "owner") !== "owner")); } { svelteHTML.createElement("span", {  "class":`lib-card-body`,}); { svelteHTML.createElement("span", { "class":`lib-card-name`,}); { svelteHTML.createElement("span", {});libraryLabel(l); } }if(l.description){ { svelteHTML.createElement("span", { "class":`lib-card-desc`,});l.description; }}if(facts.length > 0){ { svelteHTML.createElement("span", {  "class":`lib-card-meta`,});facts.join(" · "); }} } }
         }
      }
     }
   }
};return __sveltets_2_any(0)};
  
  
  
  
  
  
  
  
  
  
  

  /**
   * The account's libraries (take 4, board 01): cards under Yours and Shared with you, each with
   * its title, what is for the person there, its description and one line of facts; New library
   * in the top bar, and on a phone a button floating at the screen's bottom right instead
   * (TEMPRA-148); the switcher's menu lands here with ?new=1.
   */
  let { create }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  useTitle(() => "Libraries");
  const loaded = useLoad(
    () => "libraries",
    () => api<{ libraries: Library[] }>("/api/v1/libraries").then((r) => r.libraries),
  );
  let creating = $state(create);
  const invited = useLoad(
    () => "invitations",
    () => api<{ invitations: unknown[] }>("/api/v1/invitations"),
  );
  const waiting = $derived(invited.data?.invitations.length ?? 0);

  /**
   * New library, as a compose dialog over the list: its name, a description, and its address
   * (filled in from the name until the person edits it). Creating opens the new library.
   */
  const me = useMe();
  let title = $state("");
  let slug = $state<string | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  const address = $derived(slug ?? slugFrom(title));
  function close() {
    title = "";
    slug = null;
    error = null;
    creating = false;
  }
  async function submit(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
    e.preventDefault();
    const description = String(new FormData(e.currentTarget).get("description") ?? "")
      .replace(/\s+/g, " ")
      .trim();
    busy = true;
    error = null;
    try {
      const lib = await api<Library>("/api/v1/libraries", {
        method: "POST",
        body: JSON.stringify({
          slug: address,
          title: title.trim() || undefined,
          description: description || undefined,
        }),
      });
      navigate(new Urls(lib.owner, lib.slug).tree(""));
    } catch (err) {
      error = err instanceof ApiError ? err.message : String(err);
      busy = false;
    }
  }
;
async () => {











 { const $$_raBegaP0C = __sveltets_2_ensureComponent(PageBar); new $$_raBegaP0C({ target: __sveltets_2_any(), props: {  "actions":barNew,}});}
;__sveltets_2_ensureSnippet(newLibrary("primary fab"));
 { svelteHTML.createElement("h1", {});  }
  { const $$_golaiDesopmoC0C = __sveltets_2_ensureComponent(ComposeDialog); const $$_golaiDesopmoC0 = new $$_golaiDesopmoC0C({ target: __sveltets_2_any(), props: {            children:() => { return __sveltets_2_any(0); },"open":creating,"onClose":close,"title":`New library`,"action":`Create library`,busy,error,"onSubmit":submit,context:() => { async ()/*Ωignore_positionΩ*/ => {me.current ? `@${me.current.handle}` : "You";};return __sveltets_2_any(0)},fields:() => { async ()/*Ωignore_positionΩ*/ => {
     { svelteHTML.createElement("label", { "class":`compose-field`,});
       { svelteHTML.createElement("span", { "class":me.current ? "compose-prefix" : undefined,});me.current ? `${me.current.handle}/` : "Address"; }
       { svelteHTML.createElement("input", {                  "name":`slug`,"type":`text`,"aria-label":`Address`,"placeholder":`team-notes`,"required":true,"pattern":"[a-z0-9][a-z0-9\\-]{0,62}","title":`Lowercase letters, digits and dashes`,"value":address,"oninput":(e) => (slug = e.currentTarget.value),});}
     }
  };return __sveltets_2_any(0)},}});/*Ωignore_startΩ*/const {context, fields} = $$_golaiDesopmoC0.$$prop_def;/*Ωignore_endΩ*/
  
  
   { svelteHTML.createElement("input", {                   "class":`compose-title`,"name":`title`,"type":`text`,"aria-label":`Name`,"placeholder":`Library name`,"maxlength":120,"autocomplete":`off`,...__sveltets_2_empty({"data-autofocus":`true`}),"bind:value":title,});/*Ωignore_startΩ*/() => title = __sveltets_2_any(null);/*Ωignore_endΩ*/}
   { svelteHTML.createElement("textarea", {             "class":`compose-text`,"name":`description`,"aria-label":`Description`,"placeholder":`Add a description…`,"maxlength":300,"rows":3,}); }
 ComposeDialog}
if(waiting > 0){
   { svelteHTML.createElement("p", {});
     { svelteHTML.createElement("a", { "href":`/inbox`,});waiting === 1 ? "An invitation" : `${waiting} invitations`;    }
    waiting === 1 ? "is" : "are";   
   }
}
 { const $$_sutatS0C = __sveltets_2_ensureComponent(Status); const $$_sutatS0 = new $$_sutatS0C({ target: __sveltets_2_any(), props: { "loaded":loaded.current,children:(libs) => { async ()/*Ωignore_positionΩ*/ => {
    const yours = libs.filter((l) => (l.role ?? "owner") === "owner");
    const shared = libs.filter((l) => (l.role ?? "owner") !== "owner");
    if(libs.length === 0){ { svelteHTML.createElement("p", { "class":`muted`,});   }}
    if(yours.length > 0){;__sveltets_2_ensureSnippet(cards("Yours", yours));}
    if(shared.length > 0){;__sveltets_2_ensureSnippet(cards("Shared with you", shared));}
  };return __sveltets_2_any(0)},}});/*Ωignore_startΩ*/const {children} = $$_sutatS0.$$prop_def;/*Ωignore_endΩ*/
  
 Status}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Libraries__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Libraries__SvelteComponent_ = ReturnType<typeof Libraries__SvelteComponent_>;
/*Ωignore_endΩ*/export default Libraries__SvelteComponent_;