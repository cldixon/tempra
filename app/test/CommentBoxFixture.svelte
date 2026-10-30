<script lang="ts">
  import MentionArea from "../src/MentionArea.svelte";

  /** A comment box as the comment forms use it: the text in state, what Enter sent, keys passed on. */
  let { sent, passed }: { sent: string[]; passed: string[] } = $props();
  let text = $state("");
</script>

<MentionArea
  value={text}
  onValue={(v) => (text = v)}
  people={["ann", "anton", "tempra"]}
  onSend={() => sent.push(text)}
  onkeydown={(e) => passed.push(e.key)}
/>
<output>{text}</output>
