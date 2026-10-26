<script lang="ts">
  import {
    type InboxItem,
    itemDetail,
    itemHref,
    itemLibrary,
    itemQuote,
    itemTitle,
    kindLabel,
    markRead,
    type PageTitles,
  } from "../inbox";
  import LibraryTile from "../LibraryTile.svelte";
  import Moment from "../Moment.svelte";
  import { Urls } from "../urls";

  /** One item: its library, kind and time; the title; the detail line, a quote; its actions. */
  let {
    item: i,
    titles,
    now,
    me,
    reachable,
    busy,
    run,
    post,
    onAccept,
  }: {
    item: InboxItem;
    titles: PageTitles;
    now: number;
    me: string | null;
    /** Whether the person reaches the item's library (an accepted invitation opens it). */
    reachable: boolean;
    busy: boolean;
    run: (fn: () => Promise<unknown>) => Promise<void>;
    post: (path: string, body?: unknown) => Promise<unknown>;
    onAccept(i: InboxItem): void;
  } = $props();

  /** An action of the row: a link it follows, or a button that acts on the item. */
  type Action =
    | { label: string; primary: boolean; href: string }
    | { label: string; primary: boolean; onclick: () => void };

  const unread = $derived(i.read_at === null && i.done_at === null);
  const owner = $derived(i.library.split("/")[0] ?? "");
  const slug = $derived(i.library.split("/")[1] ?? "");
  const urls = $derived(new Urls(owner, slug));
  const href = $derived(itemHref(i));
  const quote = $derived(itemQuote(i));
  // Following an item, or acting on it, reads it.
  const read = () => {
    if (i.read_at === null) void markRead([i.id]);
  };
  const ownLibrary = $derived(me !== null && owner === me);
  const name = $derived(itemLibrary(i, me));
  const done = (path: string) => () => void run(() => post(path));
  const actions = $derived.by(() => {
    const out: Action[] = [];
    const link = (label: string, to: string, primary = false) =>
      out.push({ label, primary, href: to });
    const button = (label: string, onclick: () => void, primary = false) =>
      out.push({ label, primary, onclick });
    for (const a of i.actions) {
      if (a === "reply") link("Reply", href);
      else if (a === "resolve" && i.thread)
        button("Resolve", done(`${urls.api(`comments/${encodeURIComponent(i.thread)}`)}/resolve`));
      else if (a === "open") link("Open", href);
      else if (a === "accept" && i.invitation) button("Accept", () => onAccept(i), true);
      else if (a === "decline" && i.invitation)
        button("Decline", done(`/api/v1/invitations/${encodeURIComponent(i.invitation)}/decline`));
    }
    // An invitation answered and accepted: the library opens from its row.
    if (i.kind === "invitation" && i.done_at !== null && reachable) link("Open", urls.tree(""));
    return out;
  });
</script>

<li class={unread ? "inbox-row unread" : "inbox-row"}>
  <span class="inbox-dot" aria-hidden="true"></span>
  {#if unread}<span class="visually-hidden">{"Unread: "}</span>{/if}
  <div class="inbox-main">
    <p class="inbox-meta"><LibraryTile name={i.library_title || slug} shared={!ownLibrary} /><span>{name}</span><span aria-hidden="true">·</span><span>{kindLabel(i)}</span><span aria-hidden="true">·</span><Moment ts={i.created} {now} /></p>
    <p class="inbox-title"><a {href} onclick={read}>{itemTitle(i, titles)}</a></p>
    <p class="inbox-detail">{itemDetail(i)}</p>
    {#if quote}
      <blockquote class="inbox-quote">{quote}</blockquote>
    {/if}
  </div>
  {#if actions.length > 0}
    <!-- A click bubbling up from an action reads the item; the actions take the keys. -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="inbox-actions" onclick={read}>{#each actions as a}{#if "href" in a}<a class={a.primary ? "button primary" : "button"} href={a.href} onclick={read}>{a.label}</a>{:else}<button type="button" class={a.primary ? "primary" : undefined} disabled={busy} onclick={a.onclick}>{a.label}</button>{/if}{/each}</div>
  {/if}
</li>
