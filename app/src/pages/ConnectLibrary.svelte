<script lang="ts">
  import { byPerson, type LedgerRequest } from "../activity";
  import { useAgentNames } from "../agents.svelte.ts";
  import { api } from "../api";
  import { useFeed, useTrailing } from "../live.svelte.ts";
  import { useLoad } from "../load.svelte.ts";
  import Moment from "../Moment.svelte";
  import { useRole } from "../role.svelte.ts";
  import Status from "../Status.svelte";
  import type { Urls } from "../urls";
  import ConnectSteps from "./ConnectSteps.svelte";

  /**
   * The Settings page's Connect section: the steps naming the library, and (live) whether an
   * agent has written yet.
   */
  let { urls }: { urls: Urls } = $props();
  const loaded = useLoad(
    () => `connect ${urls.base}`,
    async () => {
      const [recent, stats] = await Promise.all([
        api<{ requests: LedgerRequest[] }>(urls.api("requests", { limit: 50 })),
        api<{ seq: number }>(urls.api("stats")),
      ]);
      // The newest change by an agent, not a person (the rule the home uses too): "waiting for
      // your agent" (v2 spec: Onboarding).
      return { latest: recent.requests.find((r) => !byPerson(r)) ?? null, head: stats.seq };
    },
  );
  // Reloads (debounced) whenever the library changes, and once it loaded, after its head.
  const soon = useTrailing(() => loaded.reload());
  useFeed(
    () => urls,
    () => loaded.data?.head ?? null,
    () => soon(),
    soon,
  );
  const role = useRole(() => urls);
  const names = useAgentNames(() => urls);
</script>

{#if role.current && role.current !== "owner"}
  <p>
    This library is @{urls.owner}'s, shared with you to
    {role.current === "write" ? "read and write" : "read and comment"}. Your agents reach it at most
    with the same access; pick it by name when you connect.
  </p>
{/if}
<ConnectSteps slug={urls.slug} library={`${urls.owner}/${urls.slug}`} level={3} />
<h3>Status</h3>
<Status loaded={loaded.current}>
  {#snippet children({ latest })}
    <p id="status">
      {#if latest}Last agent write: {names.label(latest.actor, latest.by)}, <Moment ts={latest.ts} />{latest.note
          ? `, “${latest.note}”`
          : ""}. <a href={urls.activity()}>See Activity</a>{:else}No agent has written yet. This updates when one
        does.{/if}
    </p>
  {/snippet}
</Status>
