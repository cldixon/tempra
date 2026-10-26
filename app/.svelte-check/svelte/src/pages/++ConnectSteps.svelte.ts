///<reference types="svelte" />
;
import CopyField from "../CopyField.svelte";

;type $$ComponentProps =  {
    slug?: string;
    library?: string;
    /** On the Agents page, New token opens its dialog there. */
    onNewToken?: () => void;
  };function $$render() {

  

  /**
   * How to connect each kind of client; `slug` names the library when the page is about one, and
   * `library` (owner/slug) picks it in the token form.
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const mcp = `${location.origin}/mcp`;
;
async () => {

 { svelteHTML.createElement("h2", {});  }
 { svelteHTML.createElement("p", {});
           props.slug
    ? `choose All libraries, or select ${props.slug}`
    : "choose All libraries, or select the ones it may use";
 }
 { svelteHTML.createElement("p", {});
   { const $$_dleiFypoC1C = __sveltets_2_ensureComponent(CopyField); new $$_dleiFypoC1C({ target: __sveltets_2_any(), props: {    "value":mcp,"label":`the MCP URL`,}});}
 }
 { svelteHTML.createElement("h2", {});  }
 { svelteHTML.createElement("p", {});
   { const $$_dleiFypoC1C = __sveltets_2_ensureComponent(CopyField); new $$_dleiFypoC1C({ target: __sveltets_2_any(), props: {    "value":`claude mcp add --transport http tempra ${mcp}`,"label":`the Claude Code command`,}});}
 }
 { svelteHTML.createElement("p", {});         }
 { svelteHTML.createElement("h2", {});    }
 { svelteHTML.createElement("p", {});
  if(props.onNewToken){
     { svelteHTML.createElement("button", {   "type":`button`,"onclick":props.onNewToken,});  }
  }else{
     { svelteHTML.createElement("a", {  "href":props.library
        ? `/agents?new=token&library=${encodeURIComponent(props.library)}`
        : "/agents?new=token",});  }
  }
 }
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const ConnectSteps__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type ConnectSteps__SvelteComponent_ = ReturnType<typeof ConnectSteps__SvelteComponent_>;
/*Ωignore_endΩ*/export default ConnectSteps__SvelteComponent_;