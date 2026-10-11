import type { WorkItem } from "../store/store";
import { AGENT_NAME, BATCH_SIZE } from "./models";

/**
 * The spike's fixed task set (TEMPRA-67): questions addressed to the agent and work-queue items,
 * chosen once from the base library and saved, so every arm and model sees the same items.
 */
export type TaskKind = "question" | "structure" | "stale" | "broken_link" | "lint";

export interface TaskItem {
  /** 1-based, stable: the order runs take them in. */
  n: number;
  kind: TaskKind;
  /** The concept (or a directory's index.md, for structure) the item is about. */
  path: string;
  /** A question's body, or the work item's detail. */
  detail: string;
  suggested_action?: string;
  /** A question's quoted text, when it is about one passage. */
  quote?: string;
}

export interface TaskSet {
  built_at: string;
  /** The base library's ledger head when the set was chosen and its bundle saved. */
  seq: number;
  /** Where the base library's bundle is kept (R2), which every run's copy is imported from. */
  bundle: string;
  items: TaskItem[];
}

/**
 * Questions for `@librarian` about the Tempra developers library (tempra-dev): real ones a
 * person working on Tempra would ask, each on the concept it starts from. They need the agent
 * to read beyond that one concept to answer well.
 */
export const QUESTIONS: Omit<TaskItem, "n" | "kind">[] = [
  {
    path: "agents/managed-agent.md",
    detail: `@${AGENT_NAME} The spike section lists a 5-thread loudness cap. Which other concepts in this library would have to change if the agent were allowed to edit directly instead of commenting, and why?`,
  },
  {
    path: "v2/library-maintenance.md",
    detail: `@${AGENT_NAME} Which maintenance processes would flag a concept whose description repeats its title, and where would a person see that flag?`,
  },
  {
    path: "guide.md",
    detail: `@${AGENT_NAME} Where in this library is it decided that production deploys need no approval step, and what would bring the approval back?`,
  },
  {
    path: "v2/sharing.md",
    detail: `@${AGENT_NAME} Can a member with read access comment and verify? Point me to the concept that says so.`,
  },
  {
    path: "process/workflow.md",
    detail: `@${AGENT_NAME} What has to be true before a change counts as done here, and does any decision in decisions/ contradict that?`,
  },
];

/** How many work items of each kind the set takes. */
export const WANT = { structure: 10, stale: 5, link: 5 } as const;

const rank = (a: WorkItem, b: WorkItem) =>
  b.inbound_links - a.inbound_links || a.path.localeCompare(b.path);

/**
 * The work items for the set: 10 structure, 5 stale, 5 broken-link or lint (broken links
 * first), one per path, ranked as the queue ranks them, then interleaved so each batch holds a
 * mix of kinds. Fewer are taken when the queue has fewer.
 */
export function chooseWork(queue: WorkItem[]): WorkItem[] {
  const seen = new Set<string>();
  const take = (kinds: string[], n: number) => {
    const out: WorkItem[] = [];
    for (const kind of kinds) {
      for (const w of queue.filter((i) => i.kind === kind).sort(rank)) {
        if (out.length >= n) break;
        if (seen.has(w.path)) continue;
        seen.add(w.path);
        out.push(w);
      }
    }
    return out;
  };
  const structure = take(["structure"], WANT.structure);
  const stale = take(["stale"], WANT.stale);
  const link = take(["broken_link", "lint"], WANT.link);
  // Two structure items to one of each other kind, round-robin.
  const out: WorkItem[] = [];
  while (structure.length || stale.length || link.length) {
    for (const q of [structure, stale, structure, link]) {
      const w = q.shift();
      if (w) out.push(w);
    }
  }
  return out;
}

export function buildTaskSet(
  queue: WorkItem[],
  base: { seq: number; bundle: string },
  now: Date,
): TaskSet {
  const items: TaskItem[] = [
    ...QUESTIONS.map((q) => ({ ...q, kind: "question" as const })),
    ...chooseWork(queue).map((w) => ({
      kind: w.kind as TaskKind,
      path: w.path,
      detail: w.detail,
      suggested_action: w.suggested_action,
    })),
  ].map((item, i) => ({ n: i + 1, ...item }));
  return { built_at: now.toISOString(), seq: base.seq, bundle: base.bundle, items };
}

/**
 * The batches a task set is run in, each within the thread cap: batch 1 holds the questions
 * (answered as replies, which open no thread) and the first work items; later batches, the rest.
 */
export function batches(set: TaskSet): TaskItem[][] {
  const questions = set.items.filter((i) => i.kind === "question");
  const work = set.items.filter((i) => i.kind !== "question");
  const out: TaskItem[][] = [];
  for (let i = 0; i < work.length || out.length === 0; i += BATCH_SIZE) {
    out.push([...(out.length === 0 ? questions : []), ...work.slice(i, i + BATCH_SIZE)]);
  }
  return out;
}
