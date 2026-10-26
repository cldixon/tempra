<script lang="ts" module>
  import { Urls } from "./urls";

  /** The pages that lay out their column themselves (a concept's columns, the person's views). */
  const OWN_COLUMN = new Set(["file", "directory", "activity"]);

  /**
   * One Urls per library and pinned sequence, so pages and what they derive see the same object
   * across navigations (a fragment change must not remount the reader).
   */
  const urlsCache = new Map<string, Urls>();
  function urlsFor(owner: string, slug: string, at: number | undefined): Urls {
    const key = `${owner}/${slug}@${at ?? ""}`;
    let urls = urlsCache.get(key);
    if (!urls) {
      urls = new Urls(owner, slug, at);
      urlsCache.set(key, urls);
    }
    return urls;
  }
</script>

<script lang="ts">
  import AccountFrame from "./AccountFrame.svelte";
  import type { AccountPage, Place } from "./frame";
  import { here } from "./location.svelte.ts";
  import PageColumn from "./PageColumn.svelte";
  import Account from "./pages/Account.svelte";
  import Activity from "./pages/Activity.svelte";
  import Agents from "./pages/Agents.svelte";
  import ConnectLibrary from "./pages/ConnectLibrary.svelte";
  import DeleteLibrary from "./pages/DeleteLibrary.svelte";
  import File from "./pages/File.svelte";
  import General from "./pages/General.svelte";
  import Home from "./pages/Home.svelte";
  import Inbox from "./pages/Inbox.svelte";
  import Invitations from "./pages/Invitations.svelte";
  import Libraries from "./pages/Libraries.svelte";
  import Members from "./pages/Members.svelte";
  import Notifications from "./pages/Notifications.svelte";
  import Recovery from "./pages/Recovery.svelte";
  import Restore from "./pages/Restore.svelte";
  import Revert from "./pages/Revert.svelte";
  import Transfer from "./pages/Transfer.svelte";
  import Welcome from "./pages/Welcome.svelte";
  import Redirect from "./Redirect.svelte";
  import { match, pageKey } from "./router";
  import { useMe } from "./ui.svelte.ts";
  import Workspace from "./Workspace.svelte";

  const me = useMe();
  const url = $derived(here.url);
  const route = $derived(match(url));
  const actor = $derived(me.current?.actor ?? "");
  const key = $derived(pageKey(url, route));

  /** For the account's pages: which one, for its frame. */
  const account = $derived.by((): AccountPage | null => {
    switch (route?.page) {
      case "libraries":
      case "welcome":
      case "agents":
      case "account":
      case "notifications":
      case "invitations":
      case "inbox":
        return route.page;
      case "redirect":
        return "inbox";
      default:
        return null;
    }
  });

  /** For a library's pages: the library and where in it the page is (the workspace frame). */
  const library = $derived.by((): { urls: Urls; place: Place; pinned: Urls } | null => {
    const r = route;
    if (!r || !("owner" in r)) return null;
    const place: Place = { file: null, dir: null, view: null };
    switch (r.page) {
      case "directory":
        if (r.dir === "") place.view = "home";
        else place.dir = r.dir;
        break;
      case "file":
      case "diff":
      case "restore":
        place.file = r.path;
        break;
      case "revert":
        place.view = "activity";
        break;
      case "library-connect":
        place.view = "connect";
        break;
      default:
        place.view = r.page;
    }
    return {
      urls: urlsFor(r.owner, r.slug, undefined),
      place,
      pinned: urlsFor(r.owner, r.slug, "at" in r ? r.at : undefined),
    };
  });
  const libraryKey = $derived(library ? `${library.urls.owner}/${library.urls.slug}` : "");
</script>

{#snippet page()}
  <!-- Keeps a failure in one page from blanking the app: the page shows an error instead, and
       the frame still works. Keyed by the URL, so moving to another page starts afresh. -->
  {#key key}
    <svelte:boundary onerror={(e) => console.error(e)}>
      {@render body()}
      {#snippet failed(error)}
        <h1>Something went wrong</h1>
        <p class="muted">{error instanceof Error ? error.message : String(error)}</p>
        <p><a href={location.href}>Reload the page</a></p>
      {/snippet}
    </svelte:boundary>
  {/key}
{/snippet}

{#snippet body()}
  {#if !route}
    <!-- The Worker serves this page only at the app's own URLs, so this is a bug, not a 404. -->
    <h1>Not found</h1>
  {:else if route.page === "libraries"}
    <Libraries create={route.create} />
  {:else if route.page === "welcome"}
    <Welcome me={me.current} />
  {:else if route.page === "agents"}
    <Agents me={me.current} newToken={route.newToken} library={route.library} />
  {:else if route.page === "account"}
    <Account done={route.done} />
  {:else if route.page === "notifications"}
    <Notifications />
  {:else if route.page === "invitations"}
    <Invitations />
  {:else if route.page === "inbox"}
    <Inbox done={route.done} library={route.library} />
  {:else if route.page === "redirect"}
    <Redirect to={route.to} />
  {:else if library}
    {@const urls = library.pinned}
    {#if route.page === "directory"}
      {#if route.dir === ""}
        <Home {urls} />
      {:else}
        <!-- A folder's address (TEMPRA-138): a folder is a group in the tree, not a page, so its
             address opens the home; the workspace hands the folder to the tree (`place.dir`). -->
        <Redirect to={urls.pinned(undefined).tree("")} />
      {/if}
    {:else if route.page === "activity"}
      <Activity {urls} {actor} filters={route.filters} done={route.done} />
    {:else if route.page === "file"}
      <File {urls} path={route.path} done={url.searchParams.get("done")} {actor} compare={route.compare ?? null} />
    {:else if route.page === "diff"}
      <!-- The take 3 Diff page is retired (TEMPRA-124): its address opens the concept's own
           version view. -->
      <Redirect to={urls.diff(route.path, route.from, route.to)} />
    {:else if route.page === "settings"}
      <General {urls} />
    {:else if route.page === "transfer"}
      <Transfer {urls} />
    {:else if route.page === "recovery"}
      <Recovery {urls} />
    {:else if route.page === "library-connect"}
      <ConnectLibrary {urls} />
    {:else if route.page === "delete"}
      <DeleteLibrary {urls} />
    {:else if route.page === "members"}
      <Members {urls} me={me.current?.handle ?? null} />
    {:else if route.page === "revert"}
      <Revert {urls} request={route.request} {actor} />
    {:else if route.page === "restore"}
      <Restore {urls} path={route.path} to={route.to} {actor} />
    {/if}
  {/if}
{/snippet}

{#if library}
  <!-- A library's pages share one workspace, kept mounted while the person moves within it. -->
  {#key libraryKey}
    <Workspace urls={library.urls} place={library.place} me={me.current}>
      {#if route && OWN_COLUMN.has(route.page)}
        {@render page()}
      {:else}
        <PageColumn>{@render page()}</PageColumn>
      {/if}
    </Workspace>
  {/key}
{:else}
  <!-- The account's pages share its frame. -->
  <AccountFrame page={account ?? "libraries"} me={me.current}>
    <PageColumn>{@render page()}</PageColumn>
  </AccountFrame>
{/if}
