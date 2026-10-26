<script lang="ts">
  import { post } from "../api";
  import {
    type InboxItem,
    itemDetail,
    itemHref,
    itemLibrary,
    itemQuote,
    itemTitle,
    kindLabel,
    markDone,
    type PageTitles,
  } from "../inbox";
  import LibraryTile from "../LibraryTile.svelte";
  import Moment from "../Moment.svelte";
  import { urlsOf } from "../urls";

  /**
   * One item: its library, kind and time; the title; the detail line, a quote; its actions. While
   * it waits, following it (its title, Reply) marks it done (one state, TEMPRA-189); a done item
   * is drawn quieter, under Earlier.
   */
  let {
    item: i,
    titles,
    me,
    reachable,
    busy,
    run,
    onAccept,
  }: {
    item: InboxItem;
    titles: PageTitles;
    me: string | null;
    /** Whether the person reaches the item's library (an accepted invitation opens it). */
    reachable: boolean;
    busy: boolean;
    run: (fn: () => Promise<unknown>) => Promise<void>;
    onAccept(i: InboxItem): void;
  } = $props();

  /** An action of the row: a link it follows, or a button that acts on the item. */
  type Action =
    | { label: string; primary: boolean; href: string }
    | { label: string; primary: boolean; onclick: () => void };

  const waiting = $derived(i.done_at === null);
  const urls = $derived(urlsOf(i.library));
  const href = $derived(itemHref(i));
  const quote = $derived(itemQuote(i));
  // Following a waiting item (into its thread) is seeing it: it is done.
  const opened = () => {
    if (i.done_at === null && i.kind !== "invitation") void markDone(i.id);
  };
  const ownLibrary = $derived(me !== null && urls.owner === me);
  const name = $derived(itemLibrary(i, me));
  const done = (path: string) => () => void run(() => post(path, {}));
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

<li class={waiting ? "inbox-row" : "inbox-row done"}>
  <div class="inbox-main">
    <p class="inbox-meta"><LibraryTile name={i.library_title || urls.slug} shared={!ownLibrary} /><span>{name}</span><span aria-hidden="true">·</span><span>{kindLabel(i)}</span><span aria-hidden="true">·</span><Moment ts={i.created} /></p>
    <p class="inbox-title"><a {href} onclick={opened}>{itemTitle(i, titles)}</a></p>
    <p class="inbox-detail">{itemDetail(i)}</p>
    {#if quote}
      <blockquote class="inbox-quote">{quote}</blockquote>
    {/if}
  </div>
  {#if actions.length > 0}
    <div class="inbox-actions">{#each actions as a}{#if "href" in a}<a class={a.primary ? "button primary" : "button"} href={a.href} onclick={opened}>{a.label}</a>{:else}<button type="button" class={a.primary ? "primary" : undefined} disabled={busy} onclick={a.onclick}>{a.label}</button>{/if}{/each}</div>
  {/if}
</li>
