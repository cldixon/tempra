///<reference types="svelte" />
;
import { agentLabel, type Contributor } from "../agents";
import { api, field } from "../api";
import ConfirmDialog from "../ConfirmDialog.svelte";
import { useConfirm } from "../confirm.svelte.ts";
import { useAction, useLoad } from "../load.svelte.ts";
import Moment from "../Moment.svelte";
import { useLibraryLabel } from "../role.svelte.ts";
import Status from "../Status.svelte";
import { day, plural } from "../ui";
import { useTitle } from "../ui.svelte.ts";
import type { Urls } from "../urls";
import { json, type MembersData, ROLE_WORDS } from "./manage";

;type $$ComponentProps =  { urls: Urls; me: string | null };function $$render() {
  const roleBody/*Ωignore_positionΩ*/ = ()/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {
   { svelteHTML.createElement("p", {});
    subject.handle;     subject.role === "write" ? "read and write" : "read and comment";
        
   }
};return __sveltets_2_any(0)};  const removeBody/*Ωignore_positionΩ*/ = ()/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {
   { svelteHTML.createElement("p", {}); subject.handle;           }
};return __sveltets_2_any(0)};  const leaveBody/*Ωignore_positionΩ*/ = ()/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {
   { svelteHTML.createElement("p", {});         urls.owner;     }
};return __sveltets_2_any(0)};  const withdrawBody/*Ωignore_positionΩ*/ = ()/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {
   { svelteHTML.createElement("p", {}); subject.handle;      }
};return __sveltets_2_any(0)};
  
  
  
  
  
  
  
  
  
  
  
  

  /**
   * Who is in the library (tempra-dev: v2/sharing): the owner, members with their access, and the
   * agents that have worked here, each for its person. The owner invites, changes access and
   * removes; a member may leave. Each of those asks first (S-4).
   */
  let { urls, me }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const label = useLibraryLabel(() => urls);
  useTitle(() => `Members · ${label.current}`);
  const loaded = useLoad(
    () => `members ${urls.base}`,
    async () => {
      const [m, a] = await Promise.all([
        api<MembersData>(urls.api("members")),
        api<{ contributors: Contributor[] }>(urls.api("agents")),
      ]);
      return { ...m, contributors: a.contributors };
    },
  );
  const action = useAction();
  const c = useConfirm();
  let notice = $state<string | null>(null);
  /** Whom a confirmation is about, for its body. */
  let subject = $state.raw<{ handle: string; role: "read" | "write" }>({ handle: "", role: "read" });
  const done = (text: string) => {
    notice = text;
    loaded.reload();
  };

  function invite(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
    e.preventDefault();
    const form = e.currentTarget;
    const to = field(form, "to");
    const role = field(form, "role");
    void action.run(async () => {
      const r = await api<{ sent: string; handle?: string }>(
        urls.api("invitations"),
        json({ to, role }),
      );
      form.reset();
      done(
        r.sent === "invited"
          ? `Invited @${r.handle}. They accept it from their Inbox.`
          : "If that address has a Tempra account, they will get the invitation.",
      );
    });
  }
  const member = (handle: string) => urls.api(`members/${encodeURIComponent(handle)}`);
  const setRole = (handle: string, role: "read" | "write") => {
    subject = { handle, role };
    c.confirm({
      title: `Change @${handle}'s access?`,
      body: roleBody,
      action: "Change access",
      run: () =>
        action.run(async () => {
          await api(member(handle), { method: "PUT", body: JSON.stringify({ role }) });
          done(`@${handle} now has ${role} access.`);
        }),
    });
  };
  const remove = (handle: string) => {
    subject = { handle, role: "read" };
    c.confirm({
      title: `Remove @${handle}?`,
      body: removeBody,
      action: "Remove",
      run: () =>
        action.run(async () => {
          await api(member(handle), { method: "DELETE" });
          done(`Removed @${handle}.`);
        }),
    });
  };
  const leave = (handle: string) =>
    c.confirm({
      title: "Leave this library?",
      body: leaveBody,
      action: "Leave",
      run: () =>
        action.run(async () => {
          await api(member(handle), { method: "DELETE" });
          location.assign("/");
        }),
    });
  const withdraw = (id: string, handle: string) => {
    subject = { handle, role: "read" };
    c.confirm({
      title: "Withdraw the invitation?",
      body: withdrawBody,
      action: "Withdraw",
      run: () =>
        action.run(async () => {
          await api(urls.api(`invitations/${encodeURIComponent(id)}`), { method: "DELETE" });
          done("Invitation withdrawn.");
        }),
    });
  };
