/**
 * Scenarios for scripted agents (runner.ts). Each works in a scratch directory of its own,
 * `_agents/<run>/`, checks what it expects, and deletes its files at the end unless asked to
 * keep them (the ledger keeps every event).
 */
import type { Agent, CallResult, FeedWatch } from "./runner";

export interface ScenarioContext {
  agents: Agent[];
  feed: FeedWatch;
  /** The scratch directory, e.g. `_agents/1791150000000`. */
  dir: string;
  /** Waits the configured pace between steps (0 for full speed). */
  pace(): Promise<void>;
  /** How many rounds or writes per agent the run asked for. */
  rounds: number;
  /** Records a write, so its feed delivery can be measured. */
  wrote(r: CallResult): void;
  /** Files the run created (and where they are now), for the clean-up. */
  files: Set<string>;
  /** Records a check; a false one fails the run. */
  check(ok: boolean, what: string): void;
  log(line: string): void;
  /** The UI page for a library path, for people watching. */
  page(path: string): string;
}

export interface Scenario {
  name: string;
  description: string;
  /** The fewest agents it needs. */
  minAgents: number;
  run(ctx: ScenarioContext): Promise<void>;
}

const concept = (title: string, body: string) =>
  `---\ntype: Agent Memo\ntitle: ${title}\ndescription: Written by scripted agents.\nstatus: draft\n---\n${body}\n`;

/** A write, recorded for the feed measurement. */
async function write(ctx: ScenarioContext, agent: Agent, args: Record<string, unknown>) {
  const r = await agent.call("write", args);
  ctx.wrote(r);
  if (r.ok) ctx.files.add(String(args.path));
  return r;
}

async function move(ctx: ScenarioContext, agent: Agent, from: string, to: string, note: string) {
  const r = await agent.call("move", { from, to, note });
  if (r.ok) {
    ctx.files.delete(from);
    ctx.files.add(to);
  }
  return r;
}

async function edit(ctx: ScenarioContext, agent: Agent, args: Record<string, unknown>) {
  const r = await agent.call("edit", args);
  ctx.wrote(r);
  return r;
}

export const SCENARIOS: Scenario[] = [
  {
    name: "edit-race",
    description:
      "Two agents read the same version and both edit it: the second is refused as stale, re-reads, retries, and both changes survive.",
    minAgents: 2,
    async run(ctx) {
      const [a, b] = ctx.agents as [Agent, Agent];
      const path = `${ctx.dir}/race.md`;
      const created = await write(ctx, a, {
        path,
        content: concept("Race", "Alpha one.\n\nBeta one."),
        note: "edit-race: create",
      });
      ctx.check(created.ok, `${a.name} creates ${path}`);
      const seen = await a.hashOf(path);
      ctx.check(seen === (await b.hashOf(path)), "both agents read the same version");
      await ctx.pace();

      const first = await edit(ctx, a, {
        path,
        edits: [{ old: "Alpha one.", new: "Alpha two." }],
        if_match: seen,
        note: "edit-race: alpha",
      });
      ctx.check(first.ok, `${a.name}'s edit lands`);
      await ctx.pace();

      const stale = await b.call("edit", {
        path,
        edits: [{ old: "Beta one.", new: "Beta two." }],
        if_match: seen,
        note: "edit-race: beta (stale)",
      });
      ctx.check(!stale.ok, `${b.name}'s edit on the old version is refused`);

      const fresh = await b.hashOf(path);
      const retry = await edit(ctx, b, {
        path,
        edits: [{ old: "Beta one.", new: "Beta two." }],
        if_match: fresh,
        note: "edit-race: beta (retried)",
      });
      ctx.check(retry.ok, `${b.name}'s retry on the new version lands`);

      const final = await a.call("read", { path });
      ctx.check(
        final.text.includes("Alpha two.") && final.text.includes("Beta two."),
        "both changes are in the concept",
      );
    },
  },
  {
    name: "live",
    description:
      "Agents take turns adding to one concept at the run's pace, and one moves a file away and back: open the printed page to watch it live.",
    minAgents: 1,
    async run(ctx) {
      const path = `${ctx.dir}/live.md`;
      const [first] = ctx.agents as [Agent];
      const created = await write(ctx, first, {
        path,
        content: concept("Live", "Agents add lines here."),
        note: "live: create",
      });
      ctx.check(created.ok, `${first.name} creates ${path}`);
      const side = `${ctx.dir}/side.md`;
      await write(ctx, first, {
        path: side,
        content: concept("Side", "Moved around."),
        note: "live: side",
      });
      ctx.log(`watch it: ${ctx.page(path)}`);
      await ctx.pace();

      let last = "Agents add lines here.";
      for (let round = 1; round <= ctx.rounds; round++) {
        for (const agent of ctx.agents) {
          const line = `${agent.name}, round ${round}.`;
          const r = await edit(ctx, agent, {
            path,
            edits: [{ old: last, new: `${last}\n\n${line}` }],
            if_match: await agent.hashOf(path),
            note: `live: ${agent.name} round ${round}`,
          });
          ctx.check(r.ok, `${agent.name} adds round ${round}`);
          last = line;
          await ctx.pace();
        }
      }

      const mover = ctx.agents[ctx.agents.length - 1] as Agent;
      const away = `${ctx.dir}/moved/side.md`;
      ctx.check((await move(ctx, mover, side, away, "live: move away")).ok, "move away");
      await ctx.pace();
      ctx.check((await move(ctx, mover, away, side, "live: move back")).ok, "move back");

      const final = await first.call("read", { path });
      ctx.check(
        ctx.agents.every((a) => final.text.includes(`${a.name}, round ${ctx.rounds}.`)),
        "every agent's last line is there",
      );
    },
  },
  {
    name: "load",
    description:
      "Every agent writes and then edits its own concepts, all at once with no pacing: latency and feed delivery under load.",
    minAgents: 1,
    async run(ctx) {
      await Promise.all(
        ctx.agents.map(async (agent) => {
          for (let i = 1; i <= ctx.rounds; i++) {
            const path = `${ctx.dir}/${agent.name}/c${i}.md`;
            const w = await write(ctx, agent, {
              path,
              content: concept(`${agent.name} ${i}`, `Note ${i} from ${agent.name}.`),
              note: `load: ${agent.name} ${i}`,
            });
            ctx.check(w.ok, `${agent.name} writes ${path}`);
            if (!w.hash) continue;
            const e = await edit(ctx, agent, {
              path,
              edits: [{ old: `Note ${i}`, new: `Edited note ${i}` }],
              if_match: w.hash,
              note: `load: ${agent.name} ${i} edit`,
            });
            ctx.check(e.ok, `${agent.name} edits ${path}`);
          }
        }),
      );
    },
  },
];

/** Deletes the files a run created, as the given agent. */
export async function cleanUp(agent: Agent, files: Iterable<string>) {
  let n = 0;
  for (const path of files) {
    const hash = await agent.hashOf(path).catch(() => null);
    if (hash && (await agent.call("delete", { path, if_match: hash, note: "agents: clean up" })).ok)
      n++;
  }
  return n;
}
