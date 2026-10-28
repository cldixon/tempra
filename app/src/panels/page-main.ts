/**
 * The page panel's entry (tempra-dev: app/page-panel): connects to the host through ext-apps'
 * `App`, follows the host's light or dark, and mounts PagePanel.svelte with the page the `show`
 * result brings. app/build.ts bundles it into the panel's one document.
 */
import { App, applyDocumentTheme, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { mount } from "svelte";
import PagePanel from "./PagePanel.svelte";
import { type PageHost, type PagePayload, pageFrom } from "./page";

const app = new App({ name: "Tempra page", version: "1.0.0" }, {}, { autoResize: true });
const root = document.getElementById("panel") as HTMLElement;

const listeners = new Set<(p: PagePayload | null) => void>();
let last: PagePayload | null | undefined;

const theme = (ctx: McpUiHostContext | undefined) => {
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
};

const host: PageHost = {
  subscribe(on) {
    listeners.add(on);
    if (last !== undefined) on(last);
    return () => {
      listeners.delete(on);
    };
  },
  openLink: async (url) => {
    if (!app.getHostCapabilities()?.openLinks) return false;
    const r = await app.openLink({ url }).catch(() => ({ isError: true }));
    return !r.isError;
  },
};

app.ontoolresult = (result) => {
  last = pageFrom(result);
  for (const l of listeners) l(last);
};
app.onhostcontextchanged = () => theme(app.getHostContext());
mount(PagePanel, { target: root, props: { host } });
await app.connect();
theme(app.getHostContext());
