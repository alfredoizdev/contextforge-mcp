import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Local-only measurement of the post-compaction recall (0.13.0).
 *
 * Question it answers (raised by readers of the compaction article): after a
 * recall, does the agent actually call `memory_query` for anything older
 * than the re-injected block? Two small JSONL files under ~/.contextforge:
 *   recall-events.jsonl     one line per `contextforge-mcp recall` run
 *   recall-followups.jsonl  one line per recall that was followed by a
 *                           memory_query (same cwd) within 15 minutes
 * Nothing is uploaded. Every function here is best-effort and never throws.
 */

export const FOLLOWUP_WINDOW_MS = 15 * 60 * 1000;
export const STATS_WINDOW_DAYS = 30;
const MAX_EVENT_LINES = 5000;
/** Only the tail of the events file is scanned when matching a follow-up. */
const SCAN_TAIL_BYTES = 64 * 1024;

export interface RecallEvent {
  t: number;
  session_id?: string;
  cwd: string;
  objective: boolean;
  relevant: number;
  recent: number;
  tasks: number;
  latency_ms: number;
}

interface Followup {
  recall_t: number;
  query_t: number;
  cwd: string;
}

export interface RecallStats {
  windowDays: number;
  recalls: number;
  withObjective: number;
  withRelevant: number;
  followedUp: number;
  medianDelaySec: number | null;
}

function statsDir(homeDir: string): string {
  return join(homeDir, ".contextforge");
}
export function recallEventsFile(homeDir: string): string {
  return join(statsDir(homeDir), "recall-events.jsonl");
}
export function recallFollowupsFile(homeDir: string): string {
  return join(statsDir(homeDir), "recall-followups.jsonl");
}

function readJsonl<T>(file: string, tailBytes?: number): T[] {
  try {
    if (!existsSync(file)) return [];
    let raw = readFileSync(file, "utf-8");
    if (tailBytes && raw.length > tailBytes) {
      raw = raw.slice(raw.length - tailBytes);
      raw = raw.slice(raw.indexOf("\n") + 1); // drop the partial first line
    }
    const out: T[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as T);
      } catch {
        /* skip corrupt line */
      }
    }
    return out;
  } catch {
    return [];
  }
}

function appendLine(file: string, obj: unknown): void {
  mkdirSync(join(file, ".."), { recursive: true });
  appendFileSync(file, JSON.stringify(obj) + "\n", { mode: 0o600 });
}

/** Append one recall event; rewrite keeping the last 5,000 lines when the cap is exceeded. */
export function recordRecallEvent(homeDir: string, ev: RecallEvent): void {
  try {
    const file = recallEventsFile(homeDir);
    appendLine(file, ev);
    const raw = readFileSync(file, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim());
    if (lines.length > MAX_EVENT_LINES) {
      writeFileSync(file, lines.slice(-MAX_EVENT_LINES).join("\n") + "\n", { mode: 0o600 });
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Called by the MCP server after a successful `memory_query`. Records the
 * first query that follows the most recent recall for this cwd within the
 * 15-minute window. Returns true when a follow-up was recorded.
 */
export function recordRecallFollowup(opts: { homeDir: string; cwd: string; now: number }): boolean {
  try {
    const events = readJsonl<RecallEvent>(recallEventsFile(opts.homeDir), SCAN_TAIL_BYTES);
    let last: RecallEvent | undefined;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e && typeof e.t === "number" && e.cwd === opts.cwd) {
        last = e;
        break;
      }
    }
    if (!last) return false;
    const delta = opts.now - last.t;
    if (delta < 0 || delta > FOLLOWUP_WINDOW_MS) return false;
    const existing = readJsonl<Followup>(recallFollowupsFile(opts.homeDir), SCAN_TAIL_BYTES);
    if (existing.some((f) => f && f.recall_t === last!.t && f.cwd === opts.cwd)) return false;
    appendLine(recallFollowupsFile(opts.homeDir), { recall_t: last.t, query_t: opts.now, cwd: opts.cwd } satisfies Followup);
    return true;
  } catch {
    return false;
  }
}

export function computeRecallStats(opts: { homeDir: string; now?: number; windowDays?: number }): RecallStats {
  const now = opts.now ?? Date.now();
  const windowDays = opts.windowDays ?? STATS_WINDOW_DAYS;
  const since = now - windowDays * 24 * 3600 * 1000;
  const empty: RecallStats = { windowDays, recalls: 0, withObjective: 0, withRelevant: 0, followedUp: 0, medianDelaySec: null };
  try {
    const events = readJsonl<RecallEvent>(recallEventsFile(opts.homeDir)).filter(
      (e) => e && typeof e.t === "number" && e.t >= since && e.t <= now,
    );
    if (events.length === 0) return empty;
    const eventKeys = new Set(events.map((e) => `${e.cwd}|${e.t}`));
    const followups = readJsonl<Followup>(recallFollowupsFile(opts.homeDir)).filter(
      (f) => f && typeof f.recall_t === "number" && eventKeys.has(`${f.cwd}|${f.recall_t}`),
    );
    const delays = followups.map((f) => (f.query_t - f.recall_t) / 1000).filter((d) => d >= 0).sort((a, b) => a - b);
    let median: number | null = null;
    if (delays.length) {
      const mid = Math.floor(delays.length / 2);
      median = delays.length % 2 ? delays[mid] : (delays[mid - 1] + delays[mid]) / 2;
      median = Math.round(median);
    }
    return {
      windowDays,
      recalls: events.length,
      withObjective: events.filter((e) => e.objective).length,
      withRelevant: events.filter((e) => (e.relevant ?? 0) > 0).length,
      followedUp: followups.length,
      medianDelaySec: median,
    };
  } catch {
    return empty;
  }
}

function pct(n: number, d: number): string {
  return d === 0 ? "0%" : `${Math.round((n / d) * 100)}%`;
}

export function formatRecallStats(s: RecallStats): string {
  const lines = [
    `ContextForge recall stats (local, ~/.contextforge/recall-*.jsonl)`,
    `Recalls (last ${s.windowDays} days): ${s.recalls}`,
    `  with a session objective: ${s.withObjective} (${pct(s.withObjective, s.recalls)})`,
    `  with relevant memories: ${s.withRelevant} (${pct(s.withRelevant, s.recalls)})`,
    `  followed by memory_query within 15 min: ${s.followedUp} (${pct(s.followedUp, s.recalls)})`,
    `  median time to first query: ${s.medianDelaySec === null ? "n/a" : `${s.medianDelaySec} s`}`,
  ];
  return lines.join("\n") + "\n";
}
