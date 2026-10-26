///<reference types="svelte" />
;
import { untrack } from "svelte";
import { api, field } from "../api";
import ComposeDialog from "../ComposeDialog.svelte";
import ConfirmDialog from "../ConfirmDialog.svelte";
import CopyField from "../CopyField.svelte";
import { useConfirm } from "../confirm.svelte.ts";
import Dialog from "../Dialog.svelte";
import { useAction, useLoad } from "../load.svelte.ts";
import Status from "../Status.svelte";
import { day, type Me } from "../ui";
import { useTitle } from "../ui.svelte.ts";
import { type AppGrant, chosenLibrary, liveToken, type Minted, type TokenRow } from "./account";
import ConnectSteps from "./ConnectSteps.svelte";

;type $$ComponentProps =  { me: Me | null; newToken: boolean; library: string | null };function $$render() {
  const appBody/*Ωignore_positionΩ*/ = ()/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {
   { svelteHTML.createElement("p", {});              }
};return __sveltets_2_any(0)};  const tokenBody/*Ωignore_positionΩ*/ = ()/*Ωignore_startΩ*/: ReturnType<import('svelte').Snippet>/*Ωignore_endΩ*/ => { async ()/*Ωignore_positionΩ*/ => {
   { svelteHTML.createElement("p", {});    revoking?.actor;          }
};return __sveltets_2_any(0)};
  
  
  
  
  
  
  
  
  
  
  
  
  

  /**
   * /agents: how agents get into the person's libraries, in one place (2026-10-23; it replaced
   * Connect an agent, Tokens and Connected apps): the steps to connect, then everything that can act
   * in their libraries, apps connected over OAuth and tokens alike, each with Revoke; New token
   * opens the compose dialog (`?new=token`, with `?library=` picking its library).
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  useTitle(() => "Agents");
  const loaded = useLoad(
    () => "agents",
    async () => {
      const [a, t, l] = await Promise.all([
        api<{ apps: AppGrant[] }>("/api/v1/apps"),
        api<{ tokens: TokenRow[] }>("/api/v1/tokens"),
        api<{ libraries: { owner: string; slug: string; role?: string }[] }>("/api/v1/libraries"),
      ]);
      // An own library by its slug; one shared with the person as owner/slug, the name the
      // server mints on (a member's token is held to their role there).
      const names = l.libraries.map((x) =>
        (x.role ?? "owner") === "owner" ? x.slug : `${x.owner}/${x.slug}`,
      );
      return { apps: a.apps, tokens: t.tokens, libraries: names };
    },
  );
  let creating = $state(untrack(() => props.newToken));
  let minted = $state.raw<Minted | null>(null);
  const action = useAction();
  let notice = $state<string | null>(null);
  const c = useConfirm();
  /** The token a confirmation is about, for its body. */
  let revoking = $state.raw<TokenRow | null>(null);

  const revokeApp = (a: AppGrant) =>
    c.confirm({
      title: `Revoke ${a.app}?`,
      body: appBody,
      action: "Revoke",
      run: () =>
        action.run(async () => {
          await api(`/api/v1/apps/${encodeURIComponent(a.id)}`, { method: "DELETE" });
          notice = `${a.app} revoked.`;
          loaded.reload();
        }),
    });
  const revokeToken = (t: TokenRow) => {
    revoking = t;
    c.confirm({
      title: "Revoke this token?",
      body: tokenBody,
      action: "Revoke",
      run: () =>
        action.run(async () => {
          await api(`/api/v1/tokens/${encodeURIComponent(t.id)}`, { method: "DELETE" });
          notice = `${t.actor} revoked.`;
          loaded.reload();
        }),
    });
  };

  /**
   * New token, as a compose dialog (spec: Auth, identity and actors): its name, which its changes
   * show as, then the library, access, directory, expiry and tools as small fields.
   */
  const tokenAction = useAction();
  function create(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = (k: string) => field(form, k);
    void tokenAction.run(async () => {
      const res = await api<Minted>("/api/v1/tokens", {
        method: "POST",
        body: JSON.stringify({
          library: f("library"),
          actor: f("actor"),
          scope: f("scope") === "read" ? "read" : "write",
          prefix: f("prefix") || null,
          expires: f("expires") || null,
          mcp_tiers: f("tiers") === "files" ? "files" : "all",
        }),
      });
      creating = false;
      minted = res;
      loaded.reload();
    });
  }

  /** The new token's secret, shown once, with the command that uses it. */
  const command = (m: Minted) =>
    `claude mcp add --transport http ${m.library} ${location.origin}/mcp --header "Authorization: Bearer ${m.secret}"`;
