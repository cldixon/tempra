<script lang="ts">
  import Icon, { type Glyph } from "./Icon.svelte";
  import LibraryTile from "./LibraryTile.svelte";

  /**
   * A row of the sidebar: a glyph (or a tile), a name, and at its end the Inbox's unread count,
   * read as "Inbox 2 unread": the name is the row's own words, so it starts with what it shows
   * (WCAG 2.5.3).
   */
  let props: {
    href: string;
    current?: boolean;
    icon?: Glyph;
    tile?: { name: string; shared?: boolean };
    label: string;
    unread?: number;
    className?: string;
  } = $props();
</script>

<a
  class={props.className ? `nav-row ${props.className}` : "nav-row"}
  href={props.href}
  aria-current={props.current ? "page" : undefined}
  >{#if props.icon}<Icon name={props.icon} />{/if}{#if props.tile}<LibraryTile
      name={props.tile.name}
      shared={props.tile.shared}
    />{/if}<span class="nav-label">{props.label}</span
  >{#if props.unread}{" "}<span class="nav-count"
      >{props.unread}<span class="visually-hidden">{" unread"}</span></span
    >{/if}</a
>
