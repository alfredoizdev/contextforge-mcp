import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from "fs";
import { join, basename } from "path";
import { spawnSync } from "child_process";
import { ApiClient, readProjectLinkConfig } from "./api-client.js";
import { sessionsDir } from "./objective-hook.js";

/** Exact hook command written by `init`. Keep in sync with README. */
export const RECALL_COMMAND = "npx -y contextforge-mcp recall";

interface McpServersFile {
  mcpServers?: Record<string, { env?: Record<string, string> }>;
}

/**
 * Read CONTEXTFORGE_API_KEY from an MCP-servers style JSON file
 * (`~/.claude.json` or a project `.mcp.json`). Prefers the server named
 * exactly `contextforge`; otherwise the first server whose name starts with
 * `contextforge`. Never throws.
 */
export function readMcpServerKey(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as McpServersFile;
    const servers = parsed.mcpServers ?? {};
    const exact = servers["contextforge"]?.env?.CONTEXTFORGE_API_KEY;
    if (exact) return exact;
    for (const [name, server] of Object.entries(servers)) {
      if (name.startsWith("contextforge")) {
        const key = server?.env?.CONTEXTFORGE_API_KEY;
        if (key) return key;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the API key for the recall hook. The hook runs as a shell command,
 * so the MCP server's env vars are NOT in scope; we look where
 * `claude mcp add` stores them.
 *
 * Order: env var → ~/.claude.json → <cwd>/.mcp.json.
 */
export function resolveApiKey(opts: {
  env: NodeJS.ProcessEnv;
  homeDir: string;
  cwd: string;
}): string | undefined {
  if (opts.env.CONTEXTFORGE_API_KEY) return opts.env.CONTEXTFORGE_API_KEY;
  return (
    readMcpServerKey(join(opts.homeDir, ".claude.json")) ??
    readMcpServerKey(join(opts.cwd, ".mcp.json"))
  );
}

export interface RecallItem {
  /** Present on real API responses; used to dedupe against relevant hits. */
  id?: string;
  title: string;
  content_preview: string;
  space: string;
  created_at: string;
}

/** A memory surfaced by semantic search for the current work (0.13.0). */
export interface RelevantItem {
  id?: string;
  title: string;
  preview: string;
  space?: string;
}

export const RECALL_MAX_RELEVANT = 5;
/** Stricter than the API default (0.35) to keep the block short. */
export const RECALL_RELEVANT_MIN_SCORE = 0.4;
const RECALL_QUERY_LIMIT = 8;
/** Session logs older than this are deleted on each recall (best-effort). */
const SESSION_LOG_RETENTION_MS = 14 * 24 * 3600 * 1000;
const SESSION_PRUNE_MAX_FILES = 200;

export interface RecallTask {
  short_id?: string;
  title: string;
  priority?: string;
  due_date?: string | null;
}

export const RECALL_MAX_ITEMS = 10;
export const RECALL_MAX_TASKS = 5;
const PREVIEW_MAX = 160;

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_MAX ? flat.slice(0, PREVIEW_MAX).trimEnd() + "…" : flat;
}

/**
 * Plain-text block Claude Code appends to the model context after a
 * compaction. Pure function; returns "" when there is nothing to show.
 */
export function formatRecall(input: {
  projectName: string;
  items: RecallItem[];
  tasks: RecallTask[];
  /** 0.13.0 — the user's first real request in this session, already cut to 300 chars. */
  objective?: string;
  /** 0.13.0 — the latest real request before the compaction, if different. */
  latest?: string;
  /** 0.13.0 — memories relevant to the current work, best first. */
  relevant?: RelevantItem[];
  /** 0.13.0 — shown in the "Relevant" header when git signals were available. */
  gitSummary?: { branch: string; changedFiles: number } | null;
}): string {
  const items = input.items.slice(0, RECALL_MAX_ITEMS);
  const tasks = input.tasks.slice(0, RECALL_MAX_TASKS);
  const relevant = (input.relevant ?? []).slice(0, RECALL_MAX_RELEVANT);
  const objective = input.objective ? flattenCut(input.objective, OBJECTIVE_MAX_CHARS) : "";
  const latest = input.latest ? flattenCut(input.latest, OBJECTIVE_MAX_CHARS) : "";
  if (items.length === 0 && tasks.length === 0 && relevant.length === 0 && !objective) return "";

  const lines: string[] = [];
  lines.push("## ContextForge: context restored after compaction");
  lines.push(
    `The conversation was just compacted. These are the most recent saved memories for project "${input.projectName}". Treat them as current decisions.`,
  );
  if (objective) {
    lines.push("");
    lines.push(`Session objective (the user's first request): "${objective}"`);
    if (latest && latest !== objective) lines.push(`Latest request before compaction: "${latest}"`);
  }
  if (relevant.length > 0) {
    lines.push("");
    const g = input.gitSummary;
    const header = g && g.branch
      ? `Relevant to current work (branch ${g.branch}, ${g.changedFiles} changed file${g.changedFiles === 1 ? "" : "s"}):`
      : "Relevant to current work:";
    lines.push(header);
    for (const r of relevant) {
      const preview = oneLine(r.preview || "");
      const space = r.space ? `[${r.space}] ` : "";
      lines.push(`- ${space}${oneLine(r.title)}${preview ? ` — ${preview}` : ""}`);
    }
  }
  if (items.length > 0) {
    lines.push("");
    lines.push("Recent memories:");
    for (const it of items) {
      const preview = oneLine(it.content_preview || "");
      lines.push(`- [${it.space}] ${oneLine(it.title)}${preview ? ` — ${preview}` : ""}`);
    }
  }
  if (tasks.length > 0) {
    lines.push("");
    lines.push("Pending tasks:");
    for (const t of tasks) {
      const due = t.due_date ? `due ${t.due_date.slice(0, 10)}` : undefined;
      const meta = [t.priority, due].filter(Boolean).join(", ");
      const id = t.short_id ? `[${t.short_id}] ` : "";
      lines.push(`- ${id}${oneLine(t.title)}${meta ? ` (${meta})` : ""}`);
    }
  }
  lines.push("");
  lines.push("For anything older or more specific, call memory_query before answering.");
  return lines.join("\n") + "\n";
}

export const DEFAULT_API_URL = "https://byzngcpqiqmqpxpmnhmo.supabase.co";
export const RECALL_TIMEOUT_MS = 8000;

export interface RecallClient {
  listSpaces(
    projectId?: string,
    spaceType?: "regular" | "git" | "all",
  ): Promise<Array<{ id: string; name: string }>>;
  listItems(spaceId?: string, limit?: number): Promise<{ items: RecallItem[] }>;
  listTasks(input: { status?: string; limit?: number }): Promise<{ issues: RecallTask[] }>;
  /** 0.13.0 — semantic search; optional so older fakes keep working. */
  query?(input: {
    query: string;
    project_id?: string;
    limit?: number;
    min_score?: number;
  }): Promise<{ results?: Array<{ id: string; title?: string; content: string; score: number }> }>;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("recall timeout")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Fetch and format the post-compaction context block. Never rejects; any
 * failure resolves to "" so the hook can never break a session.
 *
 * 0.13.0: also restores the session objective (from the UserPromptSubmit
 * hook log) and adds memories relevant to the current work (semantic search
 * over objective + git signals). Each addition degrades independently to
 * the 0.12.0 behavior.
 */
export async function runRecall(opts: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  timeoutMs?: number;
  makeClient?: (apiKey: string, apiUrl: string) => RecallClient;
  /** Claude Code session id from the hook's stdin JSON (0.13.0). */
  sessionId?: string;
  /** Injectable for tests; defaults to collectGitSignals. */
  collectGit?: (cwd: string) => GitSignals | null;
}): Promise<string> {
  try {
    const apiKey = resolveApiKey({ env: opts.env, homeDir: opts.homeDir, cwd: opts.cwd });
    if (!apiKey) return "";

    const link = readProjectLinkConfig(opts.cwd);
    if (!link?.project_id) return "";

    const apiUrl = opts.env.CONTEXTFORGE_API_URL || DEFAULT_API_URL;
    const client =
      opts.makeClient?.(apiKey, apiUrl) ??
      (new ApiClient({ apiKey, apiUrl }) as unknown as RecallClient);

    // --- local signals (sync, bounded, each optional) ---------------------
    let objective: string | undefined;
    let latest: string | undefined;
    try {
      const file = findSessionFile({ homeDir: opts.homeDir, sessionId: opts.sessionId, cwd: opts.cwd });
      if (file) ({ objective, latest } = selectObjective(readSessionPrompts(file)));
    } catch {
      objective = undefined;
      latest = undefined;
    }
    let git: GitSignals | null = null;
    try {
      git = (opts.collectGit ?? collectGitSignals)(opts.cwd);
    } catch {
      git = null;
    }
    const workingContext = buildWorkingContext({ objective, latest, git });
    pruneSessionFiles(opts.homeDir);

    const work = (async () => {
      // The `items` endpoint filters by space_id only (no project_id), and the
      // account-wide newest 50 may all belong to other projects. So ask each
      // of this project's spaces for its newest items, in parallel, then merge.
      const recentP = client.listSpaces(link.project_id, "regular").then((spaces) =>
        Promise.all(
          spaces.map((s) =>
            client
              .listItems(s.id, RECALL_MAX_ITEMS)
              .then((r) => r.items ?? [])
              .catch(() => [] as RecallItem[]),
          ),
        ),
      );

      const tasksP = client
        .listTasks({ status: "pending", limit: RECALL_MAX_TASKS })
        .then((res) => res.issues ?? [])
        .catch(() => [] as RecallTask[]);

      const relevantP: Promise<RelevantItem[]> =
        workingContext && typeof client.query === "function"
          ? client
              .query({
                query: workingContext,
                project_id: link.project_id,
                limit: RECALL_QUERY_LIMIT,
                min_score: RECALL_RELEVANT_MIN_SCORE,
              })
              .then((res) =>
                (res?.results ?? [])
                  .filter((r) => r && typeof r.content === "string")
                  .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
                  .slice(0, RECALL_MAX_RELEVANT)
                  .map((r) => ({ id: r.id, title: r.title || oneLine(r.content), preview: r.content })),
              )
              .catch(() => [] as RelevantItem[])
          : Promise.resolve([] as RelevantItem[]);

      const [perSpace, tasks, relevant] = await Promise.all([recentP, tasksP, relevantP]);

      const relevantIds = new Set(relevant.map((r) => r.id).filter(Boolean));
      const scoped = perSpace
        .flat()
        .filter((it) => !(it.id && relevantIds.has(it.id)))
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
        .slice(0, RECALL_MAX_ITEMS);

      return formatRecall({
        projectName: link.project_name || link.project_id,
        items: scoped,
        tasks,
        objective,
        latest,
        relevant,
        gitSummary: git ? { branch: git.branch, changedFiles: git.changedFiles.length } : null,
      });
    })();

    return await withTimeout(work, opts.timeoutMs ?? RECALL_TIMEOUT_MS);
  } catch {
    return "";
  }
}

/** Delete session logs untouched for 14 days. Best-effort, bounded, never throws. */
export function pruneSessionFiles(homeDir: string, now: number = Date.now()): number {
  let removed = 0;
  try {
    const dir = sessionsDir(homeDir);
    if (!existsSync(dir)) return 0;
    const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).slice(0, SESSION_PRUNE_MAX_FILES);
    for (const f of files) {
      const file = join(dir, f);
      try {
        if (now - statSync(file).mtimeMs > SESSION_LOG_RETENTION_MS) {
          unlinkSync(file);
          removed++;
        }
      } catch {
        /* ignore this file */
      }
    }
  } catch {
    /* ignore */
  }
  return removed;
}

/**
 * Read whatever Claude Code piped to the hook, giving up after `ms` so a
 * manual run (TTY) or a pipe that never closes can never hang the hook.
 */
export function readStdinBounded(stream: NodeJS.ReadStream, ms: number): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(buf);
    };
    const timer = setTimeout(finish, ms);
    (timer as { unref?: () => void }).unref?.();
    try {
      if ((stream as { isTTY?: boolean }).isTTY) return finish();
      stream.setEncoding("utf8");
      stream.on("data", (d: string) => {
        if (buf.length < 1_000_000) buf += d;
      });
      stream.on("end", finish);
      stream.on("close", finish);
      stream.on("error", finish);
    } catch {
      finish();
    }
  });
}

