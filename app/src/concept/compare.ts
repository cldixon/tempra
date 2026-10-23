import { docText, type WordDiff, wordDiff } from "@tempra/editor";
import { useMemo } from "react";
import { ApiError, api, useLoad } from "../api";
import type { Prepared } from "../reader/prepare";
import { enc, type Urls } from "../urls";
import type { FileJson } from "./data";

/**
 * The body on screen against an earlier version of it, as a word diff drawn in place (tempra-dev:
 * app/reader, Review and History): what changed since a person verified it, or since a version
 * chosen from the history menu. `seq` null compares nothing.
 */
export function useCompare(
  urls: Urls,
  path: string,
  prepared: Prepared,
  seq: number | null,
): { diff: WordDiff | null; error: string | null } {
  const key = seq === null ? "version none" : `version ${urls.file(path)}@${seq}`;
  const old = useLoad(key, async () => {
    if (seq === null) return null;
    const f = await api<FileJson>(urls.api(`files/${enc(path)}`, { at: seq }));
    if (f.kind !== "concept") {
      throw new ApiError(400, "not_concept", "That version is not a page.");
    }
    return f.doc;
  });
  const doc = old.state === "ready" ? old.data : null;
  const diff = useMemo(() => (doc ? wordDiff(docText(doc), prepared.text) : null), [doc, prepared]);
  return {
    diff: seq === null ? null : diff,
    error: seq !== null && old.state === "error" ? old.error.message : null,
  };
}