;
async () => {









 { svelteHTML.createElement("h1", {});  }
 { const $$_golaiDmrifnoC0C = __sveltets_2_ensureComponent(ConfirmDialog); new $$_golaiDmrifnoC0C({ target: __sveltets_2_any(), props: {  "asking":c,}});}
if(notice){ { svelteHTML.createElement("div", { "class":`notice ok`,});notice; }}
if(action.error){ { svelteHTML.createElement("div", { "class":`notice`,});action.error; }}
 { const $$_sutatS0C = __sveltets_2_ensureComponent(Status); const $$_sutatS0 = new $$_sutatS0C({ target: __sveltets_2_any(), props: { "loaded":loaded.current,children:(d) => { async ()/*Ωignore_positionΩ*/ => {
    const owner = d.role === "owner";
     { svelteHTML.createElement("div", { "class":`table-wrap`,});
       { svelteHTML.createElement("table", { "class":`list`,});
         { svelteHTML.createElement("thead", {});
           { svelteHTML.createElement("tr", {});
             { svelteHTML.createElement("th", {});  }
             { svelteHTML.createElement("th", {});  }
             { svelteHTML.createElement("th", {});
               { svelteHTML.createElement("span", { "class":`visually-hidden`,});  }
             }
           }
         }
         { svelteHTML.createElement("tbody", {});
           { svelteHTML.createElement("tr", {});
             { svelteHTML.createElement("td", { "class":`name`,}); d.owner; }
             { svelteHTML.createElement("td", {});  }
             { svelteHTML.createElement("td", {}); }
           }
             for(let m of __sveltets_2_ensureArray(d.members)){m.handle;
             { svelteHTML.createElement("tr", {});
               { svelteHTML.createElement("td", { "class":`name`,}); m.handle; }
               { svelteHTML.createElement("td", {});
                if(owner){
                   { svelteHTML.createElement("select", {         "aria-label":`Access for @${m.handle}`,"value":m.role,"disabled":action.busy,"onchange":(e) => {
                      // The select shows the saved access until the change is confirmed and saved.
                      const role = e.currentTarget.value as "read" | "write";
                      e.currentTarget.value = m.role;
                      setRole(m.handle, role);
                    },});
                     { svelteHTML.createElement("option", { "value":`read`,});ROLE_WORDS.read; }
                     { svelteHTML.createElement("option", { "value":`write`,});ROLE_WORDS.write; }
                   }
                }else{
                  ROLE_WORDS[m.role];
                }
               }
               { svelteHTML.createElement("td", {});
                if(owner){
                   { svelteHTML.createElement("button", {     "type":`button`,"disabled":action.busy,"onclick":() => remove(m.handle),});  }
                } else if (m.handle === me){
                   { svelteHTML.createElement("button", {     "type":`button`,"disabled":action.busy,"onclick":() => leave(m.handle),});  }
                }
               }
             }
          }
         }
       }
     }

    if(owner){
       { svelteHTML.createElement("h2", {});  }
       { svelteHTML.createElement("form", {   "class":`token`,"onsubmit":invite,});
         { svelteHTML.createElement("p", {});
           { svelteHTML.createElement("label", {});
              
             { svelteHTML.createElement("input", {        "type":`text`,"name":`to`,"required":true,"autocomplete":`off`,"placeholder":`@ann`,});}
           }
           { svelteHTML.createElement("label", {});
            
             { svelteHTML.createElement("select", { "name":`role`,});
               { svelteHTML.createElement("option", {  "value":`read`,"selected":true,});ROLE_WORDS.read; }
               { svelteHTML.createElement("option", { "value":`write`,});ROLE_WORDS.write; }
             }
           }
           { svelteHTML.createElement("button", {     "class":`primary`,"type":`submit`,"disabled":action.busy,});  }
         }
         { svelteHTML.createElement("p", { "class":`small muted`,});
                         
         }
       }
      if((d.invitations ?? []).length > 0){
         { svelteHTML.createElement("h2", {});  }
         { svelteHTML.createElement("ul", {});
             for(let i of __sveltets_2_ensureArray(d.invitations ?? [])){i.id;
             { svelteHTML.createElement("li", {});
              i.handle; ROLE_WORDS[i.role].toLowerCase();   day(i.expires);
               { svelteHTML.createElement("button", {     "type":`button`,"disabled":action.busy,"onclick":() => withdraw(i.id, i.handle),});  }
             }
          }
         }
      }
    }

     { svelteHTML.createElement("h2", {});    }
    if(d.contributors.length === 0){
       { svelteHTML.createElement("p", { "class":`muted`,});  }
    }else{
       { svelteHTML.createElement("ul", {});
           for(let w of __sveltets_2_ensureArray(d.contributors)){`${w.person}|${w.agent?.id ?? ""}`;
           { svelteHTML.createElement("li", {});
             { svelteHTML.createElement("a", { "href":urls.activity({ view: "events", actor: w.actor }),});agentLabel(w); }
             { svelteHTML.createElement("span", { "class":`small muted`,});plural(w.requests, "change");   { const $$_tnemoM3C = __sveltets_2_ensureComponent(Moment); new $$_tnemoM3C({ target: __sveltets_2_any(), props: {  "ts":w.last_ts,}});} }
           }
        }
       }
    }
  };return __sveltets_2_any(0)},}});/*Ωignore_startΩ*/const {children} = $$_sutatS0.$$prop_def;/*Ωignore_endΩ*/
  
 Status}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Members__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Members__SvelteComponent_ = ReturnType<typeof Members__SvelteComponent_>;
/*Ωignore_endΩ*/export default Members__SvelteComponent_;