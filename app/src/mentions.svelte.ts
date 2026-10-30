import { api } from "./api";
import { useLoad } from "./load.svelte.ts";
import type { Urls } from "./urls";

/**
 * The handles a comment here can mention (`.current`): the library's owner and members, then its
 * managed agent, @tempra, when it is on (TEMPRA-222). `.people` is the owner and members alone.
 */
export function useMentionable(urls: () => Urls) {
  const loaded = useLoad(
    () => `members ${urls().owner}/${urls().slug}`,
    () =>
      api<{ owner: string; members: { handle: string }[]; agents?: string[] }>(
        urls().api("members"),
      ),
  );
  const people = $derived(
    loaded.data ? [loaded.data.owner, ...loaded.data.members.map((m) => m.handle)] : [],
  );
  const all = $derived([...people, ...(loaded.data?.agents ?? [])]);
  return {
    get current(): string[] {
      return all;
    },
    get people(): string[] {
      return people;
    },
  };
}
