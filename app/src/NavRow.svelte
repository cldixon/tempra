<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon, { type Glyph } from "./Icon.svelte";
  import LibraryTile from "./LibraryTile.svelte";

  /** A row of the sidebar: a glyph (or a tile), a name, a count or a mark at the end. */
  let props: {
    href: string;
    current?: boolean;
    icon?: Glyph;
    tile?: { name: string; shared?: boolean };
    label: string;
    end?: Snippet;
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
    />{/if}<span class="nav-label">{props.label}</span>{@render props.end?.()}</a
>
