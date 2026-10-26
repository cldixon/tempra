<script lang="ts">
  import CopyField from "../CopyField.svelte";

  /**
   * How to connect each kind of client; `slug` names the library when the page is about one, and
   * `library` (owner/slug) picks it in the token form.
   */
  let props: {
    slug?: string;
    library?: string;
    /** On the Agents page, New token opens its dialog there. */
    onNewToken?: () => void;
  } = $props();
  const mcp = `${location.origin}/mcp`;
</script>

<h2>claude.ai</h2>
<p>
  Add a custom connector with this URL. When asked, {props.slug
    ? `choose All libraries, or select ${props.slug}`
    : "choose All libraries, or select the ones it may use"}.
</p>
<p>
  <CopyField value={mcp} label="the MCP URL" />
</p>
<h2>Claude Code</h2>
<p>
  <CopyField value={`claude mcp add --transport http tempra ${mcp}`} label="the Claude Code command" />
</p>
<p>Then run /mcp in Claude Code to sign in.</p>
<h2>Other clients and scripts</h2>
<p>
  {#if props.onNewToken}
    <button type="button" onclick={props.onNewToken}>New token</button>
  {:else}
    <a
      href={props.library
        ? `/agents?new=token&library=${encodeURIComponent(props.library)}`
        : "/agents?new=token"}>New token</a
    >
  {/if}
</p>
