/**
 * The upload link's page (TEMPRA-196; tempra-dev: app/media, Upload link): a signed-in owner or
 * write member sends the file an agent prepared an upload for, and the write stays the agent's.
 */
import { describe, expect, setSystemTime, test } from "bun:test";
import { setup } from "./harness";
import { makePng } from "./images";

const PNG = makePng(4, 3);
const hex = (b: Uint8Array) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
type S = ReturnType<typeof setup>;
type Client = S["app"];

/** prepare_upload's REST twin, as the writer token's agent. */
async function prepare(s: S, body: Record<string, unknown>) {
  const r = await s.req("/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(r.status).toBe(201);
  const p = (await r.json()) as { url: string; upload_page: string };
  return { ...p, page: new URL(p.upload_page).pathname };
}

/** The page's form post, as a browser on this site sends it. */
function send(
  client: Client,
  page: string,
  bytes: Uint8Array | null,
  opts: { name?: string; origin?: string } = {},
) {
  const form = new FormData();
  // Its type is the name's, as browsers (and Bun's parser) take it.
  if (bytes) form.set("file", new File([bytes], opts.name ?? "photo.png"));
  return client.request(page, {
    method: "POST",
    body: form,
    headers: { Origin: opts.origin ?? "http://localhost" },
  });
}

describe("the upload link's page (TEMPRA-196)", () => {
  test("prepare returns a page with the same token; the page shows the prepared upload", async () => {
    const s = setup();
    const p = await prepare(s, {
      path: "figures/ladle.png",
      description: "Molten steel in a ladle.",
      size: PNG.length,
    });
    const token = p.url.split("/").pop();
    expect(p.page).toBe(`/owner/demo/-/upload/${token}`);
    const r = await s.app.request(p.page);
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const html = await r.text();
    expect(html).not.toContain("<script");
    expect(html).toContain("<code>figures/ladle.png</code>");
    expect(html).toContain("Molten steel in a ladle.");
    expect(html).toContain('enctype="multipart/form-data"');
    expect(html).toContain('accept="image/png"');
    expect(html).toMatch(/for 60 more minutes/);
  });

  test("the person's file is attached as the agent's write, supplied by them", async () => {
    const s = setup();
    const p = await prepare(s, {
      path: "figures/ladle.png",
      note: "The owner's photo.",
      credit: "Photo supplied by @owner",
      sha256: hex(PNG),
    });
    const r = await send(s.app, p.page, PNG);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("<h1>Uploaded</h1>");
    expect(html).toContain('href="/owner/demo/figures/ladle.png"');

    const back = await s.req("/files/figures/ladle.png");
    expect(new Uint8Array(await back.arrayBuffer())).toEqual(PNG);
    const facts = (await (
      await s.req("/files/figures/ladle.png", { headers: { Accept: "application/json" } })
    ).json()) as Record<string, unknown>;
    expect(facts).toMatchObject({ supplied_by: "owner", credit: "Photo supplied by @owner" });
    const reqs = (await (await s.req("/requests")).json()) as {
      requests: { actor: string; note: string | null }[];
    };
    expect(reqs.requests[0]).toMatchObject({
      actor: "claude-code/test",
      note: "The owner's photo.",
    });

    // One upload per link, from the page or curl alike.
    const again = await send(s.app, p.page, PNG);
    expect(again.status).toBe(410);
    expect(await again.text()).toContain("Ask the agent for a new one");
    expect((await s.anon.request(p.url, { method: "PUT", body: PNG })).status).toBe(403);
  });

  test("a refusal shows on the page with the form, and leaves the link good", async () => {
    const s = setup();
    const p = await prepare(s, { path: "a.png", size: PNG.length });
    const cut = await send(s.app, p.page, PNG.slice(0, PNG.length - 20));
    expect(cut.status).toBe(400);
    const html = await cut.text();
    expect(html).toContain(`This is not the file the agent described (${PNG.length} bytes).`);
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('name="file"');
    const type = await send(s.app, p.page, PNG, { name: "photo.jpg" });
    expect(type.status).toBe(400);
    expect(await type.text()).toContain(
      "The agent asked for a file of type image/png, and this one is image/jpeg.",
    );
    const none = await send(s.app, p.page, null);
    expect(none.status).toBe(400);
    expect(await none.text()).toContain("Choose a file to upload.");
    expect((await s.req("/files/a.png")).status).toBe(404);
    expect((await send(s.app, p.page, PNG)).status).toBe(200);
  });

  test("signed out, it asks to sign in and comes back; a post from elsewhere lands nothing", async () => {
    const s = setup();
    const p = await prepare(s, { path: "a.png" });
    const r = await s.anon.request(p.page);
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe(`/sign-in?next=${encodeURIComponent(p.page)}`);
    expect((await send(s.anon, p.page, PNG)).status).toBe(401);
    const cross = await send(s.app, p.page, PNG, { origin: "https://evil.example" });
    expect(cross.status).toBe(403);
    expect((await s.req("/files/a.png")).status).toBe(404);
  });

  test("a read member is told they cannot add files; a stranger gets the library's 404", async () => {
    const s = setup();
    const p = await prepare(s, { path: "a.png" });
    const reader = await s.stranger("reader@example.com");
    await s.accounts.share("lib-1", reader.user.id, "read", "user_1");
    const look = await reader.app.request(p.page);
    expect(look.status).toBe(403);
    expect(await look.text()).toContain("not add files");
    expect((await send(reader.app, p.page, PNG)).status).toBe(403);
    const stranger = await s.stranger();
    expect((await stranger.app.request(p.page)).status).toBe(404);
    expect((await send(stranger.app, p.page, PNG)).status).toBe(404);
    expect((await s.req("/files/a.png")).status).toBe(404);

    // A write member may send it; the write stays the agent's, supplied by the member.
    const writer = await s.stranger("writer@example.com");
    await s.accounts.share("lib-1", writer.user.id, "write", "user_1");
    expect((await send(writer.app, p.page, PNG)).status).toBe(200);
    const facts = (await (
      await s.req("/files/a.png", { headers: { Accept: "application/json" } })
    ).json()) as { supplied_by: string };
    expect(facts.supplied_by).toBe(writer.user.handle);
  });

  test("a link for another library, or past its hour, is expired", async () => {
    const s = setup();
    const p = await prepare(s, { path: "a.png" });
    const other = await s.stranger();
    const foreign = p.page.replace("/owner/demo/", `/${other.user.handle}/demo/`);
    expect((await other.app.request(foreign)).status).toBe(410);
    setSystemTime(new Date(Date.now() + 61 * 60_000));
    try {
      expect((await s.app.request(p.page)).status).toBe(410);
    } finally {
      setSystemTime();
    }
  });
});
