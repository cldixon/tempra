import { describe, expect, test } from "bun:test";
import { mentionAt, offered } from "./src/mentions";

describe("mentions in the comment box (TEMPRA-73)", () => {
  test("finds the @word being typed before the caret", () => {
    expect(mentionAt("Hi @an", 6)).toEqual({ start: 3, query: "an" });
    expect(mentionAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionAt("(@Bo", 4)).toEqual({ start: 1, query: "bo" });
    // An email address or a finished mention is not one being typed.
    expect(mentionAt("ann@example", 11)).toBeNull();
    expect(mentionAt("@ann done", 9)).toBeNull();
  });

  test("offers matching handles, the exact one last", () => {
    expect(offered(["ann", "anna", "bo", "ann"], "ann")).toEqual(["anna", "ann"]);
    expect(offered(["ann", "bo"], "")).toEqual(["ann", "bo"]);
    expect(offered(["ann"], "z")).toEqual([]);
  });
});