/** Extract the two hook-input fields recall uses. Tolerates junk. */
export function parseHookInput(raw: string): { session_id?: string; cwd?: string } {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const out: { session_id?: string; cwd?: string } = {};
    if (j && typeof j.session_id === "string" && j.session_id) out.session_id = j.session_id;
    if (j && typeof j.cwd === "string" && j.cwd) out.cwd = j.cwd;
    return out;
  } catch {
    return {};
  }
}

// ===========================================================================
// 0.13.0 — session objective (from the UserPromptSubmit hook log)
// ===========================================================================

/** One line of `~/.contextforge/sessions/<session_id>.jsonl`, as written by the objective hook. */
export interface SessionPromptEntry {
  t: number;
  turn: number | null;
  cwd: string | null;
  prompt: string;
}

export const OBJECTIVE_MAX_CHARS = 300;
/** Prompts shorter than this are never an objective ("fix it", "ok go"). */
const OBJECTIVE_MIN_CHARS = 15;
/** Manual-run fallback only considers session files touched within this window. */
const SESSION_FILE_MAX_AGE_MS = 24 * 3600 * 1000;
/** Pure acknowledgements / greetings in EN+ES, never an objective. */
const ACK_RE =
  /^(ok(ay)?|yes|yep|yeah|y|no|nope|n|s[ií]|dale|go|go ahead|continue|contin[uú]a|sigue|thanks|thank you|gracias|hola|hi|hello|hey|vale|listo|perfecto|perfect|great|nice|done|hecho)\b[\s.!,]*$/i;

