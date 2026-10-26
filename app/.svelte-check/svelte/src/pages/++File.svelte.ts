///<reference types="svelte" />
;
import { useThreads } from "../comments/data.svelte.ts";
import ConceptPage from "../concept/ConceptPage.svelte";
import { type FileData, fileKey, isConceptPath, loadFile } from "../concept/data";
import { useLiveFile } from "../concept/live.svelte.ts";
import LiveNotice from "../concept/LiveNotice.svelte";
import { useLoad } from "../load.svelte.ts";
import PageColumn from "../PageColumn.svelte";
import { type Compare, navigate } from "../router";
import Status from "../Status.svelte";
import { useScrollToHash } from "../ui.svelte.ts";
import { baseName, dirOf, type Urls } from "../urls";
import Attachment from "./Attachment.svelte";
import Derived from "./Derived.svelte";
import { DONE } from "./file";
import NotFound from "./NotFound.svelte";

;type $$ComponentProps =  {
    urls: Urls;
    path: string;
    done: string | null;
    actor: string;
    compare: Compare | null;
  };function $$render() {

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  

  /**
   * A file's page: a concept in its own layout (concept/ConceptPage), an attachment (board 28), or
   * a synthesized file (log.md) in a page column; Not found (board 32) for a path with nothing
   * there. A folder's index.md is the folder's page.
   */
  let props:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();
  const loaded = useLoad(
    () => fileKey(props.urls, props.path),
    () => loadFile(props.urls, props.path),
  );
  // A concept's comment threads load beside it, and reload on their own (comments are not
  // content: a new comment never redraws the body).
  const threads = useThreads(
    () => props.urls,
    () => (isConceptPath(props.path) ? props.path : null),
  );
  // index.md is the directory's own page.
  $effect(() => {
    if (baseName(props.path) === "index.md") {
      navigate(props.urls.tree(dirOf(props.path)), { replace: true });
    }
  });
  useScrollToHash(() => loaded.state === "ready");
  const notice = $derived(props.done ? DONE[props.done]?.(props.actor) : undefined);
  const shown = $derived<FileData | null>(loaded.data ?? null);
  const live = useLiveFile(
    () => props.urls,
    () => shown,
    () => props.actor,
    () => loaded.reload(),
    () => threads.reload(),
  );
  const concept = $derived(shown?.extra);
  const attachment = $derived(shown?.file.kind === "attachment" ? shown.file : null);
;
async () => {

if(shown && concept){
   { const $$_egaPtpecnoC0C = __sveltets_2_ensureComponent(ConceptPage); new $$_egaPtpecnoC0C({ target: __sveltets_2_any(), props: {                    "urls":props.urls,"data":concept,"head":shown.head,"compare":props.compare,"threads":threads.data?.threads ?? null,"threadsError":threads.error?.message ?? null,notice,"live":live.current,"onCommented":() => threads.reload(),"onVerified":() => loaded.reload(),}});}
} else if (loaded.error?.status === 404){
   { const $$_dnuoFtoN0C = __sveltets_2_ensureComponent(NotFound); new $$_dnuoFtoN0C({ target: __sveltets_2_any(), props: {    "urls":props.urls,"path":props.path,}});}
}else{
   { const $$_nmuloCegaP0C = __sveltets_2_ensureComponent(PageColumn); new $$_nmuloCegaP0C({ target: __sveltets_2_any(), props: {  children:() => { return __sveltets_2_any(0); },"wide":attachment !== null,}});if(notice){ { svelteHTML.createElement("div", { "class":`notice`,});notice; }}if(live.current){ { const $$_ecitoNeviL1C = __sveltets_2_ensureComponent(LiveNotice); new $$_ecitoNeviL1C({ target: __sveltets_2_any(), props: {     "urls":props.urls,"live":live.current,}});}} { const $$_sutatS1C = __sveltets_2_ensureComponent(Status); const $$_sutatS1 = new $$_sutatS1C({ target: __sveltets_2_any(), props: {  "loaded":loaded.current,children:(d: FileData) => { async ()/*Ωignore_positionΩ*/ => {if(d.file.kind === "attachment"){ { const $$_tnemhcattA0C = __sveltets_2_ensureComponent(Attachment); new $$_tnemhcattA0C({ target: __sveltets_2_any(), props: {       "urls":props.urls,"file":d.file,"head":d.head,}});}} else if (d.file.kind === "derived"){ { const $$_devireD0C = __sveltets_2_ensureComponent(Derived); new $$_devireD0C({ target: __sveltets_2_any(), props: {      "urls":props.urls,"file":d.file,"head":d.head,}});}}};return __sveltets_2_any(0)},}});/*Ωignore_startΩ*/const {children} = $$_sutatS1.$$prop_def;/*Ωignore_endΩ*/  Status}  PageColumn}
}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const File__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type File__SvelteComponent_ = ReturnType<typeof File__SvelteComponent_>;
/*Ωignore_endΩ*/export default File__SvelteComponent_;