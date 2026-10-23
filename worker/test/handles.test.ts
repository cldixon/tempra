import { describe, expect, test } from "bun:test";
import { checkHandle, handleFromEmail, isReservedHandle } from "../src/handles";
import { legacyUrl } from "../src/ui/routes";
import { setup } from "./harness";

describe("handles guard the namespace (v2 spec: Handles and the namespace)", () => {
  test("syntax: 2 to 39, lowercase, single separators between letters and digits", () => {
    expect(checkHandle(" Ada_Lovelace ")).toBe("ada_lovelace");
    for (const bad of ["a", "-ada", "ada-", "ada--l", "ada_-l", "adа", "a".repeat(40), "a b"]) {
      expect(() => checkHandle(bad)).toThrow();
    }
  });

  test("routes, roles and the brand are reserved; the operator may still assign them", () => {
    for (const h of ["api", "account", "new", "support", "billing", "admin", "tempra", "okf"]) {
      expect(isReservedHandle(h)).toBe(true);
    }
    for (const h of ["my-tempra", "tempra-help", "admin2", "support-team", "official_x"]) {
      expect(isReservedHandle(h)).toBe(true);
    }
    expect(isReservedHandle("ada")).toBe(false);
    expect(() => checkHandle("support")).toThrow("reserved");
    expect(checkHandle("tempra", { reserved: "allow" })).toBe("tempra");
  });

  test("handles made from an email avoid the reserved names", () => {
    expect(handleFromEmail("cl_dixon@example.com")).toBe("cl_dixon");
    expect(handleFromEmail("a.b..c@example.com")).toBe("a-b-c");
    expect(handleFromEmail("support@example.com")).toBe("u-support");
    expect(handleFromEmail("tempra@example.com")).toBe("member");
    expect(handleFromEmail("x@example.com")).toBe("u-x");
  });

  test("a released handle is held for its account: no one else takes it, its owner may", async () => {
    const s = setup();
    await s.accounts.setHandle("user_1", "renamed");
    const stranger = await s.stranger();
    await expect(s.accounts.setHandle(stranger.user.id, "owner")).rejects.toThrow("taken");
    expect(await s.accounts.heldHandle("owner")).toBe("renamed");
    // Sign-up does not hand it out either.
    expect((await s.accounts.user("owner@elsewhere.example")).handle).toBe("owner-2");
    // Its own account can take it back, which ends the hold.
    expect((await s.accounts.setHandle("user_1", "owner")).handle).toBe("owner");
    expect(await s.accounts.heldHandle("owner")).toBeNull();
    expect(await s.accounts.heldHandle("renamed")).toBe("owner");
  });
});

describe("the UI moved from /app to the root (v2 spec: URLs)", () => {
  test("old URLs map to their new place", () => {
    expect(legacyUrl("/app")).toBe("/");
    expect(legacyUrl("/app/libraries")).toBe("/");
    expect(legacyUrl("/app/tokens")).toBe("/tokens");
    expect(legacyUrl("/app/grants/revoke")).toBe("/agents");
    expect(legacyUrl("/app/libraries/ada/notes/")).toBe("/ada/notes/");
    expect(legacyUrl("/app/libraries/ada/notes/tree/a/b/")).toBe("/ada/notes/a/b/");
    expect(legacyUrl("/app/libraries/ada/notes/files/a/b.md")).toBe("/ada/notes/a/b.md");
    expect(legacyUrl("/app/libraries/ada/notes/ledger")).toBe("/ada/notes/-/ledger");
  });

  test("an old URL redirects with its query; a route name is never a library", async () => {
    const s = setup();
    const r = await s.app.request("/app/libraries/owner/demo/ledger?prefix=x", {
      redirect: "manual",
    });
    expect(r.status).toBe(308);
    expect(r.headers.get("Location")).toBe("/owner/demo/-/ledger?prefix=x");
    const api = await s.anon.request("/api/v1/nothing/here", { redirect: "manual" });
    expect(api.status).toBe(404);
    expect(api.headers.get("Content-Type")).toContain("json");
  });

  test("plain http on a real host goes to https; loopback stays for dev", async () => {
    const s = setup();
    const r = await s.anon.request("http://app.example/healthz?x=1", { redirect: "manual" });
    expect(r.status).toBe(308);
    expect(r.headers.get("Location")).toBe("https://app.example/healthz?x=1");
    expect((await s.anon.request("http://localhost/healthz")).status).toBe(200);
  });
});
