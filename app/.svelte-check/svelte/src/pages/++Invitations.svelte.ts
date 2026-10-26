///<reference types="svelte" />
;
import { api } from "../api";
import Avatar from "../Avatar.svelte";
import { useAction, useLoad } from "../load.svelte.ts";
import Moment from "../Moment.svelte";
import Status from "../Status.svelte";
import { day } from "../ui";
import { useTitle } from "../ui.svelte.ts";
import { Urls } from "../urls";
import type { PendingInvitation } from "./account";
function $$render() {

  
  
  
  
  
  
  
  
  

  /** Invitations to other people's libraries (tempra-dev: v2/sharing), to accept or decline. */
  useTitle(() => "Invitations");
  const loaded = useLoad(
    () => "invitations",
    () => api<{ invitations: PendingInvitation[] }>("/api/v1/invitations"),
  );
  const action = useAction();
  const answer = (i: PendingInvitation, accept: boolean) =>
    action.run(async () => {
      await api(
        `/api/v1/invitations/${encodeURIComponent(i.id)}/${accept ? "accept" : "decline"}`,
        {
          method: "POST",
        },
      );
      if (accept) {
        // A full load: the library list and the workspace learn the new library.
        location.assign(new Urls(i.owner, i.slug).tree(""));
        return;
      }
      loaded.reload();
    });
;
async () => {

 { svelteHTML.createElement("h1", {});  }
if(action.error){ { svelteHTML.createElement("div", { "class":`notice`,});action.error; }}
 { const $$_sutatS0C = __sveltets_2_ensureComponent(Status); const $$_sutatS0 = new $$_sutatS0C({ target: __sveltets_2_any(), props: { "loaded":loaded.current,children:({ invitations }) => { async ()/*Ωignore_positionΩ*/ => {
    if(invitations.length === 0){
       { svelteHTML.createElement("p", {});  }
    }else{
       { svelteHTML.createElement("ul", { "class":`invitations`,});
           for(let i of __sveltets_2_ensureArray(invitations)){i.id;
           { svelteHTML.createElement("li", { "class":`invitation`,});
             { svelteHTML.createElement("p", { "class":`invitation-from`,});
               { const $$_ratavA3C = __sveltets_2_ensureComponent(Avatar); new $$_ratavA3C({ target: __sveltets_2_any(), props: {  "name":i.handle,}});} { svelteHTML.createElement("span", { }); i.handle;  if(i.created){" · "; { const $$_tnemoM4C = __sveltets_2_ensureComponent(Moment); new $$_tnemoM4C({ target: __sveltets_2_any(), props: {  "ts":i.created,}});}} }
             }
             { svelteHTML.createElement("div", { "class":`invitation-card`,});
              
               { svelteHTML.createElement("span", {   "class":`lib-tile shared`,"aria-hidden":`true`,});(i.slug.trim()[0] ?? "?").toUpperCase(); } { svelteHTML.createElement("div", { "class":`invitation-library`,});
                 { svelteHTML.createElement("strong", {});i.owner; i.slug; } { svelteHTML.createElement("span", {});  day(i.expires); }
               }
             }
             { svelteHTML.createElement("p", { "class":`invitation-access`,});
               { svelteHTML.createElement("span", {});  }i.role === "write" ? "Can read and write" : "Can read and comment";
             }
             { svelteHTML.createElement("p", { "class":`actions`,});
               { svelteHTML.createElement("button", {        "type":`button`,"class":`primary`,"disabled":action.busy,"onclick":() => void answer(i, true),});  } { svelteHTML.createElement("button", {     "type":`button`,"disabled":action.busy,"onclick":() => void answer(i, false),});  }
             }
           }
        }
       }
    }
  };return __sveltets_2_any(0)},}});/*Ωignore_startΩ*/const {children} = $$_sutatS0.$$prop_def;/*Ωignore_endΩ*/
  
 Status}
};
return { props: {} as Record<string, never>, exports: {}, bindings: "", slots: {}, events: {} }}
const Invitations__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type Invitations__SvelteComponent_ = InstanceType<typeof Invitations__SvelteComponent_>;
/*Ωignore_endΩ*/export default Invitations__SvelteComponent_;