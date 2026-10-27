/**
 * The upload panel (TEMPRA-200; tempra-dev app/media, Upload panel), drawn with a fake host and
 * a fake PUT: what it shows, what it sends where, and what it tells the chat.
 */
import { describe, expect, test } from "bun:test";
import {
  mountUploadPanel,
  type PanelHost,
  type PreparedUpload,
  type Put,
  preparedFrom,
} from "./src/panels/upload";
import { settle } from "./test/dom";

const UPLOAD: PreparedUpload = {
  url: "https://pr-1.tempra.dev/ul/lib-1/tok",
  page: "https://pr-1.tempra.dev/ann/notes/-/upload/tok",
  path: "photos/ladle.png",
  library: "notes",
  media: "image/png",
  size: 349_140,
  description: "Molten steel in a ladle.",
  expires: "2026-10-26T22:00:00.000Z",
};

function host(opts: { message?: boolean; refuse?: boolean; links?: boolean } = {}) {
  const said: string[] = [];
  const opened: string[] = [];
  const h: PanelHost = {
    canMessage: () => opts.message ?? true,
    sendMessage: async (text) => {
      said.push(text);
      return !opts.refuse;
    },
    openLink: async (url) => {
      opened.push(url);
      return opts.links ?? true;
    },
  };
  return { h, said, opened };
}

/** Chooses a file in the panel's input, as a person does. */
function choose(root: HTMLElement, file: File) {
  const input = root.querySelector("input[type=file]") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
}

const photo = () => new File([new Uint8Array(2048)], "photo.png", { type: "image/png" });

describe("the upload panel", () => {
  test("waits, then shows the prepared upload and what it expects", () => {
    const root = document.createElement("main");
    const panel = mountUploadPanel(root, host().h);
    expect(root.textContent).toContain("Waiting for the upload");
    panel.show(UPLOAD);
    expect(root.querySelector("h1")?.textContent).toBe("Upload a file");
    expect(root.textContent).toContain("To notes, as photos/ladle.png.");
    expect(root.textContent).toContain("Molten steel in a ladle.");
    expect(root.textContent).toContain("Expects image/png, 341 KB.");
    expect(root.textContent).toContain("If it came from the chat, choose it again here.");
    const input = root.querySelector("input[type=file]") as HTMLInputElement;
    expect(input.accept).toBe("image/png");
    expect(input.closest("label")?.className).toBe("drop");
  });

  test("a chosen file goes to the /ul/ URL from the chat, and the chat is told", async () => {
    const root = document.createElement("main");
    const { h, said } = host();
    const sent: { url: string; name: string }[] = [];
    const put: Put = async (url, file, progress) => {
      sent.push({ url, name: file.name });
      progress(0.5);
      return { status: 200, body: { path: UPLOAD.path, hash: "abc" } };
    };
    mountUploadPanel(root, h, put).show(UPLOAD);
    choose(root, photo());
    await settle();
    expect(sent).toEqual([{ url: `${UPLOAD.url}?via=chat`, name: "photo.png" }]);
    expect(root.querySelector(".status")?.textContent).toBe(
      "Uploaded photo.png (2 KB) to photos/ladle.png.",
    );
    expect(said).toEqual([
      "I uploaded photo.png (2 KB) to photos/ladle.png through the upload panel.",
    ]);
    expect((root.querySelector(".drop") as HTMLElement).hidden).toBe(true);
  });

  test("without messages to the chat, it asks the person to tell the agent", async () => {
    for (const opts of [{ message: false }, { refuse: true }]) {
      const root = document.createElement("main");
      const put: Put = async () => ({ status: 200, body: {} });
      mountUploadPanel(root, host(opts).h, put).show(UPLOAD);
      choose(root, photo());
      await settle();
      expect(root.querySelector(".status")?.textContent).toContain("Tell the agent it is there.");
    }
  });

  test("a refusal is shown and the person may try again; a spent link ends it", async () => {
    const root = document.createElement("main");
    const answers = [
      { status: 400, body: { code: "bad_image", message: "photo.png: the PNG is truncated." } },
      { status: 403, body: { code: "upload_used", message: "used" } },
    ];
    const put: Put = async () => answers.shift() ?? { status: 500, body: null };
    mountUploadPanel(root, host().h, put).show(UPLOAD);
    choose(root, photo());
    await settle();
    const status = () => root.querySelector(".status")?.textContent;
    expect(status()).toBe("Not uploaded: photo.png: the PNG is truncated.");
    const input = root.querySelector("input[type=file]") as HTMLInputElement;
    expect(input.disabled).toBe(false);
    choose(root, photo());
    await settle();
    expect(status()).toContain("expired or was already used. Ask the agent for a new one.");
  });

  test("the upload page instead, through the host, or as a link to copy", async () => {
    const root = document.createElement("main");
    const { h, opened } = host({ links: false });
    mountUploadPanel(root, h).show(UPLOAD);
    const button = [...root.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("upload page"),
    );
    button?.click();
    await settle();
    expect(opened).toEqual([UPLOAD.page as string]);
    expect(root.querySelector(".status")?.textContent).toContain(UPLOAD.page as string);
  });

  test("the tool result's structuredContent, or nothing usable", () => {
    expect(preparedFrom({ structuredContent: { upload: UPLOAD } })).toEqual(UPLOAD);
    expect(preparedFrom({ structuredContent: { upload: { path: "x" } } })).toBeNull();
    expect(preparedFrom({})).toBeNull();
    const root = document.createElement("main");
    mountUploadPanel(root, host().h).show(null);
    expect(root.textContent).toContain("Ask the agent to prepare it again.");
  });
});