/** Collapse whitespace to single spaces and cut to `max` chars with an ellipsis. */
export function flattenCut(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max).trimEnd() + "…" : flat;
}

/** Parse a session log; corrupt lines are skipped. Never throws. */
export function readSessionPrompts(file: string): SessionPromptEntry[] {
  let raw: string;
  try {
    raw = readFileSync(file, "utf-8");
  } catch {
    return [];
  }
  const out: SessionPromptEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line) as Partial<SessionPromptEntry>;
      if (typeof j.prompt !== "string") continue;
      out.push({
        t: typeof j.t === "number" ? j.t : 0,
        turn: typeof j.turn === "number" ? j.turn : null,
        cwd: typeof j.cwd === "string" ? j.cwd : null,
        prompt: j.prompt,
      });
    } catch {
      /* skip corrupt line */
    }
  }
  return out;
}

/**
 * Locate the session log. With a session id (what Claude Code passes to the
 * SessionStart hook on stdin) the file name is deterministic. Without one
 * (a manual `contextforge-mcp recall` from a terminal) fall back to the most
 * recently modified log whose last entry was recorded in this cwd, if it was
 * touched in the last 24 h. Never throws.
 */
export function findSessionFile(opts: {
  homeDir: string;
  sessionId?: string;
  cwd: string;
}): string | null {
  const dir = sessionsDir(opts.homeDir);
  try {
    if (opts.sessionId) {
      const sid = opts.sessionId.replace(/[^A-Za-z0-9_-]/g, "");
      if (!sid) return null;
      const file = join(dir, `${sid}.jsonl`);
      return existsSync(file) ? file : null;
    }
    if (!existsSync(dir)) return null;
    const now = Date.now();
    const candidates = readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const file = join(dir, f);
        try {
          return { file, mtime: statSync(file).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter((c): c is { file: string; mtime: number } => !!c && now - c.mtime <= SESSION_FILE_MAX_AGE_MS)
      .sort((a, b) => b.mtime - a.mtime);
    for (const c of candidates) {
      const entries = readSessionPrompts(c.file);
      const last = entries[entries.length - 1];
      if (last && last.cwd === opts.cwd) return c.file;
    }
    return null;
  } catch {
    return null;
  }
}

function isObjectiveCandidate(prompt: string): boolean {
  const flat = prompt.replace(/\s+/g, " ").trim();
  if (flat.length < OBJECTIVE_MIN_CHARS) return false;
  if (flat.startsWith("/")) return false;
  if (ACK_RE.test(flat)) return false;
  return true;
}

/**
 * Pick the session objective (first real request) and, when it differs, the
 * latest real request before the compaction. Pure.
 */
export function selectObjective(entries: SessionPromptEntry[]): { objective?: string; latest?: string } {
  const ordered = [...entries].sort((a, b) => {
    if (a.turn !== null && b.turn !== null && a.turn !== b.turn) return a.turn - b.turn;
    return a.t - b.t;
  });
  const candidates = ordered.filter((x) => isObjectiveCandidate(x.prompt));
  if (candidates.length === 0) return {};
  const objective = flattenCut(candidates[0].prompt, OBJECTIVE_MAX_CHARS);
  const lastRaw = candidates[candidates.length - 1];
  const latest = flattenCut(lastRaw.prompt, OBJECTIVE_MAX_CHARS);
  if (candidates.length === 1 || latest === objective) return { objective };
  return { objective, latest };
}

// ===========================================================================
// 0.13.0 — working context from git (what is being worked on right now)
// ===========================================================================

export interface GitSignals {
  branch: string;
  commits: string[];
  changedFiles: string[];
}

const GIT_TIMEOUT_MS = 1500;
const GIT_MAX_COMMITS = 3;
const GIT_MAX_FILES = 8;
export const WORKING_CONTEXT_MAX_CHARS = 600;

function gitOut(args: string[], cwd: string, opts: { trim?: boolean } = {}): string | null {
  try {
    const r = spawnSync("git", args, {
      cwd,
      encoding: "utf-8",
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 256 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (r.status !== 0 || typeof r.stdout !== "string") return null;
    return opts.trim === false ? r.stdout : r.stdout.trim();
  } catch {
    return null;
  }
}

/** Branch, last commit subjects and changed files. `null` when `cwd` is not a git repo or git is missing. Never throws. */
export function collectGitSignals(cwd: string): GitSignals | null {
  try {
    if (!existsSync(cwd)) return null;
    const inside = gitOut(["rev-parse", "--is-inside-work-tree"], cwd);
    if (inside !== "true") return null;
    const branch = gitOut(["rev-parse", "--abbrev-ref", "HEAD"], cwd) ?? "";
    const commits = (gitOut(["log", `-${GIT_MAX_COMMITS}`, "--pretty=%s"], cwd) ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    // Porcelain v1 lines are "XY <path>" (two status chars, a space, the path);
    // the first line may start with a space, so the output must not be trimmed.
    const changedFiles = (gitOut(["status", "--porcelain", "--untracked-files=all"], cwd, { trim: false }) ?? "")
      .split("\n")
      .map((l) => (l.length > 3 ? l.slice(3) : ""))
      .map((f) => (f.includes(" -> ") ? f.split(" -> ")[1] : f))
      .map((f) => f.trim().replace(/^"|"$/g, ""))
      .filter(Boolean)
      .slice(0, GIT_MAX_FILES);
    return { branch, commits, changedFiles };
  } catch {
    return null;
  }
}

/**
 * Compose the semantic query used to fetch memories relevant to the current
 * work. Returns "" when there is nothing to search for. Pure.
 */
export function buildWorkingContext(input: {
  objective?: string;
  latest?: string;
  git?: GitSignals | null;
}): string {
  const parts: string[] = [];
  if (input.objective) parts.push(input.objective);
  if (input.latest && input.latest !== input.objective) parts.push(input.latest);
  const git = input.git;
  if (git) {
    const branch = git.branch.trim();
    if (branch && !/^(main|master|HEAD|develop|dev)$/i.test(branch)) {
      parts.push(branch.replace(/[\/_\-.]+/g, " ").trim());
    }
    parts.push(...git.commits);
    if (git.changedFiles.length) parts.push(git.changedFiles.join(" "));
  }
  const seen = new Set<string>();
  const unique = parts.map((p) => p.trim()).filter((p) => p && !seen.has(p) && seen.add(p));
  return unique.join(". ").slice(0, WORKING_CONTEXT_MAX_CHARS);
}
