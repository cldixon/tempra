<script lang="ts">
  import { byPerson, type LedgerRequest, whoWorksHere } from "../activity";
  import { useActors } from "../agents.svelte.ts";
  import { api } from "../api";
  import { useFrame } from "../frame.svelte.ts";
  import { useFeed, useTrailing } from "../live.svelte.ts";
  import { useLoad } from "../load.svelte.ts";
  import PageColumn from "../PageColumn.svelte";
  import { libraryLabel } from "../role";
  import { useLibraries, useRole } from "../role.svelte.ts";
  import Status from "../Status.svelte";
  import { plural } from "../ui";
  import { useMe, useNow, useTitle } from "../ui.svelte.ts";
  import type { Urls } from "../urls";
  import EmptyLibrary from "./EmptyLibrary.svelte";
  import { READ, recentlyChanged } from "./home";
  import RecentlyChanged from "./RecentlyChanged.svelte";

  /**
   * The library's home (take 4, TEMPRA-117, TEMPRA-121; tempra-dev: app/home): its title and
   * description, one quiet line (who works here, the page count, the guide), and the pages changed
   * most recently. No sections: the tree beside it lists the folders (TEMPRA-138); no housekeeping,
   * which is the agents' (TEMPRA-144); no notifications, which are the Inbox's, and no "since you
   * last looked", which is Activity's to show when asked (TEMPRA-173). An empty library shows how to
   * connect an agent instead (to those who can). Each part loads on its own, so one that fails
   * leaves the rest (H-7).
   */
  let { urls }: { urls: Urls } = $props();

  const libs = useLibraries();
  const lib = $derived(
    libs.data?.libraries.find((l) => l.owner === urls.owner && l.slug === urls.slug),
  );
  const name = $derived(libraryLabel(lib ?? urls));
  useTitle(() => name);
  const me = useMe();
  const role = useRole(() => urls);
  const actors = useActors(() => urls);
  const frame = useFrame();
  const now = useNow();
  const loaded = useLoad(
    () => `home ${urls.base}`,
    async () => {
      const [summary, page] = await Promise.all([
        api<{ seq: number; concepts: number }>(urls.api("summary")),
        api<{ requests: LedgerRequest[] }>(urls.api("requests", { limit: READ })),
      ]);
      return {
        head: summary.seq,
        concepts: summary.concepts,
        requests: page.requests,
        latest: page.requests.find((r) => !byPerson(r)) ?? null,
        // No agent among the newest requests, and no older ones: no agent has written here yet.
        noAgentYet: page.requests.length < READ && !page.requests.some((r) => !byPerson(r)),
      };
    },
  );
  // Who works here: only the header's quiet line needs it, so a failure drops only that line.
  const members = useLoad(
    () => `home people ${urls.base}`,
    () =>
      api<{ owner: string; members: { handle: string }[] }>(urls.api("members")).then((m) => [
        m.owner,
        ...m.members.map((x) => x.handle),
      ]),
  );
  const reload = useTrailing(() => loaded.reload(), 1500);
  useFeed(
    () => urls,
    () => loaded.data?.head ?? null,
    reload,
    reload,
  );

  // The tree's outline when it has arrived (it follows the feed), else the summary (`empty`).
  const files = $derived(frame.index);
  const handle = $derived(me.current?.handle ?? null);
  const people = $derived(members.data ?? null);
  const you = $derived(handle !== null && (people?.includes(handle) ?? false));
  const agents = $derived(actors.contributors.filter((c) => c.agent).length);
  const guide = $derived(files?.some((f) => f.path === "guide.md" && f.kind === "concept"));
  const who = $derived(
    people === null ? null : whoWorksHere(you, people.length - (you ? 1 : 0), agents),
  );
  const canWrite = $derived(role.current === "owner" || role.current === "write");
</script>

<PageColumn>
  <Status loaded={loaded.current}>
    {#snippet children(home)}
      {@const empty = files === null ? home.concepts === 0 : files.length === 0}
      {@const meta = [who, plural(home.concepts, "page")].filter((p): p is string => p !== null)}
      <header class="view-head home-head">
        <div class="view-head-main">
          <h1 class="view-title">{name}</h1>
          {#if lib?.description}
            <p class="view-lede">{lib.description}</p>
          {/if}
          {#if !empty && (meta.length > 0 || guide)}
            <p class="view-meta home-who">{meta.join(" · ")}{#if guide}{meta.length > 0 ? " · " : ""}<a href={urls.file("guide.md")}>Start with the guide</a>{/if}</p>
          {/if}
        </div>
      </header>
      {#if empty}
        <EmptyLibrary
          {urls}
          access={role.current}
          latest={home.latest}
          who={home.latest ? actors.view(home.latest.actor, home.latest.by) : null}
          now={now.current}
        />
      {:else}
        <!-- A first library with only its start-here note: how to connect an agent. -->
        {#if home.noAgentYet && canWrite}
          <EmptyLibrary
            {urls}
            access={role.current}
            latest={null}
            who={null}
            now={now.current}
            heading="Connect an agent"
          />
        {/if}
        {#if files !== null}
          <RecentlyChanged
            {urls}
            changed={recentlyChanged(home.requests, files)}
            view={(a, by) => actors.view(a, by)}
          />
        {/if}
      {/if}
    {/snippet}
  </Status>
</PageColumn>
