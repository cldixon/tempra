<script lang="ts">
  /**
   * The frame of a figure drawn from its markup (`:::figure`, tempra-dev: app/media): its
   * placement, frame and group as classes (prose.css), and its width as `--figure-width`, set
   * through the CSSOM, as the reader's popovers set `--float-x`, so no style attribute is written
   * (CSP). `offset`: where its one image's textblock starts, when the image's footnote markers end
   * the caption (TEMPRA-218), so the figure is the `data-text` element.
   */
  import type { FigureSpec } from "@tempra/editor";
  import type { Snippet } from "svelte";

  let {
    spec,
    count,
    block,
    offset,
    children,
  }: {
    spec: FigureSpec;
    count: number;
    block: string | undefined;
    offset?: number | undefined;
    children: Snippet;
  } = $props();
  let el: HTMLElement | undefined = $state();
  const width = $derived(spec.width ? `${spec.width.value}${spec.width.unit}` : null);
  $effect(() => {
    if (!el) return;
    if (width) el.style.setProperty("--figure-width", width);
    else el.style.removeProperty("--figure-width");
  });
  const cls = $derived(
    [
      "figure",
      spec.layout !== "column" ? `figure-${spec.layout}` : "",
      spec.frame ? "figure-framed" : "",
      width ? "figure-sized" : "",
      count > 1 ? `figure-group figure-n-${count}` : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
</script>

<figure bind:this={el} class={cls} data-block={block} data-text={offset}>{@render children()}</figure>
