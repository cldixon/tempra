<script lang="ts">
  import { actorText } from "../agents";
  import { useActors } from "../agents.svelte.ts";
  import { ApiError, api } from "../api";
  import type { HistoryEvent } from "../concept/data";
  import { useFrame } from "../frame.svelte.ts";
  import Icon from "../Icon.svelte";
  import { useLoad } from "../load.svelte.ts";
  import Moment from "../Moment.svelte";
  import PageColumn from "../PageColumn.svelte";
  import { fileLabel } from "../tree";
  import { useMe, useTitle } from "../ui.svelte.ts";
  import { baseName, dirOf, enc, folderName, type Urls } from "../urls";
  import { fateOf } from "./file";

  /**
   * Not found (board 32): "This page isn't here", where the ledger says it went (moved, with Open;
   * or deleted), then Home and Search.
   */
  let { urls, path }: { urls: Urls; path: string } = $props();
  useTitle(() => "Not found");
  const me = useMe();
  const actors = useActors(
    () => urls,
    () => me.current?.actor ?? null,
  );
  const frame = useFrame();
  const fate = useLoad(
    () => `fate ${urls.base} ${path}`,
    async () => {
      if (path === "") return null;
      try {
        const h = await api<{ path: string; events: HistoryEvent[] }>(
          urls.api(`history/${enc(path)}`),
        );
        return fateOf(path, h);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  );
  const f = $derived(fate.data ?? null);
  const who = $derived(f ? actorText(actors.view(f.actor, f.by)) : "");
  // Where it went, by its title and folder (H-13), as the tree names it.
  const where = $derived.by(() => {
    if (f?.kind !== "moved") return "";
    const moved = frame.index?.find((x) => x.path === f.to);
    return `${moved ? fileLabel(moved) : baseName(f.to).replace(/\.md$/, "")}${dirOf(f.to) ? ` (${folderName(dirOf(f.to))})` : ""}`;
  });
</script>

<PageColumn
  ><div class="not-found"
    ><h1 class="view-title">This page isn't here</h1
    >{#if f?.kind === "moved"}<p class="not-found-fate"
        ><span>Moved to {where} by {who}, <Moment ts={f.ts} /></span><a href={urls.file(f.to)}>Open</a></p
      >{/if}{#if f?.kind === "deleted"}<p class="not-found-fate"
        ><span>Deleted by {who}, <Moment ts={f.ts} /></span><a href={urls.activity({ view: "events", q: path })}>In Activity</a></p
      >{/if}<p class="not-found-ways"
      ><a class="button" href={urls.tree("")}>Home</a><button type="button" onclick={() => frame.search()}><Icon name="search" /> Search</button></p
    ></div
  ></PageColumn
>
