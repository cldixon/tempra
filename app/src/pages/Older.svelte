<script lang="ts">
  import type { Snippet } from "svelte";
  import { type LedgerRequest, REQUESTS_PAGE, type RequestPage } from "../activity";
  import { api } from "../api";
  import type { Urls } from "../urls";

  /**
   * The first page and the older ones "Older" pages back to, as one list of requests (both views
   * draw from it). Keyed by the server's filters (`{#key}` in Activity), so changing them starts
   * afresh.
   */
  let {
    urls,
    prefix,
    actor,
    first,
    children,
  }: {
    urls: Urls;
    prefix: string;
    actor: string;
    first: RequestPage;
    /** The requests loaded so far, and whether there are older ones to page to. */
    children: Snippet<[LedgerRequest[], boolean]>;
  } = $props();

  let older = $state.raw<RequestPage>({ requests: [], next: null });
  let paging = $state(false);
  const next = $derived(older.requests.length > 0 ? older.next : first.next);
  const requests = $derived([...first.requests, ...older.requests]);

  function loadOlder() {
    if (next === null) return;
    paging = true;
    api<RequestPage>(
      urls.api("requests", {
        prefix: prefix || undefined,
        actor: actor || undefined,
        before: next,
        limit: REQUESTS_PAGE,
      }),
    )
      .then((p) => {
        older = { requests: [...older.requests, ...p.requests], next: p.next };
      })
      .catch(() => {})
      .finally(() => {
        paging = false;
      });
  }
</script>

{@render children(requests, next !== null)}
{#if next !== null}
  <p class="view-more">
    <button type="button" onclick={loadOlder} disabled={paging}>{paging ? "Loading…" : "Older"}</button>
  </p>
{/if}
