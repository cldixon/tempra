///<reference types="svelte" />
;
import { byPerson, type LedgerRequest, whoWorksHere } from "../activity";
import { useActors } from "../agents.svelte.ts";
import { api } from "../api";
import { useFrame } from "../frame.svelte.ts";
import { useFeed, useTrailing } from "../live.svelte.ts";
import { useLoad } from "../load.svelte.ts";
import PageColumn from "../PageColumn.svelte";
import { libraryLabel } from "../role";
import { useLibraries, useRole } from "../role.svelte.ts";
import Status from "../Status.svelte";
import { plural } from "../ui";
import { useMe, useNow, useTitle } from "../ui.svelte.ts";
import type { Urls } from "../urls";
import EmptyLibrary from "./EmptyLibrary.svelte";
import { READ, recentlyChanged } from "./home";
import RecentlyChanged from "./RecentlyChanged.svelte";

;type $$ComponentProps =  { urls: Urls };function $$render() {

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  

  /**
   * The library's home (take 4, TEMPRA-117, TEMPRA-121; tempra-dev: app/home): its title and
   * description, one quiet line (who works here, the page count, the guide), and the pages changed
   * most recently. No sections: the tree beside it lists the folders (TEMPRA-138); no housekeeping,
   * which is the agents' (TEMPRA-144); no notifications, which are the Inbox's, and no "since you
   * last looked", which is Activity's to show when asked (TEMPRA-173). An empty library shows how to
   * connect an agent instead (to those who can). Each part loads on its own, so one that fails
   * leaves the rest (H-7).
   */
  let { urls }:/*Ωignore_startΩ*/$$ComponentProps/*Ωignore_endΩ*/ = $props();

  const libs = useLibraries();
  const lib = $derived(
    libs.data?.libraries.find((l) => l.owner === urls.owner && l.slug === urls.slug),
  );
  const name = $derived(libraryLabel(lib ?? urls));
  useTitle(() => name);
  const me = useMe();
  const role = useRole(() => urls);
  const actors = useActors(
    () => urls,
    () => me.current?.actor ?? null,
  );
  const frame = useFrame();
  const now = useNow();
  const loaded = useLoad(
    () => `home ${urls.base}`,
    async () => {
      const [summary, page] = await Promise.all([
        api<{ seq: number; concepts: number }>(urls.api("summary")),
        api<{ requests: LedgerRequest[] }>(urls.api("requests", { limit: READ })),
      ]);
      return {
        head: summary.seq,
        concepts: summary.concepts,
        requests: page.requests,
        latest: page.requests.find((r) => !byPerson(r)) ?? null,
        // No agent among the newest requests, and no older ones: no agent has written here yet.
        noAgentYet: page.requests.length < READ && !page.requests.some((r) => !byPerson(r)),
      };
    },
  );
  // Who works here: only the header's quiet line needs it, so a failure drops only that line.
  const members = useLoad(
    () => `home people ${urls.base}`,
    () =>
      api<{ owner: string; members: { handle: string }[] }>(urls.api("members")).then((m) => [
        m.owner,
        ...m.members.map((x) => x.handle),
      ]),
  );
  const reload = useTrailing(() => loaded.reload(), 1500);
  useFeed(
    () => urls,
    () => loaded.data?.head ?? null,
    reload,
    reload,
  );

  // The tree's outline when it has arrived (it follows the feed), else the summary (`empty`).
  const files = $derived(frame.index);
  const handle = $derived(me.current?.handle ?? null);
  const people = $derived(members.data ?? null);
  const you = $derived(handle !== null && (people?.includes(handle) ?? false));
  const agents = $derived(actors.contributors.filter((c) => c.agent).length);
  const guide = $derived(files?.some((f) => f.path === "guide.md" && f.kind === "concept"));
  const who = $derived(
    people === null ? null : whoWorksHere(you, people.length - (you ? 1 : 0), agents),
  );
  const canWrite = $derived(role.current === "owner" || role.current === "write");
;
async () => {

 { const $$_nmuloCegaP0C = __sveltets_2_ensureComponent(PageColumn); new $$_nmuloCegaP0C({ target: __sveltets_2_any(), props: {children:() => { return __sveltets_2_any(0); },}});
   { const $$_sutatS1C = __sveltets_2_ensureComponent(Status); const $$_sutatS1 = new $$_sutatS1C({ target: __sveltets_2_any(), props: { "loaded":loaded.current,children:(home) => { async ()/*Ωignore_positionΩ*/ => {
      const empty = files === null ? home.concepts === 0 : files.length === 0;
      const meta = [who, plural(home.concepts, "page")].filter((p): p is string => p !== null);
       { svelteHTML.createElement("header", { "class":`view-head home-head`,});
         { svelteHTML.createElement("div", { "class":`view-head-main`,});
           { svelteHTML.createElement("h1", { "class":`view-title`,});name; }
          if(lib?.description){
             { svelteHTML.createElement("p", { "class":`view-lede`,});lib.description; }
          }
          if(!empty && (meta.length > 0 || guide)){
             { svelteHTML.createElement("p", { "class":`view-meta home-who`,});meta.join(" · ");if(guide){meta.length > 0 ? " · " : ""; { svelteHTML.createElement("a", { "href":urls.file("guide.md"),});    }} }
          }
         }
       }
      if(empty){
         { const $$_yrarbiLytpmE0C = __sveltets_2_ensureComponent(EmptyLibrary); new $$_yrarbiLytpmE0C({ target: __sveltets_2_any(), props: {          urls,"access":role.current,"latest":home.latest,"who":home.latest ? actors.view(home.latest.actor, home.latest.by) : null,"now":now.current,}});}
      }else{
        
        if(home.noAgentYet && canWrite){
           { const $$_yrarbiLytpmE0C = __sveltets_2_ensureComponent(EmptyLibrary); new $$_yrarbiLytpmE0C({ target: __sveltets_2_any(), props: {            urls,"access":role.current,"latest":null,"who":null,"now":now.current,"heading":`Connect an agent`,}});}
        }
        if(files !== null){
           { const $$_degnahCyltneceR0C = __sveltets_2_ensureComponent(RecentlyChanged); new $$_degnahCyltneceR0C({ target: __sveltets_2_any(), props: {      urls,"changed":recentlyChanged(home.requests, files),"view":(a, by) => actors.view(a, by),}});}
        }
      }
    };return __sveltets_2_any(0)},}});/*Ωignore_startΩ*/const {children} = $$_sutatS1.$$prop_def;/*Ωignore_endΩ*/
    
   Status}
 PageColumn}
};
return { props: {} as any as $$ComponentProps, exports: {}, bindings: __sveltets_$$bindings(''), slots: {}, events: {} }}
const Home__SvelteComponent_ = __sveltets_2_fn_component($$render());
/*Ωignore_startΩ*/type Home__SvelteComponent_ = ReturnType<typeof Home__SvelteComponent_>;
/*Ωignore_endΩ*/export default Home__SvelteComponent_;