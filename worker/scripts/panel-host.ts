/**
 * A minimal MCP Apps host for the gate (TEMPRA-200): ext-apps' AppBridge, the reference host side
 * of SEP-1865, drives a panel in a sandboxed iframe (an opaque origin, like a host's) under the
 * CSP a host builds from the panel's `_meta.ui.csp`. The gate bundles it for the browser and
 * loads it into a blank page. It records what the panel says to the chat. Browser code, so it is
 * left out of the Worker's type program (test/tsconfig.json); the gate's run checks it.
 */
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";

interface Csp {
  connectDomains?: string[];
}

declare global {
  interface Window {
    startPanel(
      html: string,
      csp: Csp,
      args: Record<string, unknown>,
      result: Record<string, unknown>,
    ): Promise<void>;
    panelMessages: string[];
  }
}

window.panelMessages = [];

window.startPanel = async (html, csp, args, result) => {
  // What a host enforces: nothing but the panel itself and the domains it declares.
  const policy = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data:",
    `connect-src ${(csp.connectDomains ?? []).join(" ") || "'none'"}`,
  ].join("; ");
  const iframe = document.createElement("iframe");
  iframe.sandbox.add("allow-scripts");
  iframe.title = "Upload panel";
  iframe.width = "480";
  iframe.height = "360";
  iframe.srcdoc = html.replace(
    "<head>",
    `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`,
  );
  document.body.append(iframe);
  const win = iframe.contentWindow;
  if (!win) throw new Error("no iframe window");
  const bridge = new AppBridge(
    null,
    { name: "tempra gate host", version: "1.0.0" },
    { message: { text: {} }, openLinks: {} },
  );
  bridge.onmessage = async (params) => {
    const blocks = (params.content ?? []) as { type: string; text?: string }[];
    for (const c of blocks) if (c.type === "text" && c.text) window.panelMessages.push(c.text);
    return {};
  };
  bridge.onopenlink = async () => ({});
  bridge.oninitialized = () => {
    void bridge.sendToolInput({ arguments: args }).then(() => bridge.sendToolResult(result));
  };
  await bridge.connect(new PostMessageTransport(win, win));
};
