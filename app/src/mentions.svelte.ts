import { api } from "./api";
import { useLoad } from "./load.svelte.ts";
import type { Urls } from "./urls";

/** The handles a comment here can mention: the library's owner and members. `.current`. */
export function useMentionable(urls: () => Urls) {
  const loaded = useLoad(
    () => `members ${urls().owner}/${urls().slug}`,
    () => api<{ owner: string; members: { handle: string }[] }>(urls().api("members")),
  );
  const people = $derived(
    loaded.data ? [loaded.data.owner, ...loaded.data.members.map((m) => m.handle)] : [],
  );
  return {
    get current(): string[] {
      return people;
    },
  };
}
