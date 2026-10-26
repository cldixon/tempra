<script lang="ts">
  import { api, post } from "../api";
  import { useAction, useLoad } from "../load.svelte.ts";
  import Status from "../Status.svelte";
  import { useScrollToHash, useTitle } from "../ui.svelte.ts";
  import { choice, fromChoice, type MailPrefs } from "./account";

  /**
   * The Notifications page (take 4, board 04's sidebar): what the person is mailed.
   *
   * What the person is mailed (TEMPRA-74): what is addressed to them, batched, and an opt-in daily
   * digest; each library can follow the account or differ. Every change saves at once.
   */
  useTitle(() => "Notifications");
  const loaded = useLoad(
    () => "mail-prefs",
    () => api<MailPrefs>("/api/v1/account/notifications"),
  );
  // Mail's "Mail settings" link lands here (#notifications).
  useScrollToHash(() => loaded.state === "ready");
  const action = useAction();
  const save = (body: Record<string, unknown>) =>
    action.run(async () => {
      await post("/api/v1/account/notifications", body, "PUT");
      loaded.reload();
    });
  const KINDS = ["immediate", "digest"] as const;
</script>

<h1>Notifications</h1>
{#if action.error}<div class="notice">{action.error}</div>{/if}
<Status loaded={loaded.current}>
  {#snippet children(p)}
    <!-- Each control shows what is saved: a change is undone on screen until the reload says it held. -->
    <p>
      <label>
        <input
          type="checkbox"
          checked={p.immediate}
          disabled={action.busy}
          onchange={(e) => {
            const checked = e.currentTarget.checked;
            e.currentTarget.checked = p.immediate;
            void save({ immediate: checked });
          }}
        /> Mail me replies, mentions and new threads on what I wrote
      </label>
    </p>
    <p>
      <label>
        <input
          type="checkbox"
          checked={p.digest}
          disabled={action.busy}
          onchange={(e) => {
            const checked = e.currentTarget.checked;
            e.currentTarget.checked = p.digest;
            void save({ digest: checked });
          }}
        /> Mail me a daily digest of my libraries
      </label>
    </p>
    {#if p.libraries.length > 0}
      <div class="table-wrap">
        <table class="list">
          <thead>
            <tr>
              <th>Library</th>
              <th>Mail</th>
              <th>Digest</th>
            </tr>
          </thead>
          <tbody>
            {#each p.libraries as l (l.library)}
              <tr>
                <td class="name">{l.library}</td>
                {#each KINDS as k (k)}
                  <td>
                    <select
                      aria-label={`${k === "immediate" ? "Mail" : "Digest"} for ${l.library}`}
                      value={choice(l[k])}
                      disabled={action.busy}
                      onchange={(e) => {
                        const value = e.currentTarget.value;
                        e.currentTarget.value = choice(l[k]);
                        void save({ library: l.library, [k]: fromChoice(value) });
                      }}
                    >
                      <option value="">As above ({p[k] ? "on" : "off"})</option>
                      <option value="on">On</option>
                      <option value="off">Off</option>
                    </select>
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/snippet}
</Status>
