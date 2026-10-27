/**
 * The upload panel's entry (TEMPRA-200): connects to the host through ext-apps' `App` (the
 * reference client of SEP-1865), takes the host's theme, and shows the prepared upload from the
 * tool's result. app/build.ts bundles it into the panel's one HTML document.
 */
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import { mountUploadPanel, preparedFrom } from "./upload";

const app = new App({ name: "Tempra upload", version: "1.0.0" }, {}, { autoResize: true });
const root = document.getElementById("panel") as HTMLElement;

const theme = (ctx: McpUiHostContext | undefined) => {
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx?.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
};

const panel = mountUploadPanel(root, {
  canMessage: () => !!app.getHostCapabilities()?.message,
  sendMessage: async (text) => {
    const r = await app.sendMessage({ role: "user", content: [{ type: "text", text }] });
    return !r.isError;
  },
  openLink: async (url) => {
    if (!app.getHostCapabilities()?.openLinks) return false;
    const r = await app.openLink({ url }).catch(() => ({ isError: true }));
    return !r.isError;
  },
});

app.ontoolresult = (result) => panel.show(preparedFrom(result));
app.onhostcontextchanged = () => theme(app.getHostContext());
await app.connect();
theme(app.getHostContext());
