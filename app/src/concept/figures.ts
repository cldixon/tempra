import { useMemo } from "react";
import { api } from "../api";
import type { FigureView, ImageFacts } from "../reader/Lightbox";
import { enc, type Urls } from "../urls";
import type { Namer } from "./Byline";
import { actedBy, type FileJson, type HistoryEvent } from "./data";

/**
 * What the full-screen view says about a concept's images (tempra-dev: app/reader, Figures): the
 * concept's title, and for an image stored in the library its size and who added it, asked for
 * once per image when the view first shows it.
 */
export function useFigureView(urls: Urls, title: string, name: Namer): FigureView {
  return useMemo(() => {
    const asked = new Map<string, Promise<ImageFacts | null>>();
    const describe = (path: string) => {
      let facts = asked.get(path);
      if (!facts) {
        facts = Promise.all([
          api<FileJson>(urls.api(`files/${enc(path)}`, { at: urls.at })),
          api<{ events: HistoryEvent[] }>(urls.api(`history/${enc(path)}`)),
        ]).then(
          ([file, history]) => {
            const added = [...history.events].reverse().find((e) => e.op !== "comment");
            return {
              size: file.kind === "attachment" ? file.size : null,
              media: file.kind === "attachment" ? file.media : null,
              by: added ? name(added.actor, actedBy(added)).name : null,
              at: added?.ts ?? null,
            };
          },
          () => null,
        );
        asked.set(path, facts);
      }
      return facts;
    };
    return { title, describe, fileHref: (path: string) => urls.pinned(undefined).file(path) };
  }, [urls, title, name]);
}
