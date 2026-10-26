///<reference types="svelte" />
;
import { ApiError, api, field } from "../api";
import { useAction, useLoad } from "../load.svelte.ts";
import Moment from "../Moment.svelte";
import { navigate } from "../router";
import Status from "../Status.svelte";
import { enc, type Urls } from "../urls";
import { type HistoryRow, json, versionAt } from "./manage";

;type $$ComponentProps =  { urls: Urls; path: string; to?: number; title: string };function $$render() {

  
  
  
  
  
  
  

  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const loaded = useLoad(
    () => `restore ${props.urls.base} ${props.path} ${props.to}`,
    async () => {
      const { urls, path, to } = props;
      if (to === undefined) throw new ApiError(400, "bad_param", "No version was chosen.");
      const h = await api<{ events: HistoryRow[] }>(urls.api(`history/${enc(path)}`));
      // The version shown at `to`: the latest content event up to it, numbered from the first.
      const v = versionAt(h.events, to);
      if (!v) throw new ApiError(404, "not_found", "That version is not in this page's history.");
      return v;
    },
  );
  const action = useAction();

  function submit(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
    e.preventDefault();
    const note = field(e.currentTarget, "note");
    const { urls, path, to } = props;
    void action.run(async () => {
      await api(urls.api("revert"), json({ path, to_seq: to, note }));
      navigate(`${urls.pinned(undefined).file(path)}?done=restore`);
    });
  }
;
async () => {

 { const $$_sutatS0C = __sveltets_2_ensureComponent(Status); const $$_sutatS0 = new $$_sutatS0C({ target: __sveltets_2_any(), props: { "loaded":loaded.current,children:(v) => { async ()/*Ωignore_positionΩ*/ => {
     { svelteHTML.createElement("h1", {}); props.title;   v.n;  }
     { svelteHTML.createElement("p", {});
       v.n;    { const $$_tnemoM1C = __sveltets_2_ensureComponent(Moment); new $$_tnemoM1C({ target: __sveltets_2_any(), props: {  "ts":v.ts,}});}
       { svelteHTML.createElement("a", { "href":props.urls.pinned(props.to).file(props.path),});     }
     }
     { svelteHTML.createElement("div", { "class":`panel-box`,});
       { svelteHTML.createElement("p", {});             }
      if(action.error){ { svelteHTML.createElement("div", { "class":`notice`,});action.error; }}
       { svelteHTML.createElement("form", { "onsubmit":submit,});
         { svelteHTML.createElement("label", {});
            { svelteHTML.createElement("input", {      "type":`text`,"name":`note`,"defaultvalue":`Restore version ${v.n}`,});}
         }
         { svelteHTML.createElement("p", { "class":`actions`,});
           { svelteHTML.createElement("button", {     "class":`primary`,"type":`submit`,"disabled":action.busy,});  } { svelteHTML.createElement("a", {    "class":`button`,"href":props.urls.pinned(undefined).file(props.path),});  }
         }
       }
     }
  };return __sveltets_2_any(0)},}});/*Ωignore_startΩ*/const {children} = $$_sutatS0.$$prop_def;/*Ωignore_endΩ*/
  
 Status}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const RestorePage__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type RestorePage__SvelteComponent_ = ReturnType<typeof RestorePage__SvelteComponent_>;
/*Ωignore_endΩ*/export default RestorePage__SvelteComponent_;