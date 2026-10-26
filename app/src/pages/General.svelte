<script lang="ts">
  import { api, field } from "../api";
  import { useAction } from "../load.svelte.ts";
  import { librariesChanged } from "../role";
  import { useLibraries, useLibraryLabel, useRole } from "../role.svelte.ts";
  import { navigate } from "../router";
  import { useTitle } from "../ui.svelte.ts";
  import type { Urls } from "../urls";

  /**
   * General (take 4's first settings tab; TEMPRA-102): the library's title and description, which
   * the owner edits under the limits create_library enforces; a write member reads them. A read
   * member's settings are Members alone, so General sends them there.
   */
  let { urls }: { urls: Urls } = $props();
  const label = useLibraryLabel(() => urls);
  useTitle(() => `General · ${label.current}`);
  const libs = useLibraries();
  const role = useRole(() => urls);
  const action = useAction();
  let notice = $state<string | null>(null);
  $effect(() => {
    if (role.current === "read") navigate(urls.members(), { replace: true });
  });
  const lib = $derived(
    libs.data?.libraries.find((l) => l.owner === urls.owner && l.slug === urls.slug),
  );

  function save(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
    e.preventDefault();
    const form = e.currentTarget;
    const title = field(form, "title").trim();
    const description = field(form, "description").trim();
    void action.run(async () => {
      await api(urls.apiRoot(), {
        method: "PATCH",
        body: JSON.stringify({ title: title || null, description: description || null }),
      });
      notice = "Saved.";
      librariesChanged();
    });
  }
</script>

{#if role.current === null || role.current === "read"}
  <p class="muted">Loading…</p>
{:else}
  <h1>General</h1>
  {#if notice}<div class="notice ok">{notice}</div>{/if}
  {#if action.error}<div class="notice">{action.error}</div>{/if}
  {#if role.current === "owner"}
    {#key `${lib?.title}|${lib?.description}`}
      <form class="stack" onsubmit={save}>
        <p class="field">
          <label for="library-title">Title</label><input
            id="library-title"
            name="title"
            type="text"
            maxlength={120}
            defaultValue={lib?.title ?? ""}
            placeholder={urls.slug}
          />
        </p>
        <p class="field">
          <label for="library-description">Description</label><input
            id="library-description"
            name="description"
            type="text"
            maxlength={300}
            defaultValue={lib?.description ?? ""}
            placeholder="What this library is for, in one line"
          />
        </p>
        <p class="small muted">The library's address stays {urls.owner}/{urls.slug}.</p>
        <p>
          <button type="submit" class="primary" disabled={action.busy}>Save</button>
        </p>
      </form>
    {/key}
  {:else}
    <dl class="facts">
      <dt>Title</dt>
      <dd>{#if (lib?.title ?? null) !== null}{lib?.title}{:else}<span class="muted">{urls.slug}</span>{/if}</dd>
      <dt>Description</dt>
      <dd>
        {#if (lib?.description ?? null) !== null}{lib?.description}{:else}<span class="muted">None</span>{/if}
      </dd>
      <dt>Address</dt>
      <dd>{urls.owner}/{urls.slug}</dd>
    </dl>
  {/if}
{/if}
