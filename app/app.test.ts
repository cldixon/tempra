import { describe, expect, test } from "bun:test";
import { moduleSource } from "./build";
import { match } from "./src/router";
import { Urls } from "./src/urls";

const at = (path: string) => match(new URL(path, "http://localhost"));

describe("routes follow the server's URLs (tempra-dev: v2/urls-and-handles)", () => {
  test("library list, directories and files at their own paths", () => {
    expect(at("/")).toEqual({ page: "libraries", create: false });
    expect(at("/ann/notes/")).toMatchObject({ page: "directory", dir: "", owner: "ann" });
    expect(at("/ann/notes/a/b/")).toMatchObject({ page: "directory", dir: "a/b" });
    expect(at("/ann/notes/a/b.md?at=4")).toMatchObject({ page: "file", path: "a/b.md", at: 4 });
    expect(at("/ann/notes/a%20b/c.md")).toMatchObject({ page: "file", path: "a b/c.md" });
  });

  test("a concept in review mode, or against an earlier version (take 3)", () => {
    const urls = new Urls("ann", "notes");
    expect(at(urls.review("a/b.md"))).toMatchObject({ compare: { kind: "review" } });
    expect(at(urls.since("a/b.md", 7))).toMatchObject({ compare: { kind: "since", seq: 7 } });
    expect(at(urls.file("a/b.md"))).toMatchObject({ page: "file", compare: undefined });
    expect(at(urls.thread("a/b.md", "t1"))).toMatchObject({ page: "file", path: "a/b.md" });
    // Needs you is the Inbox filtered to the library (TEMPRA-116); its old URL redirects there.
    expect(urls.needs()).toBe("/inbox?library=ann/notes");
    expect(at(urls.needs())).toEqual({ page: "inbox", done: false, library: "ann/notes" });
    expect(at("/ann/notes/-/needs")).toEqual({ page: "redirect", to: "/inbox?library=ann/notes" });
    expect(at(urls.activity())).toMatchObject({
      page: "activity",
      filters: { view: "summary", who: "everyone" },
    });
    const filtered = urls.activity({ who: "agents", prefix: "app" });
    expect(filtered).toBe("/ann/notes/-/activity?who=agents&prefix=app");
    expect(at(filtered)).toMatchObject({
      filters: { view: "summary", who: "agents", prefix: "app" },
    });
  });

  test("Activity's two views and their filters, in the URL (take 4, TEMPRA-115)", () => {
    const urls = new Urls("ann", "notes");
    const events = urls.activity({ view: "events", who: "people", kind: "edit", q: "reader" });
    expect(events).toBe("/ann/notes/-/activity?view=events&who=people&kind=edit&q=reader");
    expect(at(events)).toMatchObject({
      page: "activity",
      filters: { view: "events", who: "people", kind: "edit", q: "reader" },
      done: null,
    });
    // The ledger's address opens Every event, keeping its filters and the revert notice.
    expect(at(urls.ledger())).toMatchObject({ page: "activity", filters: { view: "events" } });
    expect(urls.ledger({ actor: "claude-code" })).toBe("/ann/notes/-/ledger?actor=claude-code");
    // The Summary leaves the default out of its URL; take 3's comments filter is gone.
    expect(urls.activity({ view: "summary" })).toBe("/ann/notes/-/activity");
    expect(at("/ann/notes/-/activity?comments=hide")?.page).toBe("activity");
    expect(urls.ledgerJsonl()).toBe("/ann/notes/-/ledger.jsonl");
  });

  test("paths that start with -/ use the pages' own prefixes", () => {
    expect(at("/ann/notes/-/tree/-/x/")).toMatchObject({ page: "directory", dir: "-/x" });
    expect(at("/ann/notes/-/files/-/x.md")).toMatchObject({ page: "file", path: "-/x.md" });
    expect(at("/ann/notes/-/diff/a.md?from=2&to=5")).toMatchObject({
      page: "diff",
      path: "a.md",
      from: 2,
      to: 5,
    });
    expect(at("/ann/notes/-/ledger?actor=x&before=9&done=revert&n=2")).toMatchObject({
      page: "activity",
      filters: { view: "events", actor: "x" },
      done: { kind: "revert", n: 2 },
    });
  });

  test("the account's pages and every library page are the app's (TEMPRA-14)", () => {
    expect(at("/connect")).toEqual({ page: "connect" });
    expect(at("/tokens?library=notes")).toEqual({ page: "tokens", library: "notes" });
    expect(at("/account?done=email")).toEqual({ page: "account", done: "email" });
    expect(at("/ann/notes/-/work?kind=lint")).toMatchObject({ page: "work", kind: "lint" });
    expect(at("/ann/notes/-/revert/req_1")).toMatchObject({ page: "revert", request: "req_1" });
    expect(at("/ann/notes/-/restore/a/b.md?to=4")).toMatchObject({
      page: "restore",
      path: "a/b.md",
      to: 4,
    });
    expect(at("/ann/notes/-/connect")).toMatchObject({ page: "library-connect" });
    expect(at("/invitations")).toEqual({ page: "invitations" });
    expect(at("/inbox")).toEqual({ page: "inbox", done: false, library: null });
    expect(at("/inbox?all=1")).toEqual({ page: "inbox", done: true, library: null });
    expect(at("/inbox?done=1&library=ann/notes")).toEqual({
      page: "inbox",
      done: true,
      library: "ann/notes",
    });
    for (const p of ["activity", "transfer", "recovery", "delete", "members"]) {
      expect(at(`/ann/notes/-/${p}`)).toMatchObject({ page: p, owner: "ann", slug: "notes" });
    }
  });

  test("server pages and downloads are left to the server", () => {
    for (const p of [
      "/sign-in",
      "/authorize",
      "/account/email/confirm",
      "/ann/notes",
      "/ann/notes/-/raw/a.md",
      "/ann/notes/-/download/a.png",
      "/ann/notes/-/export",
      "/ann/notes/-/exports/2026-10-01/bundle.tar",
      "/ann/notes/-/ledger/x",
      "/ann/notes/-/ledger.jsonl",
    ]) {
      expect(at(p)).toBeNull();
    }
  });

  test("Urls round-trip through match", () => {
    const u = new Urls("ann", "notes");
    expect(at(u.file("a/b.md"))).toMatchObject({ page: "file", path: "a/b.md" });
    expect(at(u.file("-/x.md"))).toMatchObject({ page: "file", path: "-/x.md" });
    expect(at(u.tree("-/d"))).toMatchObject({ page: "directory", dir: "-/d" });
    expect(at(u.pinned(3).tree("d"))).toMatchObject({ page: "directory", dir: "d", at: 3 });
    expect(u.api("tree", { prefix: "a b", at: undefined })).toBe(
      "/api/v1/libraries/ann/notes/tree?prefix=a+b",
    );
  });
});

test("the generated module names the bundle by its content hash", () => {
  const a = moduleSource("console.log(1)");
  expect(a).toMatch(/export const hash = "[0-9a-f]{12}";/);
  expect(a).not.toBe(moduleSource("console.log(2)"));
  // Code-split: the entry keeps the name Vite hashed it by, which its chunks import it by.
  const b = moduleSource("x", { "pele-abc.js": "y" }, "app.BHyq_u-v.js");
  expect(b).toContain('export const hash = "BHyq_u-v";');
  expect(b).toContain('"pele-abc.js":"y"');
});
