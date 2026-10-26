<script lang="ts">
  import { untrack } from "svelte";
  import { api, field } from "../api";
  import ConfirmDialog from "../ConfirmDialog.svelte";
  import { useConfirm } from "../confirm.svelte.ts";
  import { useAction, useLoad } from "../load.svelte.ts";
  import Moment from "../Moment.svelte";
  import Status from "../Status.svelte";
  import ThemeChoice from "../ThemeChoice.svelte";
  import { useTheme } from "../theme.svelte.ts";
  import { localTime } from "../ui";
  import { useTitle } from "../ui.svelte.ts";
  import { type AccountData, DONE, LEGAL, post } from "./account";

  /** The account: email, handle, limits, sessions, deleting it (v2 spec: Accounts). */
  let { done }: { done: string | null } = $props();
  useTitle(() => "Account");
  const loaded = useLoad(
    () => "account",
    () => api<AccountData>("/api/v1/account"),
  );
  const action = useAction();
  // The page opened from a link that says what was done (`?done=`): said once, as React's initial state was.
  let notice = $state<string | null>(untrack(() => (done ? (DONE[done] ?? null) : null)));
  let devLink = $state<string | null>(null);
  let deleted = $state(false);
  const c = useConfirm();
  /** The theme (take 4): System, Light or Dark, applied at once and saved on the account. */
  const theme = useTheme();
  /** The handle a confirmation is about: the new one and the one it replaces. */
  let renaming = $state.raw<{ handle: string; current: string }>({ handle: "", current: "" });

  function changeEmail(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
    e.preventDefault();
    const email = field(e.currentTarget, "email");
    void action.run(async () => {
      const res = await api<{ sent_to: string; dev_link?: string }>("/api/v1/account/email", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      notice = `Check ${res.sent_to} for a link, and open it while signed in as you are now.`;
      devLink = res.dev_link ?? null;
    });
  }
  function changeHandle(e: SubmitEvent & { currentTarget: HTMLFormElement }, current: string) {
    e.preventDefault();
    const handle = field(e.currentTarget, "handle").replace(/^@/, "");
    if (handle.toLowerCase() === current.toLowerCase()) return;
    renaming = { handle, current };
    c.confirm({
      title: `Change your handle to @${handle}?`,
      body: handleBody,
      action: "Change handle",
      run: () =>
        action.run(async () => {
          await post("/api/v1/account/handle", { handle }, "PUT");
          // A full load: the header and every library link follow the new handle.
          location.assign("/account");
        }),
    });
  }
  const endSession = (id: string) =>
    action.run(async () => {
      await api(`/api/v1/account/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      loaded.reload();
    });
  function remove(e: SubmitEvent & { currentTarget: HTMLFormElement }) {
    e.preventDefault();
    const confirm = field(e.currentTarget, "confirm");
    void action.run(async () => {
      await post("/api/v1/account/delete", { confirm });
      deleted = true;
    });
  }
</script>

{#snippet handleBody()}
  <p>
    Every one of your libraries moves to a new address under /{renaming.handle}/, and links to the
    old ones stop working.
  </p>
  <p>@{renaming.current} is held for 90 days, then anyone may take it.</p>
{/snippet}

{#if deleted}
  <h1>Account deleted</h1>
  <p>
    <a href={LEGAL}>tempra.dev</a>
  </p>
{:else}
  <h1>Account</h1>
  <ConfirmDialog asking={c} />
  {#if notice}<div class="notice ok">{notice}</div>{/if}
  {#if devLink}
    <p>
      Local dev, no email sent: <a id="dev-link" href={devLink}>confirm the new email</a>
    </p>
  {/if}
  {#if action.error}<div class="notice">{action.error}</div>{/if}
  <Status loaded={loaded.current}>
    {#snippet children(a)}
      <form onsubmit={changeEmail}>
        <p>
          <label>
            Email
            <input type="email" name="email" autocomplete="email" defaultValue={a.email} required />
          </label>
          <button type="submit" disabled={action.busy}>Change</button>
        </p>
      </form>
      <form onsubmit={(e) => changeHandle(e, a.handle)}>
        <p>
          <label>
            Handle <input type="text" name="handle" defaultValue={a.handle} required />
          </label>
          <button type="submit" disabled={action.busy}>Change</button>
        </p>
      </form>
      <p class="small muted">Your handle is in every library's address.</p>
      <h2>Limits</h2>
      <p>
        Libraries: {a.usage.libraries} of {a.limits.libraries}. Active tokens:
        {a.usage.tokens} of {a.limits.tokens}.
      </p>
      <h2>Appearance</h2>
      <p class="field-row">
        <span>Theme</span><ThemeChoice value={theme.current} onChange={theme.choose} />
      </p>
      <h2>Sessions</h2>
      <div class="table-wrap">
        <table class="list">
          <thead>
            <tr>
              <th>Started</th>
              <th>Last seen</th>
              <th>Device</th>
              <th>
                <span class="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {#each a.sessions as s (s.id)}
              <tr>
                <td class="when">{localTime(s.created)}</td>
                <td class="when">
                  <Moment ts={s.last_seen} />
                </td>
                <td class="small muted">{s.user_agent ?? ""}</td>
                <td>
                  {#if s.current}this device{:else}<button
                      type="button"
                      disabled={action.busy}
                      onclick={() => void endSession(s.id)}>Sign out</button
                    >{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <!-- Signing out stays a server form: it must work whatever state the app is in. -->
      <div class="actions">
        <form method="post" action="/sign-out">
          <button type="submit">Sign out</button>
        </form>
        <form method="post" action="/sign-out/everywhere">
          <button type="submit">Sign out everywhere</button>
        </form>
      </div>
      <h2>Delete account</h2>
      <p>Deletes every library you own. Export them first.</p>
      <form onsubmit={remove}>
        <p>
          <label>
            Type {a.handle} to confirm
            <input type="text" name="confirm" autocomplete="off" required />
          </label>
        </p>
        <p>
          <button type="submit" disabled={action.busy}>Delete account</button>
        </p>
      </form>
      <p>
        <a href={`${LEGAL}/terms`}>Terms</a> · <a href={`${LEGAL}/privacy`}>Privacy</a>
      </p>
    {/snippet}
  </Status>
{/if}
