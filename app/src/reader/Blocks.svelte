<script lang="ts">
  /**
   * Blocks of a body as body.ts describes them (tempra-dev: app/reader): the stored tree drawn as
   * elements, with nothing parsed and no HTML injected. Blocks are keyed by their IDs, so a block a
   * new version leaves alone keeps its DOM nodes, and the highlights and selection over them.
   *
   * Inline content is written with no whitespace between elements: the DOM's text inside a
   * `data-text` element must read exactly as the document's text (dom.ts counts it).
   */
  import CodeBlock from "./CodeBlock.svelte";
  import Caption from "./Caption.svelte";
  import FigureBox from "./FigureBox.svelte";
  import FigureOf from "./FigureOf.svelte";
  import FromHosts from "./FromHosts.svelte";
  import InlineImage from "./InlineImage.svelte";
  import type { Block, Inline } from "./body";
  import { figureNumber } from "./figure";
  import { code, node as nodeBlocks } from "./registry";

  let { blocks: list }: { blocks: Block[] } = $props();
</script>

{#snippet inline(nodes: Inline[])}
  {#each nodes as x}
    {#if typeof x === "string"}
      {x}
    {:else if x.k === "ins"}
      <!-- Spoken, not counted: outside the text (C-28). -->
      <ins class="diff-added"><span class="visually-hidden" data-skip="">{"added: "}</span>{x.text}</ins>
    {:else if x.k === "del"}
      <del class="diff-removed" data-skip=""><span class="visually-hidden">{"removed: "}</span>{x.text}</del>
    {:else if x.k === "code"}
      <code>{@render inline(x.kids)}</code>
    {:else if x.k === "strong"}
      <strong>{@render inline(x.kids)}</strong>
    {:else if x.k === "em"}
      <em>{@render inline(x.kids)}</em>
    {:else if x.k === "s"}
      <s>{@render inline(x.kids)}</s>
    {:else if x.k === "span"}
      <span>{@render inline(x.kids)}</span>
    {:else if x.k === "gap"}
      <span class="figure-gap">{@render inline(x.kids)}</span>
    {:else if x.k === "br"}
      <br data-atom="" />
    {:else if x.k === "a"}
      <a href={x.href} title={x.title} rel={x.rel} class={x.cls} data-path={x.path}
        >{@render inline(x.kids)}</a
      >
    {:else if x.k === "figure"}
      <FigureOf figure={x.figure} />
    {:else if x.k === "cell"}
      <span class="figure-cell"
        ><FigureOf figure={x.figure} />{#if x.label}<span class="figure-label" data-skip=""
            >{x.label}</span
          >{/if}</span
      >
    {:else if x.k === "dropped"}
      <span class="image-dropped" data-atom="">{x.alt}</span>
    {:else if x.k === "media"}
      <!-- Video, audio or a PDF in running text: a link to its page, named by its alt text. -->
      <a href={x.href} data-atom="">{x.text}</a>
    {:else if x.k === "img"}
      <InlineImage source={x.source} alt={x.alt} title={x.title} host={x.host} />
    {:else if x.k === "fn"}
      <!-- Spoken as "footnote 2" (C-28); the atom counts one whatever it says. -->
      <sup class="fnref" data-atom="" data-label={x.label}
        >{#if x.href === null}{x.mark}{:else}<a href={x.href} aria-label={`footnote ${x.mark}`}
            >{x.mark}</a
          >{/if}</sup
      >
    {:else if x.k === "raw"}
      <!-- Raw HTML, reference links and images: their markdown, never rendered. -->
      <code class="raw" data-atom="">{x.text}</code>
    {/if}
  {/each}
{/snippet}

{#snippet blocks(nodes: Block[])}
  {#each nodes as b}
    {#if b.kind === "p"}
      <p data-block={b.id} data-text={b.offset}>{@render inline(b.text)}</p>
    {:else if b.kind === "figure"}
      <figure class="figure" data-block={b.id}
        ><p data-text={b.offset}>{@render inline(b.text)}</p><Caption figure={b.figure} /></figure
      >
    {:else if b.kind === "heading"}
      <svelte:element
        this={`h${b.depth}`}
        id={b.anchor}
        data-block={b.id}
        data-text={b.offset}
        hidden={b.hidden || undefined}>{@render inline(b.text)}</svelte:element
      >
    {:else if b.kind === "blockquote"}
      <blockquote data-block={b.id}>{@render blocks(b.blocks)}</blockquote>
    {:else if b.kind === "list"}
      {#if b.ordered}
        <ol data-block={b.id} start={b.start} class={b.cls}>{@render items(b.items)}</ol>
      {:else}
        <ul data-block={b.id} class={b.cls}>{@render items(b.items)}</ul>
      {/if}
    {:else if b.kind === "code"}
      {@const C = (b.lang && code[b.lang]) || CodeBlock}
      {#snippet codeText()}{@render inline(b.text)}{/snippet}
      <C node={b.node} id={b.id} offset={b.offset} text={codeText} figure={b.figure} />
    {:else if b.kind === "custom"}
      {@const C = nodeBlocks[b.type]}
      {#snippet customText()}{#if b.text}{@render inline(b.text)}{/if}{/snippet}
      {#if C}<C node={b.node} id={b.id} offset={b.offset} text={b.text ? customText : null} />{/if}
    {:else if b.kind === "hr"}
      <hr data-block={b.id} />
    {:else if b.kind === "table"}
      <div class="table" data-block={b.id}
        ><table
          >{#if b.head}<thead
              ><tr
                >{#each b.head as c}<th data-text={c.offset} data-align={c.align}
                    >{@render inline(c.text)}</th
                  >{/each}</tr
              ></thead
            >{/if}{#if b.rows.length > 0}<tbody
              >{#each b.rows as row}<tr
                  >{#each row as c}<td data-text={c.offset} data-align={c.align}
                      >{@render inline(c.text)}</td
                    >{/each}</tr
                >{/each}</tbody
            >{/if}</table
        ></div
      >
    {:else if b.kind === "markup"}
      <FigureBox spec={b.spec} count={b.count} block={b.id}
        >{#each b.rows as row (row.key)}<p
            class={row.group ? "figure-row" : undefined}
            data-block={row.id}
            data-text={row.offset}>{@render inline(row.text)}</p
          >{/each}<figcaption data-skip="" data-block={b.labelId}
          ><span class="figure-number">{figureNumber(b.number, b.count)}</span
          >{#if b.caption}{" "}{#if typeof b.caption === "string"}{b.caption}{:else}{@render inline(
                b.caption,
              )}{/if}{/if}<FromHosts figures={b.figures} /></figcaption
        ></FigureBox
      >
    {:else if b.kind === "directive"}
      <div class="directive" data-block={b.id}
        ><p class="raw-fence" data-skip="" data-block={b.labelId}
          ><code class="raw">{b.open}</code></p
        >{@render blocks(b.blocks)}<p class="raw-fence" data-skip=""
          ><code class="raw">{b.close}</code></p
        ></div
      >
    {:else if b.kind === "div"}
      <div data-block={b.id}>{@render blocks(b.blocks)}</div>
    {:else if b.kind === "raw"}
      <!-- Raw HTML blocks and definitions: their markdown, as code, never rendered. -->
      <pre class="raw" data-block={b.id}><code>{b.text}</code></pre>
    {/if}
  {/each}
{/snippet}

{#snippet items(list: Extract<Block, { kind: "list" }>["items"])}
  {#each list as item (item.key)}
    <li data-block={item.id} class={item.checked !== null ? "task" : undefined}
      >{#if item.checked !== null}<input
          type="checkbox"
          checked={item.checked}
          disabled
          aria-label="Done"
          readonly
        />{/if}{@render blocks(item.blocks)}</li
    >
  {/each}
{/snippet}

{@render blocks(list)}
