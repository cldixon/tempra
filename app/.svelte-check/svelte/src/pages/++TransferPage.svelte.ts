///<reference types="svelte" />
;
import { api, field } from "../api";
import { useAction, useLoad } from "../load.svelte.ts";
import Status from "../Status.svelte";
import { plural } from "../ui";
import type { Urls } from "../urls";
import { exportLabel, type Nightly } from "./manage";

;type $$ComponentProps =  { urls: Urls };function $$render() {

  
  
  
  
  
  

  let { urls }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const loaded = useLoad(
    () => `transfer ${urls.base}`,
    async () => {
      const nightly = await api<{ exports: Nightly[] }>(urls.api("exports"));
      return { nightly: nightly.exports };
    },
  );
  const action = useAction();
  /** What the last action did: a line, or an import with a link to it in Activity. */
  let result = $state.raw<string | { files: number; name: string } | null>(null);

  function upload(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
    e.preventDefault();
    const form = e.currentTarget;
    const file = (form.elements.namedItem("bundle") as HTMLInputElement).files?.[0];
    const strip = Number(field(form, "strip")) || 0;
    const note = field(form, "note");
    void action.run(async () => {
      if (!file) throw new Error("Choose a .tar or .tar.gz file to import.");
      result = null;
      const res = await api<{ files: number; seq: number }>(
        urls.api("import", { strip, source: `upload:${file.name}` }),
        {
          method: "POST",
          body: file,
          headers: {
            "Content-Type": "application/x-tar",
            "X-Note": encodeURIComponent(note || `Import ${file.name}`),
          },
        },
      );
      result = { files: res.files, name: file.name };
      form.reset();
      loaded.reload();
    });
  }
  const exportNow = () =>
    action.run(async () => {
      const res = await api<{ export: string | null }>(urls.api("maintain"), { method: "POST" });
      result = res.export
        ? "Export saved. It is listed under Nightly exports."
        : "Nothing changed since the last export, so none was saved.";
      loaded.reload();
    });
;
async () => {

 { svelteHTML.createElement("h1", {});   }
if(result){
   { svelteHTML.createElement("div", { "class":`notice ok`,});
    if(typeof result === "string"){result;}else{ plural(result.files, "file");  result.name; 
         { svelteHTML.createElement("a", { "href":urls.activity({ view: "events" }),});    } }
   }
}
if(action.error){ { svelteHTML.createElement("div", { "class":`notice`,});action.error; }}
 { svelteHTML.createElement("div", { "class":`panel-box`,});
   { svelteHTML.createElement("h2", {});  }
   { svelteHTML.createElement("p", {});            }
  
   { svelteHTML.createElement("a", {   "class":`button primary`,"href":urls.exportTar(),});  }
 }
 { svelteHTML.createElement("div", { "class":`panel-box`,});
   { svelteHTML.createElement("h2", {});  }
   { svelteHTML.createElement("p", {});           }
   { svelteHTML.createElement("form", { "onsubmit":upload,});
     { svelteHTML.createElement("p", {});
       { svelteHTML.createElement("input", {          "type":`file`,"name":`bundle`,"aria-label":`Bundle`,"accept":`.tar,.tgz,.gz,application/x-tar,application/gzip`,"required":true,});}
     }
     { svelteHTML.createElement("p", {});
       { svelteHTML.createElement("label", { "class":`small`,});
           
         { svelteHTML.createElement("input", {          "type":`number`,"name":`strip`,"min":0,"max":10,"defaultvalue":0,});}
       }
     }
     { svelteHTML.createElement("p", {});
       { svelteHTML.createElement("input", {        "type":`text`,"name":`note`,"aria-label":`Note`,"placeholder":`Note (optional)`,});}
     }
     { svelteHTML.createElement("button", {     "class":`primary`,"type":`submit`,"disabled":action.busy,});  }
   }
 }
 { const $$_sutatS0C = __sveltets_2_ensureComponent(Status); const $$_sutatS0 = new $$_sutatS0C({ target: __sveltets_2_any(), props: { "loaded":loaded.current,children:({ nightly }) => { async ()/*Ωignore_positionΩ*/ => {
     { svelteHTML.createElement("div", { "class":`panel-box`,});
       { svelteHTML.createElement("h2", {});  }
      if(nightly.length === 0){
         { svelteHTML.createElement("p", {});  }
      }else{
         { svelteHTML.createElement("div", { "class":`table-wrap`,});
           { svelteHTML.createElement("table", { "class":`list`,});
             { svelteHTML.createElement("thead", { "class":`visually-hidden`,});
               { svelteHTML.createElement("tr", {});
                 { svelteHTML.createElement("th", {});  }
                 { svelteHTML.createElement("th", {});  }
                 { svelteHTML.createElement("th", {});  }
               }
             }
             { svelteHTML.createElement("tbody", {});
                 for(let n of __sveltets_2_ensureArray(nightly)){n.date;
                 { svelteHTML.createElement("tr", {});
                   { svelteHTML.createElement("td", {});
                     { svelteHTML.createElement("strong", {});exportLabel(n.date); }
                   }
                   { svelteHTML.createElement("td", { "class":`muted small`,});n.files !== null ? plural(n.files, "file") : ""; }
                   { svelteHTML.createElement("td", {});
                     { svelteHTML.createElement("a", { "href":urls.nightly(n.date, "bundle.tar"),});  } 
                     { svelteHTML.createElement("a", { "href":urls.nightly(n.date, "ledger.jsonl"),});  }
                   }
                 }
              }
             }
           }
         }
      }
       { svelteHTML.createElement("button", {     "type":`button`,"disabled":action.busy,"onclick":() => void exportNow(),});  }
     }
  };return __sveltets_2_any(0)},}});/*Ωignore_startΩ*/const {children} = $$_sutatS0.$$prop_def;/*Ωignore_endΩ*/
  
 Status}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const TransferPage__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type TransferPage__SvelteComponent_ = ReturnType<typeof TransferPage__SvelteComponent_>;
/*Ωignore_endΩ*/export default TransferPage__SvelteComponent_;