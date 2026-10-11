import { describe, expect, test } from "bun:test";
import { actorLabel, agentLabel, agentNames, type Contributor } from "./src/agents";

// Agents named for their person wherever they show (TEMPRA-77).

const contributor = (c: Partial<Contributor>): Contributor => ({
  person: "ann",
  agent: null,
  actor: "human:ann",
  requests: 1,
  last_ts: "2026-10-11T00:00:00Z",
  ...c,
});

const contributors = [
  contributor({}),
  contributor({
    actor: "claude-ai/connector",
    agent: { id: "agt_ann", name: "Claude", platform: "claude.ai", client: null },
  }),
  contributor({
    person: "bob",
    actor: "claude-ai/connector",
    agent: { id: "agt_bob", name: "Claude", platform: "claude.ai", client: null },
  }),
  contributor({
    person: null,
    actor: "claude-code/laptop",
    agent: { id: "agt_gone", name: null, platform: null, client: null },
  }),
];

describe("agent labels", () => {
  test("each agent is named for its person; a person in the app by handle", () => {
    expect(contributors.map(agentLabel)).toEqual([
      "@ann in the app",
      "Claude for @ann",
      "Claude for @bob",
      "claude-code/laptop for a deleted account",
    ]);
    expect(agentNames(contributors)).toEqual({
      agt_ann: "Claude for @ann",
      agt_bob: "Claude for @bob",
      agt_gone: "claude-code/laptop for a deleted account",
    });
  });

  test("two people's Claudes with one actor are told apart; unknown ones fall back", () => {
    const names = agentNames(contributors);
    const actor = "claude-ai/connector";
    expect(actorLabel(actor, { person: "u1", agent: "agt_ann" }, names)).toBe("Claude for @ann");
    expect(actorLabel(actor, { person: "u2", agent: "agt_bob" }, names)).toBe("Claude for @bob");
    // Before `by` was kept, or an agent the list does not know yet: the actor.
    expect(actorLabel(actor, undefined, names)).toBe(actor);
    expect(actorLabel(actor, { person: "u3", agent: "agt_new" }, names)).toBe(actor);
    // A person in the app: their handle.
    expect(actorLabel("human:ann", { person: "u1" }, names)).toBe("ann");
  });
});
