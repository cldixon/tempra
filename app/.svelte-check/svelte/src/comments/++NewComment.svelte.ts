///<reference types="svelte" />
;
import { api } from "../api";
import { useAction } from "../load.svelte.ts";
import MentionArea from "../MentionArea.svelte";
import { useMentionable } from "../mentions.svelte.ts";
import { clip } from "../ui";
import type { Urls } from "../urls";
import { useComposing } from "./composing.svelte.ts";
import type { Draft, Thread } from "./data";

;type $$ComponentProps =  {
    urls: Urls;
    path: string;
    draft: Draft | null;
    onDone(): void;
    onPosted(id: string): void;
  };function $$render() {

  
  
  
  
  
  
  
  

  /**
   * A new comment: on the selected text (a draft, started from the selection toolbar, at the top
   * of the Comments panel) or on the whole concept. Escape, Cancel, or leaving it empty drops it.
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const action = useAction();
  let text = $state("");
  let box: HTMLTextAreaElement | undefined = $state();
  const people = useMentionable(() => props.urls);
  useComposing(() => props.draft !== null || text.trim() !== "");
  // The box takes the focus when it opens (from the toolbar, or "Comment on the page"), and on a
  // new draft.
  $effect(() => {
    void props.draft;
    box?.focus();
  });
  function submit(e: SubmitEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    const draft = props.draft;
    void action.run(async () => {
      const r = await api<{ thread: Thread }>(props.urls.api("comments"), {
        method: "POST",
        body: JSON.stringify({
          path: props.path,
          body,
          anchor: draft ? { quote: draft.quote, from: draft.from } : null,
        }),
      });
      text = "";
      props.onDone();
      props.onPosted(r.thread.id);
    });
  }
;
async () => {

 { svelteHTML.createElement("form", {    "class":`thread open comment-form`,"onsubmit":submit,});if(props.draft){ { svelteHTML.createElement("blockquote", { "class":`quote thread-quote`,});clip(props.draft.quote, 300); }} { svelteHTML.createElement("label", {    "class":`visually-hidden`,"for":`new-comment`,});  } { const $$_aerAnoitneM1C = __sveltets_2_ensureComponent(MentionArea); const $$_aerAnoitneM1 = new $$_aerAnoitneM1C({ target: __sveltets_2_any(), props: {                 "id":`new-comment`,textarea:box,"value":text,"onValue":(v) => (text = v),"people":people.current,"onkeydown":(e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        props.onDone();
      }
    },"onblur":(e) => {
      // Leaving an empty draft drops it, as a click away does.
      const to = e.relatedTarget instanceof Element ? e.relatedTarget : null;
      if (!e.currentTarget.value.trim() && !to?.closest(".comment-form")) props.onDone();
    },"placeholder":props.draft ? "Comment on the selection" : "Comment on the page",}});/*Ωignore_startΩ*/() => box = __sveltets_2_any(null);/*Ωignore_endΩ*/$$_aerAnoitneM1.$$bindings = 'textarea';}if(action.error){ { svelteHTML.createElement("div", { "class":`notice`,});action.error; }} { svelteHTML.createElement("div", {  "class":`actions`,}); { svelteHTML.createElement("button", {     "type":`button`,"class":`ghost`,"onclick":() => props.onDone(),});  } { svelteHTML.createElement("button", {     "class":`primary`,"type":`submit`,"disabled":action.busy || !text.trim(),});  } } }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const NewComment__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type NewComment__SvelteComponent_ = ReturnType<typeof NewComment__SvelteComponent_>;
/*Ωignore_endΩ*/export default NewComment__SvelteComponent_;