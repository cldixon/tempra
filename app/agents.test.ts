import { describe, expect, test } from "bun:test";
import AgentName from "./src/AgentName.svelte";
import {
  actorAgentName,
  actorLabel,
  actorText,
  actorView,
  agentLabel,
  agentNames,
  type Contributor,
  readableName,
} from "./src/agents";
import { itemLibrary, itemWho } from "./src/inbox";
import { libraryLabel } from "./src/role";
import { draw } from "./test/dom";

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
      "Claude Code for a deleted account",
    ]);
    expect(agentNames(contributors)).toEqual({
      agt_ann: "Claude for @ann",
      agt_bob: "Claude for @bob",
      agt_gone: "Claude Code for a deleted account",
    });
  });

  test("two people's Claudes with one actor are told apart; unknown ones fall back", () => {
    const names = agentNames(contributors);
    const actor = "claude-ai/connector";
    expect(actorLabel(actor, { person: "u1", agent: "agt_ann" }, names)).toBe("Claude for @ann");
    expect(actorLabel(actor, { person: "u2", agent: "agt_bob" }, names)).toBe("Claude for @bob");
    // Before `by` was kept, or an agent the list does not know yet: a name from the actor,
    // never the raw id.
    expect(actorLabel(actor, undefined, names)).toBe("Claude");
    expect(actorLabel(actor, { person: "u3", agent: "agt_new" }, names)).toBe("Claude");
    expect(actorLabel("claude-code/local", undefined, names)).toBe("Claude Code");
    // A person in the app: their handle.
    expect(actorLabel("human:ann", { person: "u1" }, names)).toBe("ann");
  });
});

// One way to name who acted (TEMPRA-131): AgentName's words, never a raw actor id.
describe("AgentName's words", () => {
  const byId = Object.fromEntries(
    contributors.filter((c) => c.agent).map((c) => [c.agent?.id as string, c]),
  );

  test("token agents' slugs read as words; names an app chose stay", () => {
    expect(readableName("claude-code")).toBe("Claude Code");
    expect(readableName("claude-ai")).toBe("Claude");
    expect(readableName("Claude")).toBe("Claude");
    expect(readableName("claude.ai")).toBe("claude.ai");
    expect(actorAgentName("claude-code/local")).toBe("Claude Code");
    expect(actorAgentName("process:nightly-export")).toBe("Nightly Export");
  });

  test("an agent for its person, a person by handle, the signed-in person as You", () => {
    const agent = actorView("claude-ai/connector", { person: "u1", agent: "agt_ann" }, byId, null);
    expect(actorText(agent)).toBe("Claude for @ann");
    expect(agent.mark).toBe("Claude");
    // Unknown to the list (its first write, arriving live): named from its actor, for nobody yet.
    const fresh = actorView("claude-code/local", { person: "u9", agent: "agt_new" }, byId, null);
    expect(actorText(fresh)).toBe("Claude Code");
    const me = actorView("human:dev", null, byId, "human:dev");
    expect(actorText(me)).toBe("You");
    expect(me.mark).toBe("dev");
    expect(actorText(actorView("human:ann", null, byId, "human:dev"))).toBe("ann");
  });

  test("words typed in the chat's page panel are the person's, in their agent's chat", () => {
    const chat = { person: "u1", agent: "agt_ann", surface: "chat" as const };
    const theirs = actorView("claude-ai/connector", chat, byId, "human:dev");
    expect(actorText(theirs)).toBe("@ann, in Claude");
    expect(theirs.agent).toBe(false);
    expect(actorText(actorView("claude-ai/connector", chat, byId, "human:ann"))).toBe(
      "You, in Claude",
    );
    expect(actorLabel("claude-ai/connector", chat, { agt_ann: "Claude for @ann" })).toBe(
      "@ann, in Claude",
    );
  });

  test("the component draws the name, then whom it acts for", () => {
    const html = (who: { name: string; for: string | null }) => {
      const { host, destroy } = draw(AgentName, { who });
      const out = host.innerHTML.replace(/<!---->/g, "");
      destroy();
      return out;
    };
    expect(html({ name: "Claude Code", for: "@dev" })).toBe(
      '<span class="agent-name"><b>Claude Code</b><span class="agent-for"> for @dev</span></span>',
    );
    expect(html({ name: "You", for: null })).toBe('<span class="agent-name"><b>You</b></span>');
  });
});

// One way to name a library (TEMPRA-131): the title, else the slug; the owner only when shared.
describe("libraryLabel", () => {
  test("own, untitled, shared", () => {
    expect(libraryLabel({ owner: "dev", slug: "acme-retail", title: "Acme Retail" })).toBe(
      "Acme Retail",
    );
    expect(libraryLabel({ owner: "dev", slug: "acme-retail" })).toBe("acme-retail");
    expect(libraryLabel({ owner: "ann", slug: "notes", title: "Notes", role: "read" })).toBe(
      "Notes (@ann)",
    );
    expect(libraryLabel({ owner: "ann", slug: "notes", role: "write" })).toBe("notes (@ann)");
  });

  test("an Inbox item's library, by whose it is", () => {
    const i = { library: "ann/notes", library_title: "Notes" };
    expect(itemLibrary(i, "ann")).toBe("Notes");
    expect(itemLibrary(i, "dev")).toBe("Notes (@ann)");
    expect(itemLibrary({ library: "dev/acme-retail", library_title: null }, "dev")).toBe(
      "acme-retail",
    );
  });

  test("an Inbox item's agent in people's words", () => {
    const item = {
      who: "claude-code/local",
      actor: "claude-code/local",
      agent: true,
      library: "dev/x",
    };
    expect(itemWho(item)).toBe("Claude Code");
    expect(itemWho({ ...item, who: "claude-code" })).toBe("Claude Code");
    expect(itemWho(item, { "dev/x claude-code/local": "Claude Code for @dev" })).toBe(
      "Claude Code for @dev",
    );
    expect(itemWho({ ...item, who: "ann", actor: "human:ann", agent: false })).toBe("ann");
  });
});
