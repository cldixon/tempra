import { copyText } from "./tools";

/** "Copied" for a moment after a copy, or what went wrong. */
export function useCopied() {
  let state = $state<"idle" | "copied" | "failed">("idle");
  $effect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => {
      state = "idle";
    }, 2000);
    return () => clearTimeout(t);
  });
  return {
    get state() {
      return state;
    },
    run: (text: () => Promise<string>) =>
      copyText(text).then(
        () => {
          state = "copied";
        },
        () => {
          state = "failed";
        },
      ),
  };
}
