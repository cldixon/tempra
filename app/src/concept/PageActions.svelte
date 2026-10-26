<script lang="ts">
  import Icon from "../Icon.svelte";
  import Menu from "../Menu.svelte";
  import { day, plural } from "../ui";
  import type { Urls } from "../urls";
  import type { Namer } from "./byline";
  import { checker } from "./checked";
  import { useCheck } from "./checked.svelte.ts";
  import type { Standing } from "./data";

  /*
   * A page's actions (TEMPRA-172; tempra-dev: decisions/a-pages-actions-float): one round + button
   * at the page's bottom right, the one raised thing on a flat page, opening a small menu upward:
   * Comment (with the open count), then Check by the page's state (Mark as checked, Review changes,
   * or a quiet line saying who checked it). More actions join it later. It steps aside while a
   * panel is open (the panel has its own ×), and comes back, focusable, when the panel closes.
   */
  let props: {
    urls: Urls;
    path: string;
    standing: Standing;
    name: Namer;
    /** Open threads on the page. */
    openCount: number;
    /** The latest version is on screen (checking is of the latest only). */
    current: boolean;
    /** Review mode is on: its bar holds Mark as checked and Done. */
    reviewing: boolean;
    /** A write member, who may mark the page as checked. */
    mayVerify: boolean;
    /** A panel is open: the button steps aside. */
    hidden: boolean;
    onComment(): void;
    /** The page was marked as checked: its history is read again. */
    onVerified(): void;
  } = $props();

  const check = useCheck(
    () => props.urls,
    () => props.path,
    () => props.onVerified(),
  );
  const failed = $derived(check.error !== null);
  const s = $derived(props.standing);
  const changed = $derived(props.current && s.verified !== null && s.since > 0);
  const who = $derived(checker(s, props.name));
  // Something waits here: open comments, or changes since the page was checked.
  const waiting = $derived(props.openCount > 0 || changed);
  const name = $derived(
    props.openCount > 0 ? `Actions, ${plural(props.openCount, "open comment")}` : "Actions",
  );
</script>

<div class="page-actions" hidden={props.hidden}>
  <Menu {name} title="Actions" buttonClass="page-fab" align="end" up listClass="page-actions-list">
    {#snippet label()}<Icon name="add" size={22} />{#if waiting}<span class="page-fab-dot" aria-hidden="true"></span>{/if}{/snippet}<button type="button" class="menu-item" onclick={() => props.onComment()}
      ><Icon name="comments" /> Comment{#if props.openCount > 0}<span class="menu-count">{props.openCount} open</span>{/if}</button
    >{#if props.current && !props.reviewing && changed}<a class="menu-item" href={props.urls.review(props.path)}
        ><Icon name="review" /> Review changes<span class="menu-count">{plural(s.since, "change")}</span></a
      >{/if}{#if props.current && !s.verified && props.mayVerify}<button type="button" class="menu-item" data-stay={failed || undefined} onclick={() => check.check()}
        ><Icon name="check" /> {failed ? "Could not mark as checked" : "Mark as checked"}</button
      >{/if}{#if props.current && s.verified && s.since === 0 && who}<p class="menu-line">Checked by {who}, {day(s.verified.event.ts)}</p>{/if}
  </Menu>
</div>
