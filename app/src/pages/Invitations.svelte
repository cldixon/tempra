<script lang="ts">
  import { api } from "../api";
  import Avatar from "../Avatar.svelte";
  import { useAction, useLoad } from "../load.svelte.ts";
  import Moment from "../Moment.svelte";
  import Status from "../Status.svelte";
  import { day } from "../ui";
  import { useTitle } from "../ui.svelte.ts";
  import { Urls } from "../urls";
  import type { PendingInvitation } from "./account";

  /** Invitations to other people's libraries (tempra-dev: v2/sharing), to accept or decline. */
  useTitle(() => "Invitations");
  const loaded = useLoad(
    () => "invitations",
    () => api<{ invitations: PendingInvitation[] }>("/api/v1/invitations"),
  );
  const action = useAction();
  const answer = (i: PendingInvitation, accept: boolean) =>
    action.run(async () => {
      await api(
        `/api/v1/invitations/${encodeURIComponent(i.id)}/${accept ? "accept" : "decline"}`,
        {
          method: "POST",
        },
      );
      if (accept) {
        // A full load: the library list and the workspace learn the new library.
        location.assign(new Urls(i.owner, i.slug).tree(""));
        return;
      }
      loaded.reload();
    });
</script>

<h1>Invitations</h1>
{#if action.error}<div class="notice">{action.error}</div>{/if}
<Status loaded={loaded.current}>
  {#snippet children({ invitations })}
    {#if invitations.length === 0}
      <p>None waiting.</p>
    {:else}
      <ul class="invitations">
        {#each invitations as i (i.id)}
          <li class="invitation">
            <p class="invitation-from">
              <Avatar name={i.handle} /><span
                >@{i.handle} invited you{#if i.created}{" · "}<Moment ts={i.created} />{/if}</span
              >
            </p>
            <div class="invitation-card">
              <!-- The library's tile (Sidebar's LibraryTile): its initial, round for a shared one. -->
              <span class="lib-tile shared" aria-hidden="true">{(i.slug.trim()[0] ?? "?").toUpperCase()}</span
              ><div class="invitation-library">
                <strong>{i.owner}/{i.slug}</strong><span>Open until {day(i.expires)}</span>
              </div>
            </div>
            <p class="invitation-access">
              <span>Your access</span>{i.role === "write" ? "Can read and write" : "Can read and comment"}
            </p>
            <p class="actions">
              <button type="button" class="primary" disabled={action.busy} onclick={() => void answer(i, true)}
                >Accept</button
              ><button type="button" disabled={action.busy} onclick={() => void answer(i, false)}>Decline</button>
            </p>
          </li>
        {/each}
      </ul>
    {/if}
  {/snippet}
</Status>
