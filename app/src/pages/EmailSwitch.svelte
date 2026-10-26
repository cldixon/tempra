<script lang="ts">
  import { api, post } from "../api";
  import { useAction, useLoad } from "../load.svelte.ts";
  import Status from "../Status.svelte";
  import type { MailPrefs } from "./account";

  /**
   * Email (TEMPRA-189; tempra-dev: v2/notifications): one switch for the mentions and replies the
   * Inbox holds, mailed in batches; invitations always mail. It saves at once, and shows what is
   * saved: a change is undone on screen until the reload says it held.
   */
  const loaded = useLoad(
    () => "mail-prefs",
    () => api<MailPrefs>("/api/v1/account/notifications"),
  );
  const action = useAction();
  const save = (email: boolean) =>
    action.run(async () => {
      await post("/api/v1/account/notifications", { email }, "PUT");
      loaded.reload();
    });
</script>

{#if action.error}<div class="notice">{action.error}</div>{/if}
<Status loaded={loaded.current}>
  {#snippet children(p)}
    <p>
      <label>
        <input
          type="checkbox"
          checked={p.email}
          disabled={action.busy}
          onchange={(e) => {
            const checked = e.currentTarget.checked;
            e.currentTarget.checked = p.email;
            void save(checked);
          }}
        /> Email me mentions and replies
      </label>
    </p>
    <p class="small muted">Invitations are always emailed.</p>
  {/snippet}
</Status>