;
async () => {





 { svelteHTML.createElement("h1", {});  }
 { const $$_golaiDmrifnoC0C = __sveltets_2_ensureComponent(ConfirmDialog); new $$_golaiDmrifnoC0C({ target: __sveltets_2_any(), props: {  "asking":c,}});}
 { svelteHTML.createElement("p", {});            }
 { const $$_spetStcennoC0C = __sveltets_2_ensureComponent(ConnectSteps); new $$_spetStcennoC0C({ target: __sveltets_2_any(), props: {  "onNewToken":() => (creating = true),}});}
 { svelteHTML.createElement("h2", {});  }
if(notice){ { svelteHTML.createElement("div", { "class":`notice ok`,});notice; }}
if(action.error){ { svelteHTML.createElement("div", { "class":`notice`,});action.error; }}
 { const $$_sutatS0C = __sveltets_2_ensureComponent(Status); const $$_sutatS0 = new $$_sutatS0C({ target: __sveltets_2_any(), props: { "loaded":loaded.current,children:({ apps, tokens, libraries }) => { async ()/*Ωignore_positionΩ*/ => {
    const now = Date.now();
    const live = (t: TokenRow) => liveToken(t, now);
    
    const ordered = [...tokens.filter(live), ...tokens.filter((t) => !live(t))];
    if(apps.length === 0 && tokens.length === 0){
       { svelteHTML.createElement("p", { "class":`muted`,});   }
    }else{
       { svelteHTML.createElement("div", { "class":`table-wrap`,});
         { svelteHTML.createElement("table", { "class":`list`,});
           { svelteHTML.createElement("thead", {});
             { svelteHTML.createElement("tr", {});
               { svelteHTML.createElement("th", {});  }
               { svelteHTML.createElement("th", {});  }
               { svelteHTML.createElement("th", {});  }
               { svelteHTML.createElement("th", {});
                 { svelteHTML.createElement("span", { "class":`visually-hidden`,});  }
               }
             }
           }
           { svelteHTML.createElement("tbody", {});
               for(let a of __sveltets_2_ensureArray(apps)){`app ${a.id}`;
               { svelteHTML.createElement("tr", {});
                 { svelteHTML.createElement("td", {  "class":`name`,}); { svelteHTML.createElement("strong", {});a.app; } { svelteHTML.createElement("div", { "class":`small muted`,});   day(a.created); } }
                 { svelteHTML.createElement("td", { });a.libraries === "all"
                    ? "All libraries"
                    : a.libraries.length > 0
                      ? a.libraries.join(", ")
                      : "None (deleted)";if(a.prefix){ { svelteHTML.createElement("div", { "class":`small muted`,}); a.prefix;  }} }
                 { svelteHTML.createElement("td", { });a.access === "write" ? "Read and write" : "Read only";if(a.tiers === "files"){ { svelteHTML.createElement("div", { "class":`small muted`,});   }}if(a.create_libraries){ { svelteHTML.createElement("div", { "class":`small muted`,});   }} }
                 { svelteHTML.createElement("td", {});
                   { svelteHTML.createElement("button", {     "type":`button`,"disabled":action.busy,"onclick":() => revokeApp(a),});  }
                 }
               }
            }
               for(let t of __sveltets_2_ensureArray(ordered)){`token ${t.id}`;
               { svelteHTML.createElement("tr", {});
                 { svelteHTML.createElement("td", {  "class":`name`,}); { svelteHTML.createElement("strong", {});t.actor; } { svelteHTML.createElement("div", { "class":`small muted`,});
                      if(t.revoked){ { svelteHTML.createElement("span", { "class":`chip bad`,});  }} else if (!live(t)){ { svelteHTML.createElement("span", {  "class":`chip warn`,});  }} else if (t.expires){`expires ${day(t.expires)}`;}else{ }
                   } }
                 { svelteHTML.createElement("td", {});t.library;if(t.prefix){ { svelteHTML.createElement("div", { "class":`small muted`,}); t.prefix;  }} }
                 { svelteHTML.createElement("td", { });t.scope === "read" ? "Read only" : "Read and write";if(t.mcp_tiers === "files"){ { svelteHTML.createElement("div", { "class":`small muted`,});   }} }
                 { svelteHTML.createElement("td", {});
                  if(live(t)){
                     { svelteHTML.createElement("button", {     "type":`button`,"disabled":action.busy,"onclick":() => revokeToken(t),});  }
                  }
                 }
               }
            }
           }
         }
       }
    }
    const chosen = chosenLibrary(libraries, props.library, props.me);
     { const $$_golaiDesopmoC0C = __sveltets_2_ensureComponent(ComposeDialog); const $$_golaiDesopmoC0 = new $$_golaiDesopmoC0C({ target: __sveltets_2_any(), props: {               children:() => { return __sveltets_2_any(0); },"open":creating,"onClose":() => (creating = false),"title":`New token`,"action":`Create token`,"busy":tokenAction.busy || libraries.length === 0,"error":libraries.length === 0 ? "Create a library first." : tokenAction.error,"onSubmit":create,context:() => { async ()/*Ωignore_positionΩ*/ => {props.me ? `@${props.me.handle}` : "You";};return __sveltets_2_any(0)},fields:() => { async ()/*Ωignore_positionΩ*/ => {
         { svelteHTML.createElement("label", { "class":`compose-field`,});
           { svelteHTML.createElement("span", {});  }
           { svelteHTML.createElement("select", { "name":`library`,});
               for(let l of __sveltets_2_ensureArray(libraries)){l;
               { svelteHTML.createElement("option", {   "value":l,"selected":l === chosen,});l; }
            }
           }
         }
         { svelteHTML.createElement("label", { "class":`compose-field`,});
           { svelteHTML.createElement("span", {});  }
           { svelteHTML.createElement("select", { "name":`scope`,});
             { svelteHTML.createElement("option", {  "value":`write`,"selected":true,});   }
             { svelteHTML.createElement("option", { "value":`read`,});  }
           }
         }
         { svelteHTML.createElement("label", { "class":`compose-field`,});
           { svelteHTML.createElement("span", {});  }
           { svelteHTML.createElement("input", {      "type":`text`,"name":`prefix`,"placeholder":`whole library`,});}
         }
         { svelteHTML.createElement("label", { "class":`compose-field`,});
           { svelteHTML.createElement("span", {});  }
           { svelteHTML.createElement("input", {    "type":`date`,"name":`expires`,});}
         }
         { svelteHTML.createElement("label", { "class":`compose-field`,});
           { svelteHTML.createElement("span", {});  }
           { svelteHTML.createElement("select", { "name":`tiers`,});
             { svelteHTML.createElement("option", {  "value":`all`,"selected":true,});   }
             { svelteHTML.createElement("option", { "value":`files`,});   }
           }
         }
      };return __sveltets_2_any(0)},}});/*Ωignore_startΩ*/const {context, fields} = $$_golaiDesopmoC0.$$prop_def;/*Ωignore_endΩ*/
      
      
       { svelteHTML.createElement("input", {                    "class":`compose-title`,"name":`actor`,"type":`text`,"aria-label":`Name`,"aria-describedby":`token-name-hint`,"placeholder":`Name, like claude-code/laptop`,"required":true,"autocomplete":`off`,"spellcheck":`false`,...__sveltets_2_empty({"data-autofocus":`true`}),});}
       { svelteHTML.createElement("p", {   "id":`token-name-hint`,"class":`compose-hint`,});           }
     ComposeDialog}
  };return __sveltets_2_any(0)},}});/*Ωignore_startΩ*/const {children} = $$_sutatS0.$$prop_def;/*Ωignore_endΩ*/
  
 Status}
 { const $$_golaiD0C = __sveltets_2_ensureComponent(Dialog); new $$_golaiD0C({ target: __sveltets_2_any(), props: {      children:() => { return __sveltets_2_any(0); },"title":`Token created`,"open":minted !== null,"onClose":() => (minted = null),"wide":true,}});
  if(minted){
     { svelteHTML.createElement("p", {});
        { svelteHTML.createElement("strong", {});minted.actor; }   { svelteHTML.createElement("strong", {});minted.library; }     
     }
     { svelteHTML.createElement("p", {});
       { const $$_dleiFypoC2C = __sveltets_2_ensureComponent(CopyField); new $$_dleiFypoC2C({ target: __sveltets_2_any(), props: {      "value":minted.secret,"label":`the token`,"id":`token-secret`,}});}
     }
     { svelteHTML.createElement("p", { "class":`small muted`,});  }
     { svelteHTML.createElement("p", {});
       { const $$_dleiFypoC2C = __sveltets_2_ensureComponent(CopyField); new $$_dleiFypoC2C({ target: __sveltets_2_any(), props: {    "value":command(minted),"label":`the Claude Code command`,}});}
     }
     { svelteHTML.createElement("p", { "class":`actions`,});
       { svelteHTML.createElement("button", {     "type":`button`,"class":`primary`,"onclick":() => (minted = null),});  }
     }
  }
 Dialog}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Agents__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Agents__SvelteComponent_ = ReturnType<typeof Agents__SvelteComponent_>;
/*Ωignore_endΩ*/export default Agents__SvelteComponent_;