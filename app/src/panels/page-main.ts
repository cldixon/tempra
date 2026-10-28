/**
 * The page panel's entry (tempra-dev: app/page-panel): connects to the host through ext-apps'
 * `App`, follows the host's theme, and mounts PagePanel.svelte over a `PageHost` that turns its
 * actions into host requests: `page_act` and `show` as server tool calls, the chat's message, the
 * model's context, links and full screen. app/build.ts bundles it into the panel's one document.
 */
import { App, applyDocumentTheme, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { mount } from "svelte";
import PagePanel from "./PagePanel.svelte";
import { type PageHost, type PagePayload, pageFrom } from "./page";

const app = new App({ name: "Tempra page", version: "1.0.0" }, {}, { autoResize: true });
const root = document.getElementById("panel") as HTMLElement;

type Listener = Parameters<PageHost["subscribe"]>[0];
const listeners = new Set<Listener>();
let last: PagePayload | null | undefined;
let mode: "inline" | "fullscreen" | "pip" = "inline";

const theme = (ctx: McpUiHostContext | undefined) => {
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
  if (ctx?.displayMode && ctx.displayMode !== mode) {
    mode = ctx.displayMode;
    for (const l of listeners) l.mode(mode);
  }
};

/** A tool call's page, or its error as an Error people can read. */
async function call(name: string, args: Record<string, unknown>): Promise<PagePayload> {
  const r = (await app.callServerTool({ name, arguments: args })) as CallToolResult;
  const page = pageFrom(r);
  if (r.isError || !page) {
    const said = (r.content ?? []).flatMap((c) => (c.type === "text" ? [c.text] : [])).join(" ");
    throw new Error(said || "Tempra did not answer. Try again.");
  }
  return page;
}

const host: PageHost = {
  subscribe(on) {
    listeners.add(on);
    if (last !== undefined) on.page(last);
    on.mode(mode);
    return () => {
      listeners.delete(on);
    };
  },
  canCall: () => !!app.getHostCapabilities()?.serverTools,
  act: (args) => call("page_act", { ...args }),
  open: (path, library) => call("show", { path, library }),
  canAsk: () => !!app.getHostCapabilities()?.message,
  ask: async (text) => {
    const r = await app
      .sendMessage({ role: "user", content: [{ type: "text", text }] })
      .catch(() => ({ isError: true }));
    return !r.isError;
  },
  tell: async (text) => {
    if (!app.getHostCapabilities()?.updateModelContext) return;
    await app.updateModelContext({ content: [{ type: "text", text }] }).catch(() => {});
  },
  openLink: async (url) => {
    if (!app.getHostCapabilities()?.openLinks) return false;
    const r = await app.openLink({ url }).catch(() => ({ isError: true }));
    return !r.isError;
  },
  canFullscreen: () => app.getHostContext()?.availableDisplayModes?.includes("fullscreen") ?? false,
  fullscreen: async () => {
    const r = await app.requestDisplayMode({ mode: "fullscreen" }).catch(() => null);
    return r?.mode === "fullscreen";
  },
};

app.ontoolresult = (result) => {
  last = pageFrom(result);
  for (const l of listeners) l.page(last);
};
app.onhostcontextchanged = () => theme(app.getHostContext());
mount(PagePanel, { target: root, props: { host } });
await app.connect();
theme(app.getHostContext());
