<script lang="ts">
  import AtNotice from "../AtNotice.svelte";
  import { bodyHref, type FileJson } from "../concept/data";
  import Reader from "../Reader.svelte";
  import { prepare } from "../reader/prepare";
  import { useLibraryLabel } from "../role.svelte.ts";
  import { useTitle } from "../ui.svelte.ts";
  import type { Urls } from "../urls";

  /** A synthesized file (index.md, log.md) in the reader: the file as an agent reads it. */
  let { urls, head, file }: { urls: Urls; head: number; file: Extract<FileJson, { kind: "derived" }> } =
    $props();
  const label = useLibraryLabel(() => urls);
  useTitle(() => `${file.path} · ${label.current}`);
  const prepared = $derived(
    prepare(file.doc, { path: file.path, href: bodyHref(urls), footnote: () => null }),
  );
</script>

<AtNotice {urls} {head} current={urls.pinned(undefined).file(file.path)} /><p class="small muted"
  >Synthesized by the server. <a href={urls.raw(file.path)}>Raw</a></p
><Reader {prepared} diff={null} hideFirst={false} />
